import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCacheFile, saveCacheFile } from "../src/cache-file.js";
import type { CachedJudgment } from "../src/compact.js";

describe("cache file", () => {
  it("round-trips judgments and treats missing files as empty", async () => {
    const dir = await mkdtemp(join(tmpdir(), "keepdrop-cache-"));
    const path = join(dir, "c.json");
    const empty = await loadCacheFile(path);
    expect(empty.size).toBe(0);
    const map = new Map<string, CachedJudgment>([
      [
        "abc",
        {
          action: "keep",
          keep_call: 0.9,
          keep_result: 0.8,
          confidence_call: 0.7,
          confidence_result: 0.6,
        },
      ],
    ]);
    await saveCacheFile(path, map);
    const loaded = await loadCacheFile(path);
    expect(loaded.get("abc")).toMatchObject({ action: "keep", keep_call: 0.9 });
  });
});
