import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readLsr, writeLsr } from "../src/main/projectFile";

describe(".lsr project file", () => {
  it("round-trips JSON (incl. Arabic text) and page images", async () => {
    const f = join(mkdtempSync(join(tmpdir(), "lsr-")), "مشروع.lsr");
    const img = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
    await writeLsr(f, { name: "مستشفى", files: [{ id: "a" }] }, { p1: img });
    const r = await readLsr(f);
    expect(r.project).toEqual({ name: "مستشفى", files: [{ id: "a" }] });
    expect([...r.images.p1]).toEqual([...img]);
  });
  it("rejects files that aren't projects", async () => {
    const f = join(mkdtempSync(join(tmpdir(), "lsr-")), "x.lsr");
    (await import("node:fs")).writeFileSync(f, "nope");
    await expect(readLsr(f)).rejects.toThrow();
  });
});
