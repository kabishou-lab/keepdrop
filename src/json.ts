const THINK = /<think>[\s\S]*?<\/think>/gi;

export function stripThink(text: string): string {
  return text.replace(THINK, "").trim();
}

export function stripFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  return (fenced ? fenced[1] : trimmed).trim();
}

function firstBalancedObject(text: string): string | undefined {
  const start = text.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}

/** Pull the first JSON object out of model text that may include think tags or chatter. */
export function extractJsonObject(text: string): unknown {
  const cleaned = stripFences(stripThink(text));
  if (!cleaned) throw new Error("empty model text");
  try {
    return JSON.parse(cleaned);
  } catch {
    const blob = firstBalancedObject(cleaned);
    if (!blob) throw new Error("model did not return a JSON object");
    return JSON.parse(blob);
  }
}
