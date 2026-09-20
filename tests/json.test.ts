import { describe, expect, it } from "vitest";
import { extractJsonObject, stripThink } from "../src/json.js";
import { extractText } from "../src/openai.js";

describe("json extract", () => {
  it("strips think tags", () => {
    expect(stripThink("<think>secret chain</think>\n{\"a\":1}")).toBe('{"a":1}');
  });

  it("parses fenced JSON", () => {
    expect(extractJsonObject("```json\n{\"noul\":0.2}\n```")).toEqual({ noul: 0.2 });
  });

  it("parses JSON buried in chatter", () => {
    const text = "<think>hmm</think>\nSure.\n{\"urgent\":{\"type\":\"noul\",\"noul\":0.8,\"confidence\":0.4}}\n";
    expect(extractJsonObject(text)).toMatchObject({
      urgent: { type: "noul", noul: 0.8 },
    });
  });

  it("takes the first object when the model appends a second blob", () => {
    const text =
      '{"urgent":{"type":"noul","noul":0.8,"confidence":0.4}}\n{"note":"extra"}';
    expect(extractJsonObject(text)).toEqual({
      urgent: { type: "noul", noul: 0.8, confidence: 0.4 },
    });
  });
});

describe("MiniMax-shaped payloads", () => {
  it("reads reasoning_content when content is empty", () => {
    const text = extractText({
      choices: [
        {
          message: {
            content: "",
            reasoning_content: "<think>plan</think>{\"flag\":{\"type\":\"noul\",\"noul\":0.1,\"confidence\":0.2}}",
          },
        },
      ],
    });
    expect(text).toContain('"noul":0.1');
    expect(text).not.toContain("<think>");
  });
});
