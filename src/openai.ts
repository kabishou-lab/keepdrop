import { looksLikeMiniMax } from "./env.js";
import { stripThink } from "./json.js";

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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        const rec = asRecord(part);
        if (rec && typeof rec.text === "string") return rec.text;
        return "";
      })
      .join("");
  }
  return "";
}

export function extractText(data: unknown): string {
  const root = asRecord(data);
  const choices = root?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const message = asRecord(asRecord(choices[0])?.message);
  if (!message) return "";
  const parts = [
    contentToText(message.content),
    contentToText(message.reasoning_content),
    contentToText(message.reasoning),
  ];
  return stripThink(parts.filter(Boolean).join("\n"));
}

function usageOf(data: unknown): { input: number; output: number } {
  const usage = asRecord(asRecord(data)?.usage);
  return {
    input: typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : 0,
    output: typeof usage?.completion_tokens === "number" ? usage.completion_tokens : 0,
  };
}

function shouldFallbackFormat(status: number): boolean {
  return status === 400 || status === 404 || status === 415 || status === 422;
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
  const minimax = looksLikeMiniMax(opts.baseUrl, opts.model);
  const timeoutMs = opts.timeoutMs ?? (minimax ? 90_000 : 30_000);
  const url = chatUrl(opts.baseUrl);
  const started = Date.now();
  let nRetries = 0;

  const basePayload: Record<string, unknown> = {
    model: opts.model,
    temperature: 0,
    max_tokens: 2048,
    messages: messagesOf(opts.system, opts.user),
  };
  if (minimax) basePayload.reasoning_split = true;

  const attempts: { format: ChatJsonResponse["response_format"]; payload: Record<string, unknown> }[] =
    minimax
      ? [
          {
            format: "json_object",
            payload: { ...basePayload, response_format: { type: "json_object" } },
          },
          { format: "prompt", payload: basePayload },
        ]
      : [
          {
            format: "json_schema",
            payload: {
              ...basePayload,
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: "system_one_answers",
                  strict: true,
                  schema: opts.schema,
                },
              },
            },
          },
          {
            format: "json_object",
            payload: { ...basePayload, response_format: { type: "json_object" } },
          },
          { format: "prompt", payload: basePayload },
        ];

  let status = 0;
  let json: unknown;
  let text = "";
  let format: ChatJsonResponse["response_format"] = attempts[0].format;

  for (let i = 0; i < attempts.length; i++) {
    format = attempts[i].format;
    ({ status, json, text } = await post(url, opts.apiKey, attempts[i].payload, timeoutMs, fetchImpl));
    if (status < 400) break;
    if (i < attempts.length - 1 && shouldFallbackFormat(status)) {
      nRetries += 1;
      continue;
    }
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
