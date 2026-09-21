import { readFile, writeFile } from "node:fs/promises";
import { toJsonl } from "../src/serialize.js";
import type { Transcript } from "../src/types.js";

const t = JSON.parse(await readFile("fixtures/transcript.long.json", "utf8")) as Transcript;
const jsonl = toJsonl(t);
await writeFile("fixtures/transcript.long.jsonl", jsonl, "utf8");
process.stdout.write(`wrote fixtures/transcript.long.jsonl lines=${jsonl.trim().split("\n").length}\n`);
