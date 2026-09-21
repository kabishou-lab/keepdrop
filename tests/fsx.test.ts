import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { atomicWrite } from "../src/fsx.js";

describe("atomicWrite", () => {
  it("replaces the destination with the new body", async () => {
    const dir = await mkdtemp(join(tmpdir(), "keepdrop-fsx-"));
    const path = join(dir, "out.json");
    await atomicWrite(path, "{\"a\":1}\n");
    await atomicWrite(path, "{\"a\":2}\n");
    expect(await readFile(path, "utf8")).toBe("{\"a\":2}\n");
  });
});
