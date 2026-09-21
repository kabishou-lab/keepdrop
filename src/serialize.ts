import type { Message, Transcript } from "./types.js";

export function messageToJsonlLine(msg: Message): string {
  const row: Record<string, unknown> = {
    role: msg.role,
    content: msg.content ?? "",
  };
  if (msg.tool_calls?.length) row.tool_calls = msg.tool_calls;
  if (msg.tool_call_id) row.tool_call_id = msg.tool_call_id;
  if (msg.name) row.name = msg.name;
  return JSON.stringify(row);
}

export function toJsonl(transcript: Transcript): string {
  const lines = transcript.messages.map(messageToJsonlLine);
  return lines.join("\n") + (lines.length ? "\n" : "");
}

export function toKeepdropJson(
  transcript: Transcript,
  extra: Record<string, unknown> = {},
): string {
  return (
    JSON.stringify(
      {
        goal: transcript.goal ?? "",
        messages: transcript.messages,
        ...extra,
      },
      null,
      2,
    ) + "\n"
  );
}

export function wantsJsonl(outPath: string | undefined, format?: string): boolean {
  if (format === "jsonl") return true;
  if (format === "json") return false;
  return Boolean(outPath?.endsWith(".jsonl"));
}
