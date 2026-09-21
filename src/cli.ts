#!/usr/bin/env node
import { copyFile, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decide } from "./client.js";
import { compactTranscript, eligiblePairs, type CachedJudgment } from "./compact.js";
import { loadCacheFile, saveCacheFile } from "./cache-file.js";
import { atomicWrite } from "./fsx.js";
import { watchFile, type WatchHandle } from "./watch.js";
import { formatUsd, pricePerMtok } from "./cost.js";
import { loadEnv } from "./env.js";
import { parseTranscriptText } from "./ingest.js";
import { toJsonl, toKeepdropJson, wantsJsonl } from "./serialize.js";
import { keywordJudge } from "./run-eval.js";
import type { Question, Transcript } from "./types.js";

loadEnv();

function usage(): string {
  return `keepdrop — Jev-compatible System One on the OpenAI-compatible API you already have.

Usage:
  keepdrop compact <transcript.json|-> [-o out.json] [--recent N] [--drop-call P] [--drop-result P]
  keepdrop compact --demo [--jsonl] [--markers]   bundled long log (json or jsonl)
  keepdrop compact … [-o out.jsonl] [--format json|jsonl]
  keepdrop compact … [--dry-run] [--diff] [--strict] [--markers] [--json]
  keepdrop compact … [--min-confidence P] [--truncate N]
  keepdrop decide  --state <text-or-file> --questions <questions.json>
  keepdrop eval    [cases.json] [--long]
  keepdrop compact … [--watch] [--in-place] [--cache-file f] [--max-new N] [--drain] [--quiet]

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

function printCompact(
  file: string,
  result: Awaited<ReturnType<typeof compactTranscript>>,
  stream: NodeJS.WritableStream = process.stdout,
  diff = false,
): void {
  const s = result.stats;
  const ratio = s.chars_before === 0 ? 1 : s.chars_after / s.chars_before;
  const tokRatio = s.tokens_before === 0 ? 1 : s.tokens_after / s.tokens_before;
  const lines = [
    `keepdrop compact  ${file}`,
    `  eligible     ${s.eligible}`,
    ...(s.skipped_sealed ? [`  skipped      ${s.skipped_sealed} already compacted`] : []),
    ...(s.skipped_cached ? [`  cached       ${s.skipped_cached} unchanged pairs`] : []),
    ...(s.pending ? [`  pending      ${s.pending} (over --max-new)`] : []),
    `  keep         ${s.keep}`,
    `  drop_result  ${s.drop_result}`,
    `  drop         ${s.drop}`,
    ...(s.chars_saved ? [`  chars_saved  ${s.chars_saved}`] : []),
    `  chars        ${s.chars_before} → ${s.chars_after}  (${(ratio * 100).toFixed(1)}%)`,
    `  tokens~      ${s.tokens_before} → ${s.tokens_after}  (${(tokRatio * 100).toFixed(1)}%)`,
    `  fail_open    ${s.fail_open}${s.fail_reason ? `  (${s.fail_reason})` : ""}`,
  ];
  if (s.model) lines.push(`  model        ${s.model}`);
  if (s.latency_ms !== undefined) lines.push(`  latency_ms   ${s.latency_ms}`);
  if (s.usd_judge !== undefined && (s.input_tokens || s.output_tokens)) {
    const price = pricePerMtok();
    lines.push(
      `  judge        ${formatUsd(s.usd_judge)}  (${s.input_tokens ?? 0} in / ${s.output_tokens ?? 0} out @ $${price.input}/$${price.output} per MTok)`,
    );
  }
  if (s.usd_saved_at_coder !== undefined && s.tokens_before > s.tokens_after) {
    const coder = s.coder_usd_per_mtok ?? 2;
    lines.push(
      `  saved~       ${formatUsd(s.usd_saved_at_coder)}  if dropped tokens were the next coder prompt @ $${coder}/MTok`,
    );
  }
  if (result.decisions.length) {
    lines.push("  decisions");
    for (const d of result.decisions) {
      const name = (d.name ?? "").padEnd(8);
      const id = d.id.padEnd(16);
      lines.push(
        `    ${id} ${name} ${d.action.padEnd(12)} call=${d.keep_call.toFixed(2)} result=${d.keep_result.toFixed(2)} conf=${Math.min(d.confidence_call, d.confidence_result).toFixed(2)}`,
      );
    }
  }
  if (diff) {
    const rows = result.decisions.filter((d) => d.action !== "keep" && (d.chars_saved ?? 0) > 0);
    lines.push("  diff");
    if (!rows.length) lines.push("    (no char savings)");
    for (const d of rows) {
      lines.push(`    ${d.id.padEnd(16)} ${d.action.padEnd(12)} -${d.chars_saved}`);
    }
  }
  stream.write(lines.join("\n") + "\n");
}

async function readTranscript(file: string): Promise<Transcript> {
  const text = file === "-" ? await readStdin() : await readFile(resolve(file), "utf8");
  return parseTranscriptText(text);
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c) => chunks.push(Buffer.from(c)));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

async function cmdCompact(args: string[]): Promise<void> {
  const demo = flag(args, "--demo");
  const demoJsonl = demo && (flag(args, "--jsonl") || arg(args, "--format") === "jsonl");
  const file = demo
    ? resolve(
        packageRoot(),
        demoJsonl ? "fixtures/transcript.long.jsonl" : "fixtures/transcript.long.json",
      )
    : args.find((a) => a === "-" || (!a.startsWith("-") && a !== "compact"));
  if (!file) throw new Error("compact needs a transcript json path, - for stdin, or --demo");
  if (file !== "-" && /\.keepdrop-cache\.json$/i.test(basename(file))) {
    throw new Error("refusing to compact a keepdrop cache file");
  }
  const watching = flag(args, "--watch");
  const inPlace = flag(args, "--in-place");
  if (watching && file === "-") throw new Error("--watch cannot read stdin");
  if (inPlace && file === "-") throw new Error("--in-place cannot write stdin");
  const format = arg(args, "--format");
  const outFlag = arg(args, "-o") ?? arg(args, "--out");
  const outDefault = inPlace
    ? file
    : watching && !outFlag
      ? `${file}${wantsJsonl(file, format) ? ".keepdrop.jsonl" : ".keepdrop.json"}`
      : undefined;
  let backedUp = false;
  let watcher: WatchHandle | undefined;
  const cacheFile =
    arg(args, "--cache-file") ??
    (watching ? `${file}.keepdrop-cache.json` : undefined);
  const cache = new Map<string, CachedJudgment>();
  if (cacheFile) {
    const loaded = await loadCacheFile(resolve(cacheFile));
    for (const [k, v] of loaded) cache.set(k, v);
  }

  const runOnce = async (): Promise<{ pending: number; fail_open: boolean } | undefined> => {
    const transcript = await readTranscript(file);
    const recent = num(args, "--recent", 6);
    if (flag(args, "--dry-run")) {
      const pairs = eligiblePairs(transcript.messages, recent);
      process.stdout.write(
        `keepdrop dry-run  ${file}\n  messages     ${transcript.messages.length}\n  eligible     ${pairs.length}\n` +
          pairs.map((p, i) => `    ${String(i).padStart(2)} ${p.name.padEnd(8)} ${p.id}  ${p.resultContent.length} chars`).join("\n") +
          (pairs.length ? "\n" : ""),
      );
      return undefined;
    }
    const markers = flag(args, "--markers");
    if (markers && !watching) {
      process.stderr.write("keepdrop: --markers uses fixture tokens [stale]/[superseded], not a model.\n");
    }
    const result = await compactTranscript(transcript, {
      recent,
      dropCall: num(args, "--drop-call", 0.3),
      dropResult: num(args, "--drop-result", 0.5),
      minConfidence: num(args, "--min-confidence", 0.35),
      truncateChars: num(args, "--truncate", 300),
      pairChunk: num(args, "--pair-chunk", 4),
      maxNew: arg(args, "--max-new") ? num(args, "--max-new", 0) : undefined,
      judge: markers ? keywordJudge : undefined,
      cache,
      onChunk: (done, total) => {
        if (total > 1 && !flag(args, "--quiet")) {
          process.stderr.write(`keepdrop: judging chunk ${done}/${total}\n`);
        }
      },
    });
    const out = arg(args, "-o") ?? arg(args, "--out") ?? outDefault;
    const asJson = flag(args, "--json");
    const quiet = flag(args, "--quiet");
    if (!quiet || flag(args, "--diff")) {
      printCompact(file, result, asJson && !out ? process.stderr : process.stdout, flag(args, "--diff"));
    }
    else if (result.stats.eligible > 0 || result.stats.fail_open) {
      process.stderr.write(
        `keepdrop ${result.stats.fail_open ? "fail-open" : "ok"}  eligible=${result.stats.eligible}  ${result.stats.chars_before}→${result.stats.chars_after}\n`,
      );
    }
    const compacted: Transcript = { goal: transcript.goal, messages: result.messages };
    const jsonl = wantsJsonl(out, format);
    const body = jsonl
      ? toJsonl(compacted)
      : toKeepdropJson(compacted, { decisions: result.decisions, stats: result.stats });
    if (out) {
      const dest = resolve(out);
      if (inPlace && !backedUp) {
        try {
          await copyFile(resolve(file), `${dest}.bak`, fsConstants.COPYFILE_EXCL);
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code !== "EEXIST") throw err;
        }
        backedUp = true;
      }
      if (watching && dest === resolve(file)) await watcher?.markSelfWrite();
      await atomicWrite(dest, body);
      if (watching && dest === resolve(file)) await watcher?.markSelfWrite();
    } else if (asJson || jsonl) {
      process.stdout.write(body);
    }
    if (cacheFile) await saveCacheFile(resolve(cacheFile), cache);
    if (flag(args, "--strict") && result.stats.fail_open) process.exitCode = 2;
    return { pending: result.stats.pending ?? 0, fail_open: result.stats.fail_open };
  };

  const drain = async () => {
    let prev = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 64; i++) {
      const stats = await runOnce();
      if (!stats || stats.fail_open) return;
      if (stats.pending <= 0) return;
      if (stats.pending >= prev) return;
      prev = stats.pending;
    }
  };

  const shouldDrain = flag(args, "--drain") || watching;
  if (shouldDrain) await drain();
  else await runOnce();
  if (!watching) return;
  process.stderr.write(`keepdrop: watching ${file}  (Ctrl-C to stop)\n`);
  watcher = watchFile(resolve(file), () => drain(), {
    debounceMs: 250,
    pollMs: 400,
    onError: (err) => {
      process.stderr.write(`keepdrop watch: ${err instanceof Error ? err.message : String(err)}\n`);
    },
  });
  await new Promise<void>((resolveWait) => {
    const stop = () => {
      watcher?.close();
      resolveWait();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
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
    const long = flag(args, "--long");
    const path = args.find((a) => a !== "eval" && !a.startsWith("-"));
    await runEval(path, { long });
    return;
  }
  throw new Error(`unknown command ${cmd}\n${usage()}`);
}

main().catch((err) => {
  process.stderr.write((err instanceof Error ? err.message : String(err)) + "\n");
  process.exitCode = 1;
});
