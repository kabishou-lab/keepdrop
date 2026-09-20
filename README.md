# keepdrop

**Jev-compatible System One on the OpenAI-compatible API you already have.**
Verbatim keep/drop compaction. No waitlist. No local weights.

[中文](README.zh.md)

TypeSafe's Jev answers typed questions (choice / score / noul) instead of writing prose. keepdrop speaks that shape, then uses it to **drop stale tool results without summarizing them**. The model behind it is whatever Chat Completions endpoint you already pay for.

This is not Jev. Numbers are ordinary model estimates, not RLCD-calibrated probabilities.

## 60 seconds

```bash
npm install keepdrop
export OPENAI_API_KEY=...
export OPENAI_BASE_URL=https://api.deepseek.com/v1   # any OpenAI-compatible base
export OPENAI_MODEL=deepseek-chat

npx keepdrop compact fixtures/transcript.sample.json -o compact.json
# no key yet? fixture demo only (not a model):
npx keepdrop compact fixtures/transcript.sample.json --markers
```

Without a key, compact **fail-opens**: original messages are unchanged. An outage must not delete history. `--markers` is only for fixtures tagged `[stale]` / `[superseded]`.

## What compact does

1. Pin the first message and the last `N` (default 6).
2. Find complete tool-call / tool-result pairs outside that window.
3. Ask two noul questions per pair in **one** Chat Completions call: keep the call? keep the result?
4. Apply `keep` / `drop_result` (truncate to a deterministic head) / `drop` (stub, do not rewrite user text).

Nothing is summarized. Nothing is paraphrased.

Captured 2026-09-20, no API key, `--markers` on the bundled sample:

```
keepdrop compact  fixtures/transcript.sample.json
  eligible     3
  keep         1
  drop_result  1
  drop         1
  chars        2268 → 2129  (93.9%)
  fail_open    false
  model        keyword-baseline
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
npx keepdrop eval
# OPENAI_API_KEY unset → keyword baseline (not a model)
# OPENAI_API_KEY set   → your OpenAI-compatible chat model
```

| backend | pair-action agreement | chars after/before | fail-open cases | latency |
|---|---:|---:|---:|---:|
| keyword-baseline (not a model) | 100.0% (9/9) | 98.5% | 0 | 0 ms |

Live LLM numbers belong in this table only after `OPENAI_API_KEY` is set. They will still **not** be Jev.

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
| `OPENAI_BASE_URL` | default `https://api.openai.com/v1` |
| `OPENAI_MODEL` | default `gpt-4o-mini` |

JSON Schema first, then `json_object`, then a prompted JSON fallback. Providers that only speak Chat Completions still work.

## License

MIT
