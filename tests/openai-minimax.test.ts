import { describe, expect, it } from "vitest";
import { decide } from "../src/client.js";
import { noul } from "../src/questions.js";

describe("MiniMax path", () => {
  it("skips json_schema and accepts json_object", async () => {
    const types: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        reasoning_split?: boolean;
        response_format?: { type?: string };
      };
      types.push(body.response_format?.type ?? "none");
      expect(body.reasoning_split).toBe(true);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  flag: { type: "noul", noul: 0.33, confidence: 0.4 },
                }),
              },
            },
          ],
          usage: { prompt_tokens: 9, completion_tokens: 4 },
        }),
        { status: 200 },
      );
    };

    const result = await decide(
      { state: "x", questions: { flag: noul("true?") } },
      {
        apiKey: "k",
        baseUrl: "https://api.minimaxi.com/v1",
        model: "MiniMax-M3",
        fetchImpl,
      },
    );
    expect(result.ok).toBe(true);
    expect(types[0]).toBe("json_object");
    expect(types).not.toContain("json_schema");
    if (!result.ok) return;
    expect(result.answers.flag).toMatchObject({ noul: 0.33 });
  });

  it("falls back to prompt if json_object is rejected", async () => {
    let n = 0;
    const fetchImpl: typeof fetch = async (_url, init) => {
      n += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        response_format?: { type?: string };
      };
      if (n === 1) {
        expect(body.response_format?.type).toBe("json_object");
        return new Response("invalid response_format", { status: 400 });
      }
      expect(body.response_format).toBeUndefined();
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                reasoning_content:
                  "<think>ok</think>{\"flag\":{\"type\":\"noul\",\"noul\":0.7,\"confidence\":0.5}}",
              },
            },
          ],
        }),
        { status: 200 },
      );
    };

    const result = await decide(
      { state: "x", questions: { flag: noul("true?") } },
      {
        apiKey: "k",
        baseUrl: "https://api.minimaxi.com/v1",
        model: "MiniMax-M3",
        fetchImpl,
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.usage.n_retries).toBe(1);
    expect(result.answers.flag).toMatchObject({ noul: 0.7 });
  });
});
