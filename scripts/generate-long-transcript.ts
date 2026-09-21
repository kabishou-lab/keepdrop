import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { toJsonl } from "../src/serialize.js";
import type { Message, Transcript } from "../src/types.js";

function pad(label: string, n: number): string {
  const line = `${label} ${"x".repeat(48)}\n`;
  return line.repeat(Math.ceil(n / line.length)).slice(0, n);
}

function pair(
  id: string,
  name: string,
  args: string,
  result: string,
  assistant: string,
): Message[] {
  return [
    {
      role: "assistant",
      content: assistant,
      tool_calls: [{ id, name, arguments: args }],
    },
    { role: "tool", tool_call_id: id, content: result },
  ];
}

function sourceBlob(path: string): string {
  const body = [
    `// ${path}`,
    "export function handle(req: { url: string }) {",
    '  if (req.url === "/ready") return { ok: true }',
    '  if (req.url === "/health") return { ok: true, ts: Date.now() }',
    "  return { error: 404 }",
    "}",
    pad(`body ${path}`, 2200),
  ].join("\n");
  return body;
}

const messages: Message[] = [
  {
    role: "user",
    content:
      "CI says GET /health is 404 on the local server. Find the router, add the route, add a test, run the suite, show the diff. Do not break /ready.",
  },
];

const staleListings = pad("README.md src dist node_modules package-lock.json", 900);
messages.push(
  ...pair(
    "ls_root",
    "bash",
    '{"command":"ls -la"} [stale]',
    `${staleListings}\n[stale] top-level listing before we knew the path`,
    "Listing the repo root.",
  ),
  ...pair(
    "find_js",
    "bash",
    '{"command":"find . -name \'*.js\' | head"} [stale]',
    `${pad("./dist/bundle.js\n./node_modules/vite/dist/node/index.js\n", 1800)}[stale] compiled noise`,
    "Looking for JS files.",
  ),
  ...pair(
    "grep_express",
    "grep",
    '{"pattern":"express\\\\(\\\\):","path":"."} [stale]',
    `${pad("node_modules/express/lib/application.js: lots of matches\n", 1100)}[stale] dependency hits`,
    "Searching for express() setup.",
  ),
  ...pair(
    "npm_outdated",
    "bash",
    '{"command":"npm outdated"} [stale]',
    `${pad("vitest 3.0.0 3.2.4\n", 800)}[stale] unrelated deps`,
    "Checking outdated packages.",
  ),
  ...pair(
    "cat_readme",
    "read",
    '{"path":"README.md"} [stale]',
    `${pad("# demo-router\nRun npm test\n", 900)}[stale] docs, not the bug`,
    "Reading the README.",
  ),
  ...pair(
    "grep_health_old",
    "grep",
    '{"pattern":"health","path":"docs"} [stale]',
    `${pad("docs/ops.md: health checks in k8s\n", 700)}[stale] ops docs`,
    "Docs mention health somewhere.",
  ),
);

messages.push(
  ...pair(
    "grep_router",
    "grep",
    '{"pattern":"createServer|/ready","path":"src"}',
    "src/router.ts:14: app.get('/ready', ready)\nsrc/server.ts:8: import { router } from './router.ts'\n",
    "Searching src for the server.",
  ),
  ...pair(
    "read_router",
    "read",
    '{"path":"src/router.ts"}',
    sourceBlob("src/router.ts"),
    "Reading the router.",
  ),
  ...pair(
    "read_server",
    "read",
    '{"path":"src/server.ts"}',
    sourceBlob("src/server.ts"),
    "Reading the server entry.",
  ),
  ...pair(
    "read_index",
    "read",
    '{"path":"src/index.ts"}',
    sourceBlob("src/index.ts"),
    "Reading index.",
  ),
);

const failLog = [
  "FAIL src/router.test.ts",
  "AssertionError: expected 404 to be 200",
  "GET /health",
  pad("stack", 2800),
].join("\n");

messages.push(
  ...pair(
    "test_1",
    "bash",
    '{"command":"npx vitest run src/router.test.ts"}',
    `${failLog}\n[superseded] first red run before the route existed`,
    "Running the failing test.",
  ),
  ...pair(
    "edit_1",
    "edit",
    '{"path":"src/router.ts","old":"ready only","new":"ready+health"}',
    "ok 1 file changed\n",
    "Adding /health next to /ready.",
  ),
  ...pair(
    "test_2",
    "bash",
    '{"command":"npx vitest run src/router.test.ts"}',
    `${failLog}\n[superseded] still red: test file not updated`,
    "Re-running tests after the first patch.",
  ),
);

messages.push(
  ...pair(
    "read_test",
    "read",
    '{"path":"src/router.test.ts"}',
    `${pad("import { handle } from './router'\n", 1600)}\nit('ready', () => expect(handle({url:'/ready'}).ok).toBe(true))\n`,
    "Reading the test file.",
  ),
  ...pair(
    "edit_test",
    "edit",
    '{"path":"src/router.test.ts"}',
    "ok added /health case\n",
    "Adding a /health assertion.",
  ),
  ...pair(
    "test_3",
    "bash",
    '{"command":"npx vitest run"}',
    "PASS src/router.test.ts (2 tests)\nPASS src/server.test.ts (1 test)\n",
    "Full suite after the test patch.",
  ),
);

messages.push(
  ...pair(
    "git_diff",
    "bash",
    '{"command":"git diff src/router.ts src/router.test.ts"}',
    [
      "diff --git a/src/router.ts b/src/router.ts",
      "+  if (req.url === '/health') return { ok: true, ts: Date.now() }",
      "diff --git a/src/router.test.ts b/src/router.test.ts",
      "+ it('health', () => expect(handle({url:'/health'}).ok).toBe(true))",
      pad("diff context", 600),
    ].join("\n"),
    "Showing the diff.",
  ),
  ...pair(
    "git_status",
    "bash",
    '{"command":"git status --short"}',
    " M src/router.ts\n M src/router.test.ts\n",
    "Checking git status.",
  ),
);

messages.push({
  role: "assistant",
  content:
    "/health was missing on the router. Added the route and a test. /ready unchanged. Suite green. Diff is in the last tool results.",
});

const transcript: Transcript = {
  goal: "Fix GET /health 404 without breaking /ready, with tests and a diff",
  messages,
};

const out = resolve("fixtures/transcript.long.json");
await writeFile(out, JSON.stringify(transcript) + "\n", "utf8");
const jsonl = resolve("fixtures/transcript.long.jsonl");
await writeFile(jsonl, toJsonl(transcript), "utf8");
const chars = JSON.stringify(transcript.messages).length;
process.stdout.write(`wrote ${out} and ${jsonl}  messages=${messages.length}  chars=${chars}\n`);
