import { decide, type DecideOptions } from "./client.js";
import { noul } from "./questions.js";
import type {
  CompactResult,
  DecideResult,
  Message,
  PairAction,
  PairDecision,
  Question,
  Transcript,
} from "./types.js";

export interface ToolPair {
  id: string;
  name: string;
  arguments: string;
  callMessageIndex: number;
  resultMessageIndex: number;
  resultContent: string;
}

export interface CompactOptions extends DecideOptions {
  recent?: number;
  threshold?: number;
  truncateChars?: number;
  judge?: (state: string, questions: Record<string, Question>) => Promise<DecideResult>;
}

export const DROPPED_MARK = "[keepdrop dropped]";
export const TRUNCATED_MARK = "\n…[keepdrop truncated]";

export function messageChars(messages: Message[]): number {
  return JSON.stringify(messages).length;
}

export function pinIndices(length: number, recent: number): Set<number> {
  const pinned = new Set<number>();
  if (length <= 0) return pinned;
  pinned.add(0);
  const start = Math.max(0, length - recent);
  for (let i = start; i < length; i++) pinned.add(i);
  return pinned;
}

export function findToolPairs(messages: Message[]): ToolPair[] {
  const pairs: ToolPair[] = [];
  const usedResults = new Set<number>();
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== "assistant" || !msg.tool_calls?.length) continue;
    for (const call of msg.tool_calls) {
      if (!call.id) continue;
      let resultIndex = -1;
      for (let j = i + 1; j < messages.length; j++) {
        const cand = messages[j];
        if (cand.role !== "tool") continue;
        if (usedResults.has(j)) continue;
        if (cand.tool_call_id && cand.tool_call_id !== call.id) continue;
        if (!cand.tool_call_id && cand.name && cand.name !== call.name) continue;
        resultIndex = j;
        break;
      }
      if (resultIndex < 0) continue;
      usedResults.add(resultIndex);
      pairs.push({
        id: call.id,
        name: call.name,
        arguments: call.arguments ?? "",
        callMessageIndex: i,
        resultMessageIndex: resultIndex,
        resultContent: messages[resultIndex].content ?? "",
      });
    }
  }
  return pairs;
}

export function safeQuestionId(prefix: string, id: string, used: Set<string>): string {
  const base = `${prefix}_${id.replace(/[^A-Za-z0-9_]/g, "_") || "x"}`.replace(
    /^([0-9])/,
    "_$1",
  );
  let out = base;
  let n = 2;
  while (used.has(out)) {
    out = `${base}_${n}`;
    n += 1;
  }
  used.add(out);
  return out;
}

export function eligiblePairs(messages: Message[], recent: number): ToolPair[] {
  const pinned = pinIndices(messages.length, recent);
  return findToolPairs(messages).filter(
    (pair) => !pinned.has(pair.callMessageIndex) && !pinned.has(pair.resultMessageIndex),
  );
}

function truncate(text: string, chars: number): string {
  if (text.length <= chars) return text;
  return text.slice(0, chars) + TRUNCATED_MARK;
}

function buildState(transcript: Transcript, pairs: ToolPair[], truncateChars: number): string {
  const goal = transcript.goal?.trim() || "(none given)";
  const first = transcript.messages[0];
  const firstLine =
    first && first.role === "user"
      ? (first.content ?? "").slice(0, 500)
      : "(first message is not user text)";
  const blocks = pairs.map((pair, i) => {
    return [
      `[pair ${i}] id=${pair.id} name=${pair.name}`,
      `call: ${pair.arguments.slice(0, truncateChars)}`,
      `result_head: ${pair.resultContent.slice(0, truncateChars)}`,
    ].join("\n");
  });
  return [
    `GOAL: ${goal}`,
    `PINNED FIRST USER: ${firstLine}`,
    "Judge each older tool pair. keep_call = the call is still needed. keep_result = the result text is still needed verbatim.",
    "",
    blocks.join("\n\n"),
  ].join("\n");
}

function cloneMessages(messages: Message[]): Message[] {
  return messages.map((msg) => ({
    ...msg,
    tool_calls: msg.tool_calls?.map((call) => ({ ...call })),
  }));
}

export function applyDecisions(
  messages: Message[],
  decisions: PairDecision[],
  truncateChars: number,
): Message[] {
  const next = cloneMessages(messages);
  for (const dec of decisions) {
    const result = next[dec.result_message_index];
    const call = next[dec.call_message_index];
    if (!result || result.role !== "tool") continue;
    if (dec.action === "keep") continue;
    if (dec.action === "drop_result") {
      result.content = truncate(result.content ?? "", truncateChars);
      continue;
    }
    result.content = `${DROPPED_MARK} ${dec.name} ${dec.id}`;
    if (call?.tool_calls) {
      call.tool_calls = call.tool_calls.map((tc) =>
        tc.id === dec.id ? { ...tc, arguments: DROPPED_MARK } : tc,
      );
    }
  }
  return next;
}

export async function compactTranscript(
  transcript: Transcript,
  opts: CompactOptions = {},
): Promise<CompactResult> {
  const recent = opts.recent ?? 6;
  const threshold = opts.threshold ?? 0.5;
  const truncateChars = opts.truncateChars ?? 300;
  const before = messageChars(transcript.messages);
  const pairs = eligiblePairs(transcript.messages, recent);

  const empty = (extra: Partial<CompactResult["stats"]> = {}): CompactResult => ({
    messages: transcript.messages,
    decisions: [],
    stats: {
      eligible: pairs.length,
      keep: 0,
      drop_result: 0,
      drop: 0,
      chars_before: before,
      chars_after: before,
      fail_open: true,
      ...extra,
    },
  });

  if (pairs.length === 0) {
    return {
      messages: transcript.messages,
      decisions: [],
      stats: {
        eligible: 0,
        keep: 0,
        drop_result: 0,
        drop: 0,
        chars_before: before,
        chars_after: before,
        fail_open: false,
      },
    };
  }

  const used = new Set<string>();
  const questions: Record<string, Question> = {};
  const map: { pair: ToolPair; callId: string; resultId: string }[] = [];
  for (const pair of pairs) {
    const callId = safeQuestionId("keep_call", pair.id, used);
    const resultId = safeQuestionId("keep_result", pair.id, used);
    questions[callId] = noul(
      `Tool call ${pair.name} (${pair.id}) is still needed to continue the task.`,
    );
    questions[resultId] = noul(
      `The result of ${pair.name} (${pair.id}) is still needed verbatim; it is not stale or superseded.`,
    );
    map.push({ pair, callId, resultId });
  }

  const judge =
    opts.judge ??
    (async (state: string, qs: Record<string, Question>) =>
      decide({ state, questions: qs }, opts));

  let judged: DecideResult;
  try {
    judged = await judge(buildState(transcript, pairs, truncateChars), questions);
  } catch (err) {
    return empty({ fail_reason: err instanceof Error ? err.message : String(err) });
  }

  if (!judged.ok) {
    return empty({ fail_reason: judged.error });
  }

  const decisions: PairDecision[] = [];
  for (const item of map) {
    const callAns = judged.answers[item.callId];
    const resultAns = judged.answers[item.resultId];
    if (!callAns || callAns.type !== "noul" || !resultAns || resultAns.type !== "noul") {
      return empty({ fail_reason: "judge returned an unexpected shape", model: judged.model });
    }
    let action: PairAction = "keep";
    if (callAns.noul < threshold) action = "drop";
    else if (resultAns.noul < threshold) action = "drop_result";
    decisions.push({
      id: item.pair.id,
      name: item.pair.name,
      action,
      keep_call: callAns.noul,
      keep_result: resultAns.noul,
      confidence_call: callAns.confidence,
      confidence_result: resultAns.confidence,
      call_message_index: item.pair.callMessageIndex,
      result_message_index: item.pair.resultMessageIndex,
    });
  }

  const messages = applyDecisions(transcript.messages, decisions, truncateChars);
  const keep = decisions.filter((d) => d.action === "keep").length;
  const drop_result = decisions.filter((d) => d.action === "drop_result").length;
  const drop = decisions.filter((d) => d.action === "drop").length;
  return {
    messages,
    decisions,
    stats: {
      eligible: pairs.length,
      keep,
      drop_result,
      drop,
      chars_before: before,
      chars_after: messageChars(messages),
      fail_open: false,
      model: judged.model,
      latency_ms: judged.usage.latency_ms,
    },
  };
}
