import { readFile } from "node:fs/promises";
import { atomicWrite } from "./fsx.js";
import type { CachedJudgment } from "./compact.js";

export async function loadCacheFile(path: string): Promise<Map<string, CachedJudgment>> {
  const map = new Map<string, CachedJudgment>();
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!raw || typeof raw !== "object") return map;
    for (const [key, value] of Object.entries(raw as Record<string, CachedJudgment>)) {
      if (!value || typeof value !== "object") continue;
      if (value.action !== "keep" && value.action !== "drop" && value.action !== "drop_result") {
        continue;
      }
      map.set(key, {
        action: value.action,
        keep_call: Number(value.keep_call) || 0,
        keep_result: Number(value.keep_result) || 0,
        confidence_call: Number(value.confidence_call) || 0,
        confidence_result: Number(value.confidence_result) || 0,
      });
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw err;
  }
  return map;
}

export async function saveCacheFile(
  path: string,
  cache: Map<string, CachedJudgment>,
): Promise<void> {
  const obj = Object.fromEntries(cache.entries());
  await atomicWrite(path, JSON.stringify(obj, null, 2) + "\n");
}
