#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { decide } from "./client.js";
import { compactTranscript } from "./compact.js";
import { loadEnv } from "./env.js";
import { keywordJudge } from "./run-eval.js";
import type { Question, Transcript } from "./types.js";

loadEnv();

function usage(): string {
  return `keepdrop — Jev-compatible System One on the OpenAI-compatible API you already have.

Usage:
  keepdrop compact <transcript.json> [-o out.json] [--recent N] [--threshold P] [--truncate N] [--markers]
  keepdrop decide  --state <text-or-file> --questions <questions.json>
  keepdrop eval    [cases.json]

Env: OPENAI_API_KEY  OPENAI_BASE_URL  OPENAI_MODEL

The backend is an ordinary chat model. It is not Jev. Numbers are not RLCD-calibrated.
`;
}

function arg(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0 || i + 1 >= args.length) return undefined;
  return args[i + 1];
}

function flag(args: string[], name: string): boolean {
  return args.includes(name);
}

function num(args: string[], name: string, fallback: number): number {
  const raw = arg(args, name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
  return n;
}

async function readJson<T>(path: string): Promise<T> {
  const text = await readFile(path, "utf8");
  return JSON.parse(text) as T;
}

async function loadState(raw: string): Promise<string> {
  try {
    const text = await readFile(raw, "utf8");
    return text;
  } catch {
    return raw;
  }
}

function printCompact(file: string, result: Awaited<ReturnType<typeof compactTranscript>>): void {
  const s = result.stats;
  const ratio = s.chars_before === 0 ? 1 : s.chars_after / s.chars_before;
  const lines = [
    `keepdrop compact  ${file}`,
    `  eligible     ${s.eligible}`,
    `  keep         ${s.keep}`,
    `  drop_result  ${s.drop_result}`,
    `  drop         ${s.drop}`,
    `  chars        ${s.chars_before} → ${s.chars_after}  (${(ratio * 100).toFixed(1)}%)`,
    `  fail_open    ${s.fail_open}${s.fail_reason ? `  (${s.fail_reason})` : ""}`,
  ];
  if (s.model) lines.push(`  model        ${s.model}`);
  if (s.latency_ms !== undefined) lines.push(`  latency_ms   ${s.latency_ms}`);
  process.stdout.write(lines.join("\n") + "\n");
}

async function cmdCompact(args: string[]): Promise<void> {
  const file = args.find((a) => !a.startsWith("-") && a !== "compact");
  if (!file) throw new Error("compact needs a transcript json path");
  const transcript = await readJson<Transcript>(resolve(file));
  if (!transcript || !Array.isArray(transcript.messages)) {
    throw new Error("transcript must be { messages: Message[], goal?: string }");
  }
  const markers = flag(args, "--markers");
  if (markers) {
    process.stderr.write("keepdrop: --markers uses fixture tokens [stale]/[superseded], not a model.\n");
  }
  const result = await compactTranscript(transcript, {
    recent: num(args, "--recent", 6),
    threshold: num(args, "--threshold", 0.5),
    truncateChars: num(args, "--truncate", 300),
    judge: markers ? keywordJudge : undefined,
  });
  printCompact(file, result);
  const out = arg(args, "-o") ?? arg(args, "--out");
  const payload = {
    messages: result.messages,
    decisions: result.decisions,
    stats: result.stats,
  };
  if (out) {
    await writeFile(resolve(out), JSON.stringify(payload, null, 2) + "\n", "utf8");
  } else if (flag(args, "--json")) {
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  }
}

async function cmdDecide(args: string[]): Promise<void> {
  const stateRaw = arg(args, "--state");
  const questionsPath = arg(args, "--questions");
  if (!stateRaw || !questionsPath) {
    throw new Error("decide needs --state <text-or-file> and --questions <file>");
  }
  const state = await loadState(stateRaw);
  const questions = await readJson<Record<string, Question>>(resolve(questionsPath));
  const result = await decide({ state, questions });
  if (!result.ok) {
    process.stderr.write(`keepdrop decide failed: ${result.error}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    JSON.stringify(
      {
        model: result.model,
        usage: result.usage,
        answers: result.answers,
        note: "Ordinary LLM estimates. Not Jev. Not RLCD-calibrated.",
      },
      null,
      2,
    ) + "\n",
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0];
  if (!cmd || cmd === "-h" || cmd === "--help") {
    process.stdout.write(usage());
    return;
  }
  if (cmd === "compact") {
    await cmdCompact(args);
    return;
  }
  if (cmd === "decide") {
    await cmdDecide(args);
    return;
  }
  if (cmd === "eval") {
    const { runEval } = await import("./run-eval.js");
    await runEval(args[1]);
    return;
  }
  throw new Error(`unknown command ${cmd}\n${usage()}`);
}

main().catch((err) => {
  process.stderr.write((err instanceof Error ? err.message : String(err)) + "\n");
  process.exitCode = 1;
});
