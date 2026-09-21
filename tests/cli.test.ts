import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function run(
  args: string[],
  env: NodeJS.ProcessEnv = {},
  stdin?: string,
): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn("npx", ["tsx", "src/cli.ts", ...args], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
    });
    if (stdin !== undefined) {
      child.stdin.write(stdin);
      child.stdin.end();
    }
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += String(d);
    });
    child.stderr.on("data", (d) => {
      err += String(d);
    });
    child.on("close", (code) => resolve({ code: code ?? 1, out, err }));
  });
}

describe("cli", () => {
  it("dry-runs eligible pairs without a key", async () => {
    const { code, out } = await run(["compact", "--demo", "--dry-run"], { OPENAI_API_KEY: "" });
    expect(code).toBe(0);
    expect(out).toMatch(/dry-run/);
    expect(out).toMatch(/eligible\s+15/);
    expect(out).toMatch(/ls_root/);
  });

  it("prints help", async () => {
    const { code, out } = await run(["--help"]);
    expect(code).toBe(0);
    expect(out).toMatch(/keepdrop compact/);
    expect(out).toMatch(/not Jev/i);
  });

  it("compacts a transcript with fail-open when no key is set", async () => {
    const dir = await mkdtemp(join(tmpdir(), "keepdrop-"));
    const outFile = join(dir, "out.json");
    const { code, out, err } = await run(
      ["compact", "fixtures/transcript.sample.json", "-o", outFile],
      { OPENAI_API_KEY: "", OPENAI_BASE_URL: "", OPENAI_MODEL: "" },
    );
    expect(code).toBe(0);
    expect(out + err).toMatch(/fail_open/);
    const payload = JSON.parse(await readFile(outFile, "utf8")) as {
      stats: { fail_open: boolean };
      messages: unknown[];
    };
    expect(payload.stats.fail_open).toBe(true);
    expect(payload.messages.length).toBeGreaterThan(3);
  });

  it("compacts --demo --markers from the bundled long fixture", async () => {
    const { code, out } = await run(["compact", "--demo", "--markers"], { OPENAI_API_KEY: "" });
    expect(code).toBe(0);
    expect(out).toMatch(/fail_open    false/);
    expect(out).toMatch(/saved~/);
    expect(out).toMatch(/eligible\s+15/);
  });

  it("compacts the sample with --markers without an API key", async () => {
    const { code, out, err } = await run(
      ["compact", "fixtures/transcript.sample.json", "--markers", "--recent", "6"],
      { OPENAI_API_KEY: "" },
    );
    expect(code).toBe(0);
    expect(err).toMatch(/not a model/i);
    expect(out).toMatch(/fail_open    false/);
    expect(out).toMatch(/drop/);
  });

  it("reads a transcript from stdin", async () => {
    const raw = await readFile("fixtures/transcript.sample.json", "utf8");
    const { code, out, err } = await run(
      ["compact", "-", "--markers", "--recent", "6"],
      { OPENAI_API_KEY: "" },
      raw,
    );
    expect(code).toBe(0);
    expect(out + err).toMatch(/fail_open    false/);
    expect(out).toMatch(/tokens~/);
    expect(out).toMatch(/decisions/);
  });

  it("evals the long fixture against marker gold", async () => {
    const { code, out, err } = await run(["eval", "--long"], { OPENAI_API_KEY: "" });
    expect(code).toBe(0);
    expect(err).toMatch(/keyword baseline/i);
    expect(out).toMatch(/100\.0% \(15\/15\)/);
  });

  it("runs offline eval against gold labels", async () => {
    const { code, out, err } = await run(["eval"], { OPENAI_API_KEY: "" });
    expect(code).toBe(0);
    expect(err).toMatch(/keyword baseline/i);
    expect(out).toMatch(/100\.0% \(9\/9\)/);
    expect(out).toMatch(/Not Jev/);
  });

  it("decide writes typed answers from a fake gateway", async () => {
    const dir = await mkdtemp(join(tmpdir(), "keepdrop-"));
    const qpath = join(dir, "q.json");
    await writeFile(
      qpath,
      JSON.stringify({
        urgent: { type: "noul", instructions: "The message conveys urgency" },
      }),
      "utf8",
    );

    const server = await startStub();
    try {
      const { code, out } = await run(
        ["decide", "--state", "charged twice, please help ASAP", "--questions", qpath],
        {
          OPENAI_API_KEY: "stub",
          OPENAI_BASE_URL: `http://127.0.0.1:${server.port}/v1`,
          OPENAI_MODEL: "stub-model",
        },
      );
      expect(code).toBe(0);
      expect(out).toMatch(/"noul"/);
      expect(out).toMatch(/Not Jev/);
    } finally {
      await server.close();
    }
  });
});

async function startStub(): Promise<{ port: number; close: () => Promise<void> }> {
  const { createServer } = await import("node:http");
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => {
      body += String(c);
    });
    req.on("end", () => {
      void body;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  urgent: { type: "noul", noul: 0.87, confidence: 0.55 },
                }),
              },
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 8 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  return {
    port: addr.port,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
