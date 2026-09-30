import { describe, expect, it } from "vitest";
import { hintText, MAX_HINT_CHARS, SYSTEM_PROMPT } from "./prompt";

describe("prompt is facility-neutral", () => {
  it("names no specific facility and no hospital-only vocabulary in examples", () => {
    expect(SYSTEM_PROMPT).not.toMatch(/raith|dialysis|blood bank|patient room|\bOPD\b/i);
    expect(SYSTEM_PROMPT).toMatch(/ANY kind of facility/);
  });
  it("hint is empty-safe, flattened and capped", () => {
    expect(hintText(null)).toBe("");
    expect(hintText("  ")).toBe("");
    expect(hintText("a\nb")).toContain('"a b"');
    expect(hintText("x".repeat(5000)).length).toBeLessThan(MAX_HINT_CHARS + 200);
  });
});
