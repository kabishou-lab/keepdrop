# keepdrop

**Jev-compatible System One on the OpenAI-compatible API you already have.**
Verbatim keep/drop compaction. No waitlist. No local weights.

[中文](README.zh.md)

TypeSafe's Jev answers typed questions (choice / score / noul) instead of writing prose. keepdrop speaks that shape, then uses it to **drop stale tool results without summarizing them**. The model behind it is whatever Chat Completions endpoint you already pay for.

This is not Jev. Numbers are ordinary model estimates, not RLCD-calibrated probabilities.

## 60 seconds

Two commands. Feature flags are in [Reference](#reference). No npm package. No TypeSafe waitlist. Without a key, compact **fail-opens** (history is not deleted).

```bash
# offline shape (keyword markers, not a model):
npx github:kabishou-lab/keepdrop compact --demo --markers --diff

# a real session: rate-limit, cache on disk, drain the queue
keepdrop compact session.jsonl --watch --max-new 4 --diff
```

Live calls need `.env` (`OPENAI_API_KEY`, default MiniMax-M3). Do not feed `*.keepdrop-cache.json`, 曜堂, medical, or employer logs.

## What compact does

1. Pin the first message and the last `N` (default 6).
2. Find complete tool-call / tool-result pairs outside that window.
3. Ask two noul questions per pair (chunks of 4 pairs so a thinking model does not blow `max_tokens`).
4. Apply `keep` / `drop_result` (truncate to a deterministic head) / `drop` (stub, do not rewrite user text).

Nothing is summarized. Nothing is paraphrased.

**Synthetic fixture only** (tagged `[stale]` / `[superseded]`, not a real agent log). Captured 2026-09-21 against MiniMax-M3 on `fixtures/transcript.long.json`:

```
keepdrop compact  fixtures/transcript.long.json
  eligible     15
  keep         3
  drop_result  2
  drop         10
  chars        26915 → 8512  (31.6%)
  tokens~      6729 → 2128  (31.6%)
  fail_open    false
  model        MiniMax-M3
  latency_ms   41200
  judge        $0.00588  (5275 in / 3580 out @ $0.3/$1.2 per MTok)
  saved~       $0.0092   if dropped tokens were the next coder prompt @ $2/MTok
```

**68% of the log gone. Judge $0.006. Next coder prompt ~$0.009 cheaper. No waitlist.**

`--markers` (not a model) on the same file: 26915 → 15159 (56.3%). Live MiniMax was more aggressive; user text stayed verbatim either way.

Full drop requires `keep_call < 0.3` and enough confidence. Truncate uses `keep_result < 0.5`. Uncertain answers stay `keep`.

`decide` on a billing ticket, same backend (not Jev):

```
urgent     noul 0.95
team       billing 0.95
severity   2 (blocking)
399 input tokens · 153 output · 3277 ms · json_object
```

## Library

```ts
import { compactTranscript, decide, noul, choice, score } from "keepdrop";

const compacted = await compactTranscript({
  goal: "Fix the red test",
  messages, // { role, content, tool_calls?, tool_call_id? }[]
});

const verdict = await decide({
  state: "Customer charged twice. Please help ASAP.",
  questions: {
    urgent: noul("The message conveys urgency or time-sensitivity"),
    team: choice("Which team owns this?", {
      billing: "invoices and refunds",
      auth: "sign-in",
    }),
    severity: score("How severe?", ["cosmetic", "workaround exists", "blocking"]),
  },
});
```

## Eval (reproducible)

Bundled fixtures are **synthetic coding-agent transcripts**, not product or medical data.

```bash
npx tsx src/cli.ts eval
```

| backend | pair-action agreement | chars after/before | fail-open cases | latency |
|---|---:|---:|---:|---:|
| keyword-baseline (not a model) | 100.0% (9/9) | 98.5% | 0 | 0 ms |
| MiniMax-M3 (2026-09-20, this repo) | **100.0% (9/9)** | 98.5% | 0 | 20741 ms |

Still **not Jev**. MiniMax is an ordinary chat model with `reasoning_split`; keepdrop strips `<think>` and reads `reasoning_content`.

## MiniMax notes

- Host: `https://api.minimaxi.com/v1` · model `MiniMax-M3`
- keepdrop sends `reasoning_split: true`, skips `json_schema`, tries `json_object` then plain JSON
- Default timeout 90s
- Copy `.env.example` → `.env`. `.env` is gitignored.

## What this is not

- Not TypeSafe Jev, not a weight dump, not a replica of RLCD.
- Not a Claude Code / pi plugin (v0 is CLI + library; agents can shell out).
- Not a generic “decision SDK” headline. [`node-decision-model`](https://www.npmjs.com/package/node-decision-model) already covers that shape. keepdrop’s wedge is **verbatim compaction**.

## Input

Generic transcript JSON. Convert Chat Completions-style dumps with [`examples/from-openai-messages.jq`](examples/from-openai-messages.jq).

```json
{
  "goal": "optional task reminder",
  "messages": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "...", "tool_calls": [{ "id": "c1", "name": "bash", "arguments": "..." }] },
    { "role": "tool", "tool_call_id": "c1", "content": "..." }
  ]
}
```

## Env

| var | meaning |
|---|---|
| `OPENAI_API_KEY` | required for live calls |
| `OPENAI_BASE_URL` | default `https://api.minimaxi.com/v1` |
| `OPENAI_MODEL` | default `MiniMax-M3` |
| `OPENAI_INPUT_USD_PER_MTOK` | default `0.30` (judge `$` line) |
| `OPENAI_OUTPUT_USD_PER_MTOK` | default `1.20` |

On MiniMax: `json_object` then prompt JSON. On other OpenAI-compatible hosts: JSON Schema, then `json_object`, then prompt.

## Pi / any agent

Not a plugin. Flatten to `messages[]` and pipe. See [examples/pi.md](examples/pi.md).

```bash
jq -f examples/from-openai-messages.jq session.json \
  | npx tsx src/cli.ts compact - --json
```

## Reference

Not the default path. `keepdrop --help` lists the same flags.

| flag | meaning |
|---|---|
| `--demo` / `--demo --jsonl` | bundled 26k-char synthetic log |
| `--markers` | offline keyword judge (`[stale]` / `[superseded]`). Not a model |
| `--diff` | per-pair character savings |
| `--dry-run` | list eligible pairs, no API |
| `--watch` | re-run when the file changes; ignores self-writes; drains pending |
| `--max-new N` | at most N new pairs per judge tick |
| `--drain` | repeat until pending is 0 (default under `--watch`) |
| `--cache-file` | persist judgments (`*.keepdrop-cache.json` under `--watch`) |
| `--in-place` | rewrite the file; one-time `.bak` |
| `--strict` | exit 2 on fail-open |
| `-o out.jsonl` / `--format jsonl` | line-oriented output |
| `eval` / `eval --long` | short cases (9) or the long fixture (15), keyword baseline without a key |

Sidecar files: [`examples/gitignore`](examples/gitignore). Pi is a shell-out, not a plugin: [`examples/pi.md`](examples/pi.md).

## License

MIT
