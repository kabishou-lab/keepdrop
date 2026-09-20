import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function applyEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const eq = line.indexOf("=");
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
}

/** Load `.env` from cwd then package root. Existing process env wins. */
export function loadEnv(): void {
  applyEnvFile(resolve(process.cwd(), ".env"));
  const here = dirname(fileURLToPath(import.meta.url));
  applyEnvFile(resolve(here, "../.env"));
}

export function looksLikeMiniMax(baseUrl: string, model: string): boolean {
  const hay = `${baseUrl} ${model}`.toLowerCase();
  return hay.includes("minimax") || hay.includes("minimaxi");
}
