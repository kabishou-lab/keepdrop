import { describe, expect, it } from "vitest";
import { compactTranscript } from "../src/compact.js";
import type { DecideResult, Message, Transcript } from "../src/types.js";

function manyPairs(n: number): Transcript {
  const messages: Message[] = [{ role: "user", content: "fix it" }];
  for (let i = 0; i < n; i++) {
    messages.push({
      role: "assistant",
      content: `step ${i}`,
      tool_calls: [{ id: `c${i}`, name: "bash", arguments: `cmd ${i}` }],
    });
    messages.push({ role: "tool", tool_call_id: `c${i}`, content: `out ${i}` });
  }
  messages.push({ role: "assistant", content: "done" });
  return { messages };
}

describe("pairChunk", () => {
  it("splits a long pair list across judge calls", async () => {
    const calls: number[] = [];
    const judge = async (_state: string, qs: Record<string, unknown>): Promise<DecideResult> => {
      calls.push(Object.keys(qs).length);
      const answers: DecideResult extends { ok: true; answers: infer A } ? A : never = {};
      for (const id of Object.keys(qs)) {
        answers[id] = { type: "noul", noul: 0.9, confidence: 0.8 };
      }
      return {
        ok: true,
        model: "fake",
        raw: "{}",
        answers,
        usage: {
          input_tokens: 10,
          output_tokens: 4,
          latency_ms: 2,
          n_retries: 0,
          response_format: "json_object",
        },
      };
    };
    const result = await compactTranscript(manyPairs(10), {
      recent: 2,
      pairChunk: 3,
      judge,
    });
    expect(result.stats.fail_open).toBe(false);
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.reduce((a, b) => a + b, 0)).toBe(result.stats.eligible * 2);
    expect(result.stats.input_tokens).toBe(10 * calls.length);
    expect(result.stats.usd_judge).toBeGreaterThan(0);
  });
});
