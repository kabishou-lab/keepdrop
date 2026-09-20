import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DROPPED_MARK,
  TRUNCATED_MARK,
  applyDecisions,
  compactTranscript,
  eligiblePairs,
  findToolPairs,
  pinIndices,
} from "../src/compact.js";
import { keywordJudge, agreement, type EvalFile } from "../src/run-eval.js";
import type { DecideResult, Message, PairDecision, Transcript } from "../src/types.js";

const sample = (): Transcript => ({
  messages: [
    { role: "user", content: "fix tests" },
    {
      role: "assistant",
      content: "grep",
      tool_calls: [{ id: "c1", name: "grep", arguments: "parse" }],
    },
    { role: "tool", tool_call_id: "c1", content: "src/parse.ts" },
    {
      role: "assistant",
      content: "read",
      tool_calls: [{ id: "c2", name: "read", arguments: "src/parse.ts" }],
    },
    { role: "tool", tool_call_id: "c2", content: "export function parse() {}" },
    {
      role: "assistant",
      content: "test",
      tool_calls: [{ id: "c3", name: "bash", arguments: "vitest" }],
    },
    { role: "tool", tool_call_id: "c3", content: "PASS" },
    { role: "assistant", content: "done" },
  ],
});

describe("pin + pairs", () => {
  it("always pins 0 and the last recent messages", () => {
    const pinned = pinIndices(8, 3);
    expect([...pinned].sort((a, b) => a - b)).toEqual([0, 5, 6, 7]);
  });

  it("pairs assistant tool_calls with later tool results", () => {
    const pairs = findToolPairs(sample().messages);
    expect(pairs.map((p) => p.id)).toEqual(["c1", "c2", "c3"]);
    expect(pairs[0].resultMessageIndex).toBe(2);
  });

  it("does not judge pairs that sit in the recent window", () => {
    const eligible = eligiblePairs(sample().messages, 3);
    expect(eligible.map((p) => p.id)).toEqual(["c1", "c2"]);
  });
});

describe("applyDecisions", () => {
  it("keeps verbatim, truncates results, stubs dropped calls", () => {
    const messages = sample().messages;
    const decisions: PairDecision[] = [
      {
        id: "c1",
        name: "grep",
        action: "drop",
        keep_call: 0.1,
        keep_result: 0.1,
        confidence_call: 0.5,
        confidence_result: 0.5,
        call_message_index: 1,
        result_message_index: 2,
      },
      {
        id: "c2",
        name: "read",
        action: "drop_result",
        keep_call: 0.9,
        keep_result: 0.1,
        confidence_call: 0.5,
        confidence_result: 0.5,
        call_message_index: 3,
        result_message_index: 4,
      },
      {
        id: "c3",
        name: "bash",
        action: "keep",
        keep_call: 0.9,
        keep_result: 0.9,
        confidence_call: 0.5,
        confidence_result: 0.5,
        call_message_index: 5,
        result_message_index: 6,
      },
    ];
    const next = applyDecisions(messages, decisions, 8);
    expect(next[2].content).toContain(DROPPED_MARK);
    expect(next[1].tool_calls?.[0].arguments).toBe(DROPPED_MARK);
    expect(next[4].content).toContain(TRUNCATED_MARK);
    expect(next[6].content).toBe("PASS");
    expect(next[0].content).toBe("fix tests");
  });
});

describe("compactTranscript", () => {
  it("fail-opens when the judge errors", async () => {
    const t = sample();
    const result = await compactTranscript(t, {
      recent: 3,
      judge: async () => {
        throw new Error("gateway down");
      },
    });
    expect(result.stats.fail_open).toBe(true);
    expect(result.stats.fail_reason).toMatch(/gateway down/);
    expect(result.messages).toBe(t.messages);
  });

  it("fail-opens when decide returns ok:false", async () => {
    const t = sample();
    const result = await compactTranscript(t, {
      recent: 3,
      judge: async () => ({ ok: false, error: "bad json" }),
    });
    expect(result.stats.fail_open).toBe(true);
    expect(result.messages).toEqual(t.messages);
  });

  it("applies keep/drop_result/drop from noul answers", async () => {
    const t = sample();
    const judge = async (): Promise<DecideResult> => ({
      ok: true,
      model: "fake",
      raw: "{}",
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        latency_ms: 7,
        n_retries: 0,
        response_format: "json_object",
      },
      answers: {
        keep_call_c1: { type: "noul", noul: 0.1, confidence: 0.6 },
        keep_result_c1: { type: "noul", noul: 0.1, confidence: 0.6 },
        keep_call_c2: { type: "noul", noul: 0.9, confidence: 0.6 },
        keep_result_c2: { type: "noul", noul: 0.1, confidence: 0.6 },
      },
    });
    const result = await compactTranscript(t, {
      recent: 3,
      threshold: 0.5,
      truncateChars: 8,
      judge,
    });
    expect(result.stats.fail_open).toBe(false);
    expect(result.stats).toMatchObject({ keep: 0, drop_result: 1, drop: 1 });
    expect(result.decisions.map((d) => d.action)).toEqual(["drop", "drop_result"]);
    expect(result.messages[0].content).toBe("fix tests");
    expect(result.messages[7].content).toBe("done");
    expect(result.messages[2].content).toContain(DROPPED_MARK);
    expect(result.messages[4].content).toContain(TRUNCATED_MARK);
  });

  it("does not rewrite user text", async () => {
    const t = sample();
    const result = await compactTranscript(t, {
      recent: 3,
      judge: async () => ({
        ok: true,
        model: "fake",
        raw: "{}",
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          latency_ms: 0,
          n_retries: 0,
          response_format: "prompt",
        },
        answers: {
          keep_call_c1: { type: "noul", noul: 0.01, confidence: 1 },
          keep_result_c1: { type: "noul", noul: 0.01, confidence: 1 },
          keep_call_c2: { type: "noul", noul: 0.01, confidence: 1 },
          keep_result_c2: { type: "noul", noul: 0.01, confidence: 1 },
        },
      }),
    });
    const users = result.messages.filter((m: Message) => m.role === "user");
    expect(users.map((m) => m.content)).toEqual(["fix tests"]);
  });
});

describe("eval fixtures + keyword judge", () => {
  it("keyword baseline matches gold on bundled cases", async () => {
    const raw = await readFile(resolve("fixtures/eval/cases.json"), "utf8");
    const file = JSON.parse(raw) as EvalFile;
    let hit = 0;
    let total = 0;
    for (const c of file.cases) {
      const result = await compactTranscript(c.transcript, {
        recent: 4,
        threshold: 0.5,
        judge: keywordJudge,
      });
      const actions = Object.fromEntries(result.decisions.map((d) => [d.id, d.action]));
      const agr = agreement(c.gold, actions);
      expect(result.stats.fail_open).toBe(false);
      expect(Object.keys(actions).sort()).toEqual(Object.keys(c.gold).sort());
      hit += agr.hit;
      total += agr.total;
    }
    expect(hit).toBe(total);
    expect(total).toBe(9);
  });
});
