import { loadEnv } from "./env.js";

/** Official MiniMax-M3 standard tier (USD / million tokens), ≤512k input. Override via env. */
export const DEFAULT_INPUT_USD_PER_MTOK = 0.3;
export const DEFAULT_OUTPUT_USD_PER_MTOK = 1.2;

function envNum(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function pricePerMtok(): { input: number; output: number } {
  loadEnv();
  return {
    input: envNum("OPENAI_INPUT_USD_PER_MTOK") ?? DEFAULT_INPUT_USD_PER_MTOK,
    output: envNum("OPENAI_OUTPUT_USD_PER_MTOK") ?? DEFAULT_OUTPUT_USD_PER_MTOK,
  };
}

export function usdJudge(inputTokens: number, outputTokens: number, price = pricePerMtok()): number {
  return (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
}

/** Hypothetical: dropped transcript tokens billed as the next coding-model prompt. */
export function coderUsdPerMtok(): number {
  loadEnv();
  return envNum("OPENAI_CODER_USD_PER_MTOK") ?? 2;
}

export function usdSaved(
  tokensBefore: number,
  tokensAfter: number,
  coderPerM = coderUsdPerMtok(),
): number {
  return (Math.max(0, tokensBefore - tokensAfter) / 1_000_000) * coderPerM;
}

export function formatUsd(n: number): string {
  if (n === 0) return "$0";
  if (n < 0.0001) return `$${n.toExponential(1)}`;
  if (n < 0.01) return `$${n.toFixed(5)}`;
  return `$${n.toFixed(4)}`;
}
