import { describe, expect, it } from "vitest";
import { hintText, MAX_HINT_CHARS, SYSTEM_PROMPT } from "./prompt";
import { SPACE_TYPES } from "./vocab";

describe("prompt is facility-agnostic", () => {
  it("contains no client, country, facility or surveyor names from the sample data", () => {
    expect(SYSTEM_PROMPT).not.toMatch(/raith|fathia|sujan|ministry|saudi|\bMOH\b/i);
    expect(SYSTEM_PROMPT).toMatch(/any kind of facility/);
  });
  it("lists the configured vocabulary and the schema keys the app depends on", () => {
    for (const t of SPACE_TYPES) expect(SYSTEM_PROMPT).toContain(t);
    for (const k of ["section_changes", "copy_notes", "uncertain", "upright"]) expect(SYSTEM_PROMPT).toContain(k);
  });
  it("hint is empty-safe, flattened and capped", () => {
    expect(hintText(null)).toBe("");
    expect(hintText("  ")).toBe("");
    expect(hintText("a\nb")).toContain('"a b"');
    expect(hintText("x".repeat(5000)).length).toBeLessThan(MAX_HINT_CHARS + 200);
  });
});
