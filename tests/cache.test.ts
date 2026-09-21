import { describe, expect, it } from "vitest";
import { compactTranscript, type CachedJudgment } from "../src/compact.js";
import type { DecideResult, Message, Transcript } from "../src/types.js";

function sample(): Transcript {
  const messages: Message[] = [{ role: "user", content: "fix tests" }];
  for (const id of ["c1", "c2", "c3"]) {
    messages.push({
      role: "assistant",
      content: id,
      tool_calls: [{ id, name: "bash", arguments: id }],
    });
    messages.push({ role: "tool", tool_call_id: id, content: `ok ${id}` });
  }
  messages.push({ role: "assistant", content: "done" });
  return { messages };
}

function keepAll(): DecideResult {
  const answers: DecideResult extends { ok: true; answers: infer A } ? A : never = {};
  for (let i = 0; i < 8; i++) {
    answers[`call${i}`] = { type: "noul", noul: 0.9, confidence: 0.8 };
    answers[`result${i}`] = { type: "noul", noul: 0.9, confidence: 0.8 };
  }
  return {
    ok: true,
    model: "fake",
    raw: "{}",
    answers,
    usage: {
      input_tokens: 3,
      output_tokens: 1,
      latency_ms: 1,
      n_retries: 0,
      response_format: "prompt",
    },
  };
}

describe("judgment cache", () => {
  it("skips the judge on a second pass over unchanged keep pairs", async () => {
    const cache = new Map<string, CachedJudgment>();
    let calls = 0;
    const judge = async (): Promise<DecideResult> => {
      calls += 1;
      return keepAll();
    };
    const t = sample();
    const first = await compactTranscript(t, { recent: 2, cache, judge });
    expect(first.stats.fail_open).toBe(false);
    expect(first.stats.keep).toBeGreaterThan(0);
    expect(calls).toBe(1);
    const n = calls;
    const second = await compactTranscript(t, { recent: 2, cache, judge });
    expect(calls).toBe(n);
    expect(second.stats.skipped_cached).toBe(first.stats.eligible);
    expect(second.stats.input_tokens).toBe(0);
  });

  it("honors maxNew and leaves the rest pending", async () => {
    let calls = 0;
    const judge = async (): Promise<DecideResult> => {
      calls += 1;
      return keepAll();
    };
    const first = await compactTranscript(sample(), { recent: 2, maxNew: 1, pairChunk: 1, judge });
    expect(first.stats.pending).toBeGreaterThan(0);
    expect(first.stats.keep + first.stats.drop + first.stats.drop_result).toBe(1);
    expect(calls).toBe(1);
  });
});
