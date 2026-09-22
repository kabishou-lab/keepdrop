import type { Message, Role, ToolCall, Transcript } from "./types.js";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : JSON.stringify(content);
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      const rec = asRecord(part);
      if (!rec) return "";
      if (typeof rec.text === "string") return rec.text;
      if (typeof rec.content === "string") return rec.content;
      if (rec.type === "tool_result") return textFromContent(rec.content);
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function toolCallsFromContent(content: unknown): ToolCall[] {
  if (!Array.isArray(content)) return [];
  const calls: ToolCall[] = [];
  for (const part of content) {
    const rec = asRecord(part);
    if (!rec) continue;
    if (rec.type !== "tool_use" && rec.type !== "tool_call" && rec.type !== "toolCall") continue;
    const id = typeof rec.id === "string" ? rec.id : typeof rec.toolCallId === "string" ? rec.toolCallId : "";
    const name = typeof rec.name === "string" ? rec.name : "tool";
    if (!id) continue;
    const input = rec.input ?? rec.arguments ?? rec.args;
    calls.push({
      id,
      name,
      arguments: typeof input === "string" ? input : JSON.stringify(input ?? {}),
    });
  }
  return calls;
}

function toolResultsFromContent(content: unknown): Message[] {
  if (!Array.isArray(content)) return [];
  const out: Message[] = [];
  for (const part of content) {
    const rec = asRecord(part);
    if (!rec) continue;
    if (rec.type !== "tool_result" && rec.type !== "toolResult") continue;
    const id =
      (typeof rec.tool_use_id === "string" && rec.tool_use_id) ||
      (typeof rec.tool_call_id === "string" && rec.tool_call_id) ||
      (typeof rec.toolCallId === "string" && rec.toolCallId) ||
      "";
    out.push({
      role: "tool",
      tool_call_id: id || undefined,
      content: textFromContent(rec.content ?? rec.text ?? rec),
    });
  }
  return out;
}

function roleOf(value: unknown): Role | undefined {
  if (value === "system" || value === "user" || value === "assistant" || value === "tool") {
    return value;
  }
  return undefined;
}

function messageFromUnknown(raw: unknown): Message[] {
  const rec = asRecord(raw);
  if (!rec) return [];
  const inner = asRecord(rec.message) ?? rec;
  const contentNode = inner.content ?? inner.text;
  const toolCallIdEarly =
    (typeof inner.toolCallId === "string" && inner.toolCallId) ||
    (typeof inner.tool_call_id === "string" && inner.tool_call_id) ||
    (typeof inner.tool_use_id === "string" && inner.tool_use_id) ||
    "";
  if (inner.role === "toolResult" || rec.type === "toolResult") {
    return [
      {
        role: "tool",
        tool_call_id: toolCallIdEarly || undefined,
        content: textFromContent(contentNode),
      },
    ];
  }
  const role = roleOf(inner.role) ?? (rec.type === "assistant" ? "assistant" : rec.type === "tool" ? "tool" : rec.type === "user" || rec.type === "human" ? "user" : undefined);
  if (!role) return [];

  const toolCalls =
    (Array.isArray(inner.tool_calls) ? (inner.tool_calls as unknown[]) : [])
      .map((c) => {
        const t = asRecord(c);
        if (!t) return undefined;
        const fn = asRecord(t.function);
        const id = typeof t.id === "string" ? t.id : "";
        const name =
          (typeof t.name === "string" && t.name) ||
          (typeof fn?.name === "string" && fn.name) ||
          "tool";
        const args = t.arguments ?? fn?.arguments ?? t.input;
        if (!id) return undefined;
        return {
          id,
          name,
          arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}),
        } satisfies ToolCall;
      })
      .filter((c): c is ToolCall => Boolean(c))
      .concat(toolCallsFromContent(contentNode));

  if (role === "user") {
    const results = toolResultsFromContent(contentNode);
    if (results.length) return results;
  }

  const msg: Message = {
    role,
    content: textFromContent(contentNode),
  };
  const toolCallId =
    (typeof inner.tool_call_id === "string" && inner.tool_call_id) ||
    (typeof inner.tool_use_id === "string" && inner.tool_use_id) ||
    "";
  if (toolCallId) msg.tool_call_id = toolCallId;
  if (typeof inner.name === "string") msg.name = inner.name;
  if (toolCalls.length) msg.tool_calls = toolCalls;
  return [msg];
}

function fromParsed(value: unknown): Transcript | undefined {
  const rec = asRecord(value);
  if (rec && Array.isArray(rec.messages)) {
    return {
      goal: typeof rec.goal === "string" ? rec.goal : undefined,
      messages: rec.messages.flatMap(messageFromUnknown),
    };
  }
  if (Array.isArray(value)) {
    return { messages: value.flatMap(messageFromUnknown) };
  }
  const one = messageFromUnknown(value);
  if (one.length) return { messages: one };
  return undefined;
}

export function parseTranscriptText(text: string): Transcript {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("empty transcript");
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const t = fromParsed(parsed);
    if (t && t.messages.length) return t;
  } catch {
    // JSONL below
  }
  const messages: Message[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    const row = line.trim();
    if (!row) continue;
    try {
      messages.push(...messageFromUnknown(JSON.parse(row)));
    } catch {
      throw new Error(`not JSON or JSONL: ${row.slice(0, 80)}`);
    }
  }
  if (!messages.length) throw new Error("no messages parsed");
  return { messages };
}
