/** Chooses a vision-capable model from a provider's model list: newest stable Gemini "flash" first (free tier, reads images). Pure, so it can be tested. */
const NOT_VISION_CHAT = /embed|tts|image|live|audio|robotics|computer|aqa|learnlm|gemma|imagen|veo|native|thinking-exp|transcribe/i;
export function pickGeminiModel(ids: string[]): string | null {
  const c = ids.map((i) => i.replace(/^models\//, "")).filter((i) => /^gemini-/i.test(i) && !NOT_VISION_CHAT.test(i));
  const score = (id: string) => {
    const v = Number(/gemini-(\d+(?:\.\d+)?)/i.exec(id)?.[1] ?? 0);
    const flash = /flash/i.test(id) ? 1 : 0, lite = /lite/i.test(id) ? 1 : 0, pre = /preview|exp/i.test(id) ? 1 : 0, latest = /latest/i.test(id) ? 1 : 0;
    return [flash && !lite ? 1 : 0, v, pre ? 0 : 1, latest ? 0 : 1, flash ? 1 : 0] as const;
  };
  c.sort((a, b) => { const x = score(a), y = score(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return y[i] - x[i]; return a.localeCompare(b); });
  return c[0] ?? null;
}
