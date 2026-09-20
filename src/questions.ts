import type { ChoiceQuestion, NoulQuestion, Question, ScoreQuestion } from "./types.js";

export function noul(instructions: string): NoulQuestion {
  const text = instructions.trim();
  if (!text) throw new Error("noul instructions must be non-empty");
  return { type: "noul", instructions: text };
}

export function choice(
  instructions: string,
  options: Record<string, string | null>,
): ChoiceQuestion {
  const text = instructions.trim();
  if (!text) throw new Error("choice instructions must be non-empty");
  const keys = Object.keys(options);
  if (keys.length < 2) throw new Error("choice needs at least 2 options");
  if (keys.length > 255) throw new Error("choice supports at most 255 options");
  for (const key of keys) {
    if (!/^[A-Za-z0-9_-]+$/.test(key)) {
      throw new Error(`choice option key is not a safe id: ${key}`);
    }
  }
  return { type: "choice", instructions: text, options: { ...options } };
}

export function score(instructions: string, levels: string[]): ScoreQuestion {
  const text = instructions.trim();
  if (!text) throw new Error("score instructions must be non-empty");
  if (levels.length < 2 || levels.length > 10) {
    throw new Error("score needs 2 to 10 levels");
  }
  if (levels.some((level) => !level.trim())) {
    throw new Error("score levels must be non-empty");
  }
  return { type: "score", instructions: text, levels: [...levels] };
}

export function assertQuestionMap(questions: Record<string, Question>): string[] {
  const ids = Object.keys(questions);
  if (ids.length === 0) throw new Error("at least one question is required");
  for (const id of ids) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(id)) {
      throw new Error(`question id is not a safe identifier: ${id}`);
    }
  }
  return ids;
}
