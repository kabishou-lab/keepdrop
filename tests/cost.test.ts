import { describe, expect, it } from "vitest";
import { formatUsd, usdJudge } from "../src/cost.js";

describe("usdJudge", () => {
  it("prices MiniMax-M3 list rates", () => {
    const usd = usdJudge(400_000, 50_000, { input: 0.3, output: 1.2 });
    expect(usd).toBeCloseTo(0.3 * 0.4 + 1.2 * 0.05, 8);
  });

  it("formats tiny judge costs", () => {
    expect(formatUsd(0)).toBe("$0");
    expect(formatUsd(0.000012)).toMatch(/^\$/);
  });
});
