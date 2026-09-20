import { describe, expect, it } from "vitest";
import { choice, noul, score } from "../src/questions.js";

describe("question builders", () => {
  it("builds noul", () => {
    expect(noul("The ticket is urgent")).toEqual({
      type: "noul",
      instructions: "The ticket is urgent",
    });
  });

  it("rejects empty noul", () => {
    expect(() => noul("  ")).toThrow(/non-empty/);
  });

  it("builds choice with 2+ options", () => {
    const q = choice("Which queue?", { billing: "invoices", auth: null });
    expect(q.options.billing).toBe("invoices");
    expect(q.options.auth).toBeNull();
  });

  it("rejects a single choice option", () => {
    expect(() => choice("Only one", { a: null })).toThrow(/at least 2/);
  });

  it("builds a 3-level score", () => {
    const q = score("Severity", ["low", "mid", "high"]);
    expect(q.levels).toEqual(["low", "mid", "high"]);
  });
});
