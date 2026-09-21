import { chatJson } from "./openai.js";
import { loadEnv } from "./env.js";
import { extractJsonObject } from "./json.js";
import { assertQuestionMap } from "./questions.js";
import type {
  Answer,
  ChoiceAnswer,
  DecideErr,
  DecideResult,
  NoulAnswer,
  Question,
  ScoreAnswer,
} from "./types.js";

export interface DecideOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

export function resolveConfig(opts: DecideOptions = {}): {
  apiKey: string;
  baseUrl: string;
  model: string;
} {
  loadEnv();
  const apiKey = opts.apiKey ?? env("OPENAI_API_KEY");
  const baseUrl = opts.baseUrl ?? env("OPENAI_BASE_URL") ?? "https://api.minimaxi.com/v1";
  const model = opts.model ?? env("OPENAI_MODEL") ?? "MiniMax-M3";
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing (OpenAI-compatible key, not TypeSafe)");
  }
  return { apiKey, baseUrl, model };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function normalizeDist(dist: Record<string, number>): Record<string, number> {
  const keys = Object.keys(dist);
  const sum = keys.reduce((acc, key) => acc + dist[key], 0);
  if (sum <= 0) {
    const even = 1 / Math.max(keys.length, 1);
    return Object.fromEntries(keys.map((key) => [key, even]));
  }
  return Object.fromEntries(keys.map((key) => [key, dist[key] / sum]));
}

function unwrapAnswers(parsed: unknown, ids: string[]): Record<string, unknown> {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("model did not return a JSON object");
  }
  const bag = parsed as Record<string, unknown>;
  if (ids.every((id) => id in bag)) return bag;
  const inner = bag.answers;
  if (inner && typeof inner === "object") return inner as Record<string, unknown>;
  return bag;
}

function buildSchema(questions: Record<string, Question>): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [id, q] of Object.entries(questions)) {
    required.push(id);
    if (q.type === "noul") {
      properties[id] = {
        type: "object",
        additionalProperties: false,
        required: ["type", "noul", "confidence"],
        properties: {
          type: { type: "string", enum: ["noul"] },
          noul: { type: "number" },
          confidence: { type: "number" },
        },
      };
    } else if (q.type === "choice") {
      const keys = Object.keys(q.options);
      properties[id] = {
        type: "object",
        additionalProperties: false,
        required: ["type", "choice", "probabilities", "confidence"],
        properties: {
          type: { type: "string", enum: ["choice"] },
          choice: { type: "string", enum: keys },
          probabilities: {
            type: "object",
            additionalProperties: false,
            required: keys,
            properties: Object.fromEntries(keys.map((key) => [key, { type: "number" }])),
          },
          confidence: { type: "number" },
        },
      };
    } else {
      properties[id] = {
        type: "object",
        additionalProperties: false,
        required: ["type", "score", "probabilities", "confidence"],
        properties: {
          type: { type: "string", enum: ["score"] },
          score: { type: "number" },
          probabilities: {
            type: "array",
            minItems: q.levels.length,
            maxItems: q.levels.length,
            items: { type: "number" },
          },
          confidence: { type: "number" },
        },
      };
    }
  }
  return {
    type: "object",
    additionalProperties: false,
    required,
    properties,
  };
}

function renderQuestions(questions: Record<string, Question>): string {
  const lines: string[] = [];
  for (const [id, q] of Object.entries(questions)) {
    if (q.type === "noul") {
      lines.push(`- ${id} (noul): probability that this is TRUE: ${q.instructions}`);
    } else if (q.type === "choice") {
      const opts = Object.entries(q.options)
        .map(([key, desc]) => `${key}${desc ? ` = ${desc}` : ""}`)
        .join("; ");
      lines.push(`- ${id} (choice): ${q.instructions} | options: ${opts}`);
    } else {
      lines.push(
        `- ${id} (score): ${q.instructions} | levels[0..${q.levels.length - 1}]: ${q.levels.join(" | ")}`,
      );
    }
  }
  return lines.join("\n");
}

function renderState(state: unknown): string {
  if (typeof state === "string") return state;
  return JSON.stringify(state, null, 2);
}

function parseAnswer(id: string, q: Question, raw: unknown): Answer {
  if (q.type === "noul" && (typeof raw === "number" || typeof raw === "boolean" || typeof raw === "string")) {
    const n = typeof raw === "boolean" ? (raw ? 1 : 0) : asNumber(raw);
    if (!Number.isFinite(n)) throw new Error(`${id}: noul is not a number`);
    return { type: "noul", noul: clamp01(n as number), confidence: 0.5 };
  }
  if (!raw || typeof raw !== "object") {
    throw new Error(`${id}: missing object`);
  }
  const rec = raw as Record<string, unknown>;
  const confidence = clamp01(asNumber(rec.confidence) ?? 0.5);

  if (q.type === "noul") {
    const rawNoul =
      typeof rec.noul === "boolean"
        ? rec.noul
          ? 1
          : 0
        : (asNumber(rec.noul) ?? asNumber(rec.probability) ?? asNumber(rec.value));
    const noul = clamp01(rawNoul ?? Number.NaN);
    if (!Number.isFinite(rawNoul)) throw new Error(`${id}: noul is not a number`);
    const answer: NoulAnswer = { type: "noul", noul, confidence };
    return answer;
  }

  if (q.type === "choice") {
    const keys = Object.keys(q.options);
    let picked = typeof rec.choice === "string" ? rec.choice : "";
    const probsRaw =
      rec.probabilities && typeof rec.probabilities === "object"
        ? (rec.probabilities as Record<string, unknown>)
        : {};
    const dist: Record<string, number> = {};
    for (const key of keys) {
      dist[key] = clamp01(asNumber(probsRaw[key]) ?? 0);
    }
    const probabilities = normalizeDist(dist);
    if (!keys.includes(picked)) {
      picked = keys.reduce((best, key) =>
        probabilities[key] > probabilities[best] ? key : best,
      );
    }
    const answer: ChoiceAnswer = { type: "choice", choice: picked, probabilities, confidence };
    return answer;
  }

  const levels = q.levels.length;
  let probs: number[] = [];
  if (Array.isArray(rec.probabilities)) {
    probs = rec.probabilities.map((p) => clamp01(asNumber(p) ?? 0));
  }
  while (probs.length < levels) probs.push(0);
  probs = probs.slice(0, levels);
  const sum = probs.reduce((a, b) => a + b, 0);
  const probabilities = sum > 0 ? probs.map((p) => p / sum) : probs.map(() => 1 / levels);
  let score = asNumber(rec.score);
  if (score === undefined) {
    score = probabilities.reduce((acc, p, i) => acc + p * i, 0);
  }
  if (score < 0) score = 0;
  if (score > levels - 1) score = levels - 1;
  const answer: ScoreAnswer = { type: "score", score, probabilities, confidence };
  return answer;
}

const SYSTEM = `You are a System One decision function, not a chatbot.
Answer every question about STATE. Return one JSON object and nothing else.
Never write prose, markdown, code fences, or <think> tags.
noul = probability the statement is true, 0 to 1.
choice.choice must be one option key; probabilities must cover every option.
score is a real number on 0..N-1; probabilities[i] is the mass on levels[i].
confidence is how sure you are of your own answer, 0 to 1.
These numbers are ordinary model estimates, not calibrated lab probabilities.`;

export async function decide(
  input: { state: unknown; questions: Record<string, Question> },
  opts: DecideOptions = {},
): Promise<DecideResult> {
  try {
    const ids = assertQuestionMap(input.questions);
    const cfg = resolveConfig(opts);
    const schema = buildSchema(input.questions);
    const user = `STATE:\n${renderState(input.state)}\n\nQUESTIONS:\n${renderQuestions(input.questions)}`;
    const chat = await chatJson({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      system: SYSTEM,
      user,
      schema,
      timeoutMs: opts.timeoutMs,
      fetchImpl: opts.fetchImpl,
    });
    let parsed: unknown;
    try {
      parsed = extractJsonObject(chat.text);
    } catch (err) {
      const hint = (chat.text || "").replace(/\s+/g, " ").slice(0, 180);
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `${msg}${hint ? `: ${hint}` : ""}`, raw: chat.text };
    }
    const bag = unwrapAnswers(parsed, ids);
    const answers: Record<string, Answer> = {};
    for (const id of ids) {
      const raw = bag[id] ?? bag[id.replace(/-/g, "_")];
      try {
        answers[id] = parseAnswer(id, input.questions[id], raw);
      } catch (err) {
        const keys = Object.keys(bag).join(",");
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`${msg}; model keys=[${keys}]`);
      }
    }
    return {
      ok: true,
      answers,
      model: cfg.model,
      raw: chat.text,
      usage: {
        input_tokens: chat.input_tokens,
        output_tokens: chat.output_tokens,
        latency_ms: chat.latency_ms,
        n_retries: chat.n_retries,
        response_format: chat.response_format,
      },
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const fail: DecideErr = { ok: false, error };
    return fail;
  }
}
