# keepdrop from Pi (not a plugin)

v0 does not ship a Pi extension. Shell out. Fail-open is the compact default: if the judge dies, messages are unchanged.

## Dump → compact

If you have a Chat Completions-shaped `{ "messages": [ ... ] }` session dump:

```bash
jq -f examples/from-openai-messages.jq session.json \
  | npx tsx src/cli.ts compact - --json > compacted.json
```

`--json` writes the payload on stdout; the human table goes to stderr.

## What to keep in the dump

keepdrop only judges **complete** `assistant.tool_calls` + matching `tool` results. User text and the latest few messages stay pinned.

Pi-specific session files (tree branches, thinking blocks) are **not** parsed here. Flatten to `messages[]` first. Do not pipe medical or employer transcripts into public fixtures.
