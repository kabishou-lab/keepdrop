import { rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export async function atomicWrite(path: string, body: string): Promise<void> {
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  await writeFile(tmp, body, "utf8");
  await rename(tmp, path);
}
