import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compactTranscript } from "./compact.js";
import { loadEnv } from "./env.js";
import type { DecideResult, Question, Transcript } from "./types.js";

export interface EvalCase {
  id: string;
  gold: Record<string, "keep" | "drop_result" | "drop">;
  transcript: Transcript;
}

export interface EvalFile {
  cases: EvalCase[];
}

function defaultCasesPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "../fixtures/eval/cases.json");
}

export function agreement(
  gold: EvalCase["gold"],
  actions: Record<string, string>,
): { hit: number; total: number } {
  const ids = Object.keys(gold);
  let hit = 0;
  for (const id of ids) {
    if (actions[id] === gold[id]) hit += 1;
  }
  return { hit, total: ids.length };
}

function pairBlockFor(state: string, pairIndex: number, toolId: string): string {
  const chunks = state.split("[pair ");
  for (const chunk of chunks) {
    if (pairIndex >= 0 && chunk.startsWith(`${pairIndex}]`)) return chunk;
    if (toolId && chunk.includes(`id=${toolId}`)) return chunk;
  }
  return "";
}

/** Marker judge for offline eval. Not a model. Marks: [stale] [superseded] */
export async function keywordJudge(
  state: string,
  questions: Record<string, Question>,
): Promise<DecideResult> {
  const answers: NonNullable<Extract<DecideResult, { ok: true }>["answers"]> = {};
  for (const [qid, q] of Object.entries(questions)) {
    if (q.type !== "noul") continue;
    const indexed = qid.match(/^(?:kc_|kr_|call|result)(\d+)$/);
    const isResult = /^(?:kr_|result)/.test(qid) || qid.startsWith("keep_result_");
    const toolId = indexed ? "" : qid.replace(/^keep_(?:call|result)_/, "");
    const pairIndex = indexed ? Number(indexed[1]) : -1;
    const block = pairBlockFor(state, pairIndex, toolId);
    const dropAll = /\[stale\]/i.test(block);
    const dropResult = /\[superseded\]/i.test(block);
    let value = 0.9;
    if (dropAll) value = 0.1;
    else if (dropResult && isResult) value = 0.1;
    answers[qid] = { type: "noul", noul: value, confidence: 0.5 };
  }
  return {
    ok: true,
    answers,
    model: "keyword-baseline",
    raw: "{}",
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      latency_ms: 0,
      n_retries: 0,
      response_format: "prompt",
    },
  };
}

export async function runCases(
  file: EvalFile,
  live: boolean,
): Promise<{
  live: boolean;
  model: string;
  hit: number;
  total: number;
  chars_before: number;
  chars_after: number;
  latency_ms: number;
  fail_open: number;
  rows: { id: string; hit: number; total: number; fail_open: boolean }[];
}> {
  let hit = 0;
  let total = 0;
  let chars_before = 0;
  let chars_after = 0;
  let latency_ms = 0;
  let fail_open = 0;
  let model = live ? (process.env.OPENAI_MODEL ?? "live") : "keyword-baseline";
  const rows: { id: string; hit: number; total: number; fail_open: boolean }[] = [];

  for (const c of file.cases) {
    const result = await compactTranscript(c.transcript, {
      recent: 4,
      threshold: 0.5,
      truncateChars: 120,
      judge: live ? undefined : keywordJudge,
    });
    const actions = Object.fromEntries(result.decisions.map((d) => [d.id, d.action]));
    const agr = agreement(c.gold, actions);
    process.stderr.write(
      `${c.id}: ${Object.entries(c.gold)
        .map(([id, gold]) => `${id} gold=${gold} got=${actions[id] ?? "—"}`)
        .join("; ")}\n`,
    );
    hit += agr.hit;
    total += agr.total;
    chars_before += result.stats.chars_before;
    chars_after += result.stats.chars_after;
    latency_ms += result.stats.latency_ms ?? 0;
    if (result.stats.fail_open) fail_open += 1;
    if (result.stats.model) model = result.stats.model;
    rows.push({
      id: c.id,
      hit: agr.hit,
      total: agr.total,
      fail_open: result.stats.fail_open,
    });
    if (result.stats.fail_open && result.stats.fail_reason) {
      process.stderr.write(`keepdrop eval ${c.id}: ${result.stats.fail_reason}\n`);
    }
  }

  return { live, model, hit, total, chars_before, chars_after, latency_ms, fail_open, rows };
}

export function markdownTable(summary: Awaited<ReturnType<typeof runCases>>): string {
  const acc = summary.total === 0 ? 0 : summary.hit / summary.total;
  const ratio = summary.chars_before === 0 ? 1 : summary.chars_after / summary.chars_before;
  return [
    `| backend | pair-action agreement | chars after/before | fail-open cases | latency |`,
    `|---|---:|---:|---:|---:|`,
    `| ${summary.model}${summary.live ? "" : " (not a model)"} | ${(acc * 100).toFixed(1)}% (${summary.hit}/${summary.total}) | ${(ratio * 100).toFixed(1)}% | ${summary.fail_open} | ${summary.latency_ms} ms |`,
  ].join("\n");
}

export async function runEval(casesPath?: string): Promise<void> {
  loadEnv();
  const path = resolve(casesPath ?? defaultCasesPath());
  const file = JSON.parse(await readFile(path, "utf8")) as EvalFile;
  const live = Boolean(process.env.OPENAI_API_KEY?.trim());
  if (!live) {
    process.stderr.write(
      "OPENAI_API_KEY unset — running keyword baseline. This is not Jev and not an LLM.\n",
    );
  }
  const summary = await runCases(file, live);
  process.stdout.write(markdownTable(summary) + "\n");
  process.stdout.write(
    "Note: backend is an ordinary OpenAI-compatible chat model (or a keyword baseline). Not Jev. Not RLCD-calibrated.\n",
  );
}

const entry = process.argv[1] ? resolve(process.argv[1]) : "";
if (entry && fileURLToPath(import.meta.url) === entry) {
  runEval(process.argv[2]).catch((err) => {
    process.stderr.write((err instanceof Error ? err.message : String(err)) + "\n");
    process.exitCode = 1;
  });
}
