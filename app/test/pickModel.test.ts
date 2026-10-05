import { describe, expect, it } from "vitest";
import { pickGeminiModel } from "../src/main/pickModel";

describe("pickGeminiModel", () => {
  it("prefers the newest stable flash model and skips embedding, image, audio and lite variants", () => {
    expect(pickGeminiModel(["models/gemini-2.5-pro", "models/gemini-2.5-flash", "models/gemini-2.5-flash-lite", "models/text-embedding-004", "models/gemini-2.5-flash-image"])).toBe("gemini-2.5-flash");
    expect(pickGeminiModel(["models/gemini-2.5-flash", "models/gemini-3-flash-preview", "models/gemini-3-flash"])).toBe("gemini-3-flash");
    expect(pickGeminiModel(["gemini-2.0-flash", "gemini-2.5-flash-preview-05-20"])).toBe("gemini-2.5-flash-preview-05-20");
  });
  it("falls back to flash-lite (still free) when there is no plain flash, and returns null when nothing fits", () => {
    expect(pickGeminiModel(["models/gemini-2.5-flash-lite", "models/gemini-2.5-pro"])).toBe("gemini-2.5-flash-lite");
    expect(pickGeminiModel(["models/text-embedding-004", "models/gemini-embedding-001"])).toBeNull();
    expect(pickGeminiModel([])).toBeNull();
  });
});
