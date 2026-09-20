import { describe, expect, it } from "vitest";
import { decide } from "../src/client.js";
import { choice, noul, score } from "../src/questions.js";

function jsonResponse(payload: unknown, extra?: { prompt_tokens?: number; completion_tokens?: number }) {
  return {
    choices: [{ message: { content: JSON.stringify(payload) } }],
    usage: {
      prompt_tokens: extra?.prompt_tokens ?? 11,
      completion_tokens: extra?.completion_tokens ?? 7,
    },
  };
}

describe("decide", () => {
  it("parses noul/choice/score from json_schema", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify(
          jsonResponse({
            urgent: { type: "noul", noul: 0.91, confidence: 0.6 },
            team: {
              type: "choice",
              choice: "billing",
              probabilities: { billing: 0.8, auth: 0.2 },
              confidence: 0.7,
            },
            severity: {
              type: "score",
              score: 2.1,
              probabilities: [0.05, 0.1, 0.85],
              confidence: 0.5,
            },
          }),
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    const result = await decide(
      {
        state: "Customer charged twice on invoice 8812",
        questions: {
          urgent: noul("The message conveys urgency"),
          team: choice("Which team owns this?", { billing: "invoices", auth: "login" }),
          severity: score("How severe?", ["low", "mid", "high"]),
        },
      },
      { apiKey: "test", baseUrl: "https://example.test/v1", model: "dummy", fetchImpl },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.answers.urgent).toMatchObject({ type: "noul", noul: 0.91 });
    expect(result.answers.team).toMatchObject({ type: "choice", choice: "billing" });
    expect(result.answers.severity).toMatchObject({ type: "score" });
    expect(result.usage.input_tokens).toBe(11);
  });

  it("falls back to json_object when json_schema is rejected", async () => {
    let n = 0;
    const fetchImpl: typeof fetch = async (_url, init) => {
      n += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        response_format?: { type?: string };
      };
      if (n === 1) {
        expect(body.response_format?.type).toBe("json_schema");
        return new Response("json_schema not supported", { status: 400 });
      }
      expect(body.response_format?.type).toBe("json_object");
      return new Response(
        JSON.stringify(
          jsonResponse({
            flag: { type: "noul", noul: 0.2, confidence: 0.4 },
          }),
        ),
        { status: 200 },
      );
    };

    const result = await decide(
      { state: "hello", questions: { flag: noul("This is spam") } },
      { apiKey: "test", baseUrl: "https://example.test/v1", model: "dummy", fetchImpl },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.usage.n_retries).toBe(1);
    expect(result.usage.response_format).toBe("json_object");
    expect(result.answers.flag).toMatchObject({ noul: 0.2 });
  });

  it("returns ok:false on HTTP errors instead of throwing", async () => {
    const fetchImpl: typeof fetch = async () => new Response("nope", { status: 500 });
    const result = await decide(
      { state: "x", questions: { a: noul("true?") } },
      { apiKey: "test", baseUrl: "https://example.test/v1", model: "dummy", fetchImpl },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/500/);
  });

  it("picks the max-prob choice when the label is unknown", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify(
          jsonResponse({
            team: {
              type: "choice",
              choice: "not-a-key",
              probabilities: { billing: 0.1, auth: 0.9 },
              confidence: 0.3,
            },
          }),
        ),
        { status: 200 },
      );
    const result = await decide(
      {
        state: "login loop",
        questions: { team: choice("team?", { billing: null, auth: null }) },
      },
      { apiKey: "k", baseUrl: "https://example.test/v1", model: "m", fetchImpl },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.answers.team).toMatchObject({ type: "choice", choice: "auth" });
  });
});
