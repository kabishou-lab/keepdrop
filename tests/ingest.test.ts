import { describe, expect, it } from "vitest";
import { parseTranscriptText } from "../src/ingest.js";

describe("parseTranscriptText", () => {
  it("reads keepdrop JSON", () => {
    const t = parseTranscriptText(
      JSON.stringify({
        goal: "fix",
        messages: [
          { role: "user", content: "hi" },
          {
            role: "assistant",
            content: "run",
            tool_calls: [{ id: "c1", name: "bash", arguments: "ls" }],
          },
          { role: "tool", tool_call_id: "c1", content: "ok" },
        ],
      }),
    );
    expect(t.goal).toBe("fix");
    expect(t.messages).toHaveLength(3);
    expect(t.messages[1].tool_calls?.[0].id).toBe("c1");
  });

  it("reads Claude Code JSONL tool_use / tool_result", () => {
    const jsonl = [
      JSON.stringify({
        type: "user",
        message: { role: "user", content: "fix /health" },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "looking" },
            { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } },
          ],
        },
      }),
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "src\nREADME.md" }],
        },
      }),
    ].join("\n");
    const t = parseTranscriptText(jsonl);
    expect(t.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
    expect(t.messages[1].tool_calls?.[0]).toMatchObject({ id: "toolu_1", name: "Bash" });
    expect(t.messages[2].tool_call_id).toBe("toolu_1");
    expect(t.messages[2].content).toMatch(/README/);
  });
});
