# keepdrop

**Jev-compatible System One on the OpenAI-compatible API you already have.**
Verbatim keep/drop compaction. No waitlist. No local weights.

[中文](README.zh.md)

TypeSafe's Jev answers typed questions (choice / score / noul) instead of writing prose. keepdrop speaks that shape, then uses it to **drop stale tool results without summarizing them**. The model behind it is whatever Chat Completions endpoint you already pay for.

This is not Jev. Numbers are ordinary model estimates, not RLCD-calibrated probabilities.

## 60 seconds

```bash
cp .env.example .env   # then put your key in .env (never commit it)
# lab default:
# OPENAI_BASE_URL=https://api.minimaxi.com/v1
# OPENAI_MODEL=MiniMax-M3

npx tsx src/cli.ts compact fixtures/transcript.sample.json -o compact.json
# agents can pipe:
#   cat session.json | npx tsx src/cli.ts compact - --json
```

Without a key, compact **fail-opens**: original messages are unchanged. An outage must not delete history.

Offline fixture demo (not a model):

```bash
npx tsx src/cli.ts compact fixtures/transcript.sample.json --markers
```

## What compact does

1. Pin the first message and the last `N` (default 6).
2. Find complete tool-call / tool-result pairs outside that window.
3. Ask two noul questions per pair in **one** Chat Completions call: keep the call? keep the result?
4. Apply `keep` / `drop_result` (truncate to a deterministic head) / `drop` (stub, do not rewrite user text).

Nothing is summarized. Nothing is paraphrased.

Captured 2026-09-20 against **MiniMax-M3** (`https://api.minimaxi.com/v1`), after the keep/drop policy pass:

```
keepdrop compact  fixtures/transcript.sample.json
  eligible     3
  keep         1
  drop_result  1
  drop         1
  chars        2268 → 2129  (93.9%)
  tokens~      567 → 532  (93.8%)
  fail_open    false
  model        MiniMax-M3
  latency_ms   3875
  decisions
    call_search_1    grep     drop         call=0.05 result=0.02
    call_read_1      read     keep         call=0.92 result=0.90
    call_test_1      bash     drop_result  call=0.40 result=0.03
```

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

On MiniMax: `json_object` then prompt JSON. On other OpenAI-compatible hosts: JSON Schema, then `json_object`, then prompt.

## License

MIT
