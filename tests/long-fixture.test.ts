import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { compactTranscript, messageChars } from "../src/compact.js";
import { keywordJudge } from "../src/run-eval.js";
import type { Transcript } from "../src/types.js";

describe("long transcript fixture", () => {
  const path = resolve("fixtures/transcript.long.json");

  it("is a fat coding-agent session, not a medical dump", async () => {
    const raw = await readFile(path, "utf8");
    expect(raw.toLowerCase()).not.toMatch(/病历|曜堂|hemorrhage|casualty/);
    const t = JSON.parse(raw) as Transcript;
    const chars = messageChars(t.messages);
    expect(chars).toBeGreaterThan(20_000);
    const info = await stat(path);
    expect(info.size).toBeGreaterThan(20_000);
  });

  it("keyword compact drops a visible fraction of the log", async () => {
    const t = JSON.parse(await readFile(path, "utf8")) as Transcript;
    const result = await compactTranscript(t, {
      recent: 6,
      truncateChars: 300,
      judge: keywordJudge,
    });
    expect(result.stats.fail_open).toBe(false);
    expect(result.stats.eligible).toBeGreaterThan(8);
    expect(result.stats.drop + result.stats.drop_result).toBeGreaterThan(4);
    const ratio = result.stats.chars_after / result.stats.chars_before;
    expect(ratio).toBeLessThan(0.7);
  });
});
