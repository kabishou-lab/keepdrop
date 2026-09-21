# keepdrop

**Jev-compatible System One on the OpenAI-compatible API you already have.**
Verbatim keep/drop compaction. No waitlist. No local weights.

[中文](README.zh.md)

TypeSafe's Jev answers typed questions (choice / score / noul) instead of writing prose. keepdrop speaks that shape, then uses it to **drop stale tool results without summarizing them**. The model behind it is whatever Chat Completions endpoint you already pay for.

This is not Jev. Numbers are ordinary model estimates, not RLCD-calibrated probabilities.

## 60 seconds

No npm login required. No TypeSafe waitlist.

```bash
# offline, bundled 26k-char log (not a model):
npx github:kabishou-lab/keepdrop compact --demo --markers

# live MiniMax / any OpenAI-compatible API:
git clone https://github.com/kabishou-lab/keepdrop && cd keepdrop
cp .env.example .env   # OPENAI_API_KEY + MiniMax-M3 defaults
npx tsx src/cli.ts compact --demo
```

`--dry-run` lists eligible pairs with no API call. `--strict` exits 2 on fail-open. `--watch` re-compacts when the file changes (self-writes ignored; unchanged pairs cached). `--cache-file` persists that cache (`file.keepdrop-cache.json` under `--watch`). `--max-new N` judges at most N new pairs per tick. `--in-place` rewrites the file and keeps a one-time `.bak`. `-o out.jsonl` writes JSONL. `--demo --jsonl` uses the bundled JSONL log. `keepdrop eval --long` scores the 26k-char fixture.

Without a key, compact **fail-opens**: original messages are unchanged. An outage must not delete history.

Offline fixture demo (not a model):

```bash
npx tsx src/cli.ts compact fixtures/transcript.sample.json --markers
```

## What compact does

1. Pin the first message and the last `N` (default 6).
2. Find complete tool-call / tool-result pairs outside that window.
3. Ask two noul questions per pair (chunks of 4 pairs so a thinking model does not blow `max_tokens`).
4. Apply `keep` / `drop_result` (truncate to a deterministic head) / `drop` (stub, do not rewrite user text).

Nothing is summarized. Nothing is paraphrased.

Captured 2026-09-21 against **MiniMax-M3** on `fixtures/transcript.long.json` (synthetic coding-agent log, not product data):

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

## License

MIT
