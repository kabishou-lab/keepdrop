import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { compactTranscript } from "../src/compact.js";
import { parseTranscriptText } from "../src/ingest.js";
import { keywordJudge } from "../src/run-eval.js";
import { toJsonl, wantsJsonl } from "../src/serialize.js";
import type { Transcript } from "../src/types.js";

describe("serialize jsonl", () => {
  it("round-trips a compacted long log", async () => {
    const raw = await readFile("fixtures/transcript.long.json", "utf8");
    const t = JSON.parse(raw) as Transcript;
    const first = await compactTranscript(t, { recent: 6, judge: keywordJudge });
    const jsonl = toJsonl({ goal: t.goal, messages: first.messages });
    expect(jsonl.split("\n").filter(Boolean).length).toBe(first.messages.length);
    const back = parseTranscriptText(jsonl);
    expect(back.messages).toHaveLength(first.messages.length);
    const second = await compactTranscript(back, { recent: 6, judge: keywordJudge });
    expect(second.stats.skipped_sealed).toBe(first.stats.drop + first.stats.drop_result);
    expect(second.stats.eligible).toBe(first.stats.keep);
  });

  it("detects jsonl outputs", () => {
    expect(wantsJsonl("out.jsonl")).toBe(true);
    expect(wantsJsonl("out.json")).toBe(false);
    expect(wantsJsonl("out.json", "jsonl")).toBe(true);
  });
});
