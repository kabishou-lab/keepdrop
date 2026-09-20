export interface ChatJsonOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface ChatJsonResponse {
  text: string;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  n_retries: number;
  response_format: "json_schema" | "json_object" | "prompt";
}

function normalizeBase(url: string): string {
  return url.replace(/\/+$/, "");
}

function chatUrl(baseUrl: string): string {
  const base = normalizeBase(baseUrl);
  return base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

function extractText(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const message = (choices[0] as { message?: { content?: unknown } }).message;
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .join("");
  }
  return "";
}

function usageOf(data: unknown): { input: number; output: number } {
  if (!data || typeof data !== "object") return { input: 0, output: 0 };
  const usage = (data as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
  return {
    input: typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : 0,
    output: typeof usage?.completion_tokens === "number" ? usage.completion_tokens : 0,
  };
}

function isUnsupportedFormat(status: number, body: string): boolean {
  if (status !== 400 && status !== 422) return false;
  const lower = body.toLowerCase();
  return (
    lower.includes("json_schema") ||
    lower.includes("response_format") ||
    lower.includes("schema") ||
    lower.includes("unknown") ||
    lower.includes("not support")
  );
}

async function post(
  url: string,
  apiKey: string,
  payload: Record<string, unknown>,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<{ status: number; json: unknown; text: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json: unknown = undefined;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    return { status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

const messagesOf = (system: string, user: string) => [
  { role: "system", content: system },
  { role: "user", content: user },
];

export async function chatJson(opts: ChatJsonOptions): Promise<ChatJsonResponse> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const url = chatUrl(opts.baseUrl);
  const started = Date.now();
  let nRetries = 0;

  const basePayload = {
    model: opts.model,
    temperature: 0,
    messages: messagesOf(opts.system, opts.user),
  };

  const schemaAttempt = {
    ...basePayload,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "system_one_answers",
        strict: true,
        schema: opts.schema,
      },
    },
  };

  let status = 0;
  let json: unknown;
  let text = "";
  let format: ChatJsonResponse["response_format"] = "json_schema";

  ({ status, json, text } = await post(url, opts.apiKey, schemaAttempt, timeoutMs, fetchImpl));

  if (status >= 400 && isUnsupportedFormat(status, text)) {
    nRetries += 1;
    format = "json_object";
    ({ status, json, text } = await post(
      url,
      opts.apiKey,
      { ...basePayload, response_format: { type: "json_object" } },
      timeoutMs,
      fetchImpl,
    ));
  }

  if (status >= 400 && isUnsupportedFormat(status, text)) {
    nRetries += 1;
    format = "prompt";
    ({ status, json, text } = await post(url, opts.apiKey, basePayload, timeoutMs, fetchImpl));
  }

  if (status >= 400) {
    throw new Error(`chat completions ${status}: ${text.slice(0, 500)}`);
  }

  const content = extractText(json);
  const usage = usageOf(json);
  return {
    text: content,
    input_tokens: usage.input,
    output_tokens: usage.output,
    latency_ms: Date.now() - started,
    n_retries: nRetries,
    response_format: format,
  };
}
