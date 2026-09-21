import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { watchFile } from "../src/watch.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("watchFile", () => {
  it("fires after the file is rewritten", async () => {
    const dir = await mkdtemp(join(tmpdir(), "keepdrop-watch-"));
    const path = join(dir, "t.json");
    await writeFile(path, "{\"n\":1}\n", "utf8");
    let n = 0;
    const handle = watchFile(
      path,
      () => {
        n += 1;
      },
      { debounceMs: 40, pollMs: 50 },
    );
    await sleep(80);
    await writeFile(path, "{\"n\":2}\n", "utf8");
    await sleep(200);
    handle.close();
    expect(n).toBeGreaterThanOrEqual(1);
  });

  it("does not fire on markSelfWrite", async () => {
    const dir = await mkdtemp(join(tmpdir(), "keepdrop-watch-"));
    const path = join(dir, "t.json");
    await writeFile(path, "{\"n\":1}\n", "utf8");
    let n = 0;
    const handle = watchFile(
      path,
      () => {
        n += 1;
      },
      { debounceMs: 40, pollMs: 50 },
    );
    await sleep(80);
    await handle.markSelfWrite();
    await writeFile(path, "{\"n\":2}\n", "utf8");
    await handle.markSelfWrite();
    await sleep(200);
    handle.close();
    expect(n).toBe(0);
  });
});
