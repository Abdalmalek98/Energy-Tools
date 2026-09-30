import { hintText, ModelPage, SYSTEM_PROMPT, type Quality } from "@lsr/shared";
import type { Env } from "./env";

export const MAX_IMAGES = 3;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024 + 256 * 1024; // "~4 MB" plus slack

export class UpstreamError extends Error {
  constructor(message: string, public retryable: boolean, public status = 502) { super(message); }
}

export function decodedSize(b64: string): number {
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

export function extractJson(text: string): unknown {
  let s = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("no JSON object");
  s = s.slice(a, b + 1);
  return JSON.parse(s);
}

export async function readPage(env: Env, images: string[], quality: Quality, hint?: string | null) {
  const model = quality === "fast" ? env.MODEL_FAST : env.MODEL_BEST;
  const labels = ["Whole page", "Top 56% of the page (zoomed)", "Bottom 56% of the page (zoomed)"];
  const content: unknown[] = [];
  images.forEach((data, i) => {
    content.push({ type: "text", text: labels[i] ?? `Image ${i + 1}` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } });
  });
  const ctx = hintText(hint);
  content.push({ type: "text", text: (ctx ? ctx + "\n" : "") + "Transcribe this page. Return the JSON object only." });

  let res: Response;
  try {
    res = await fetch(`${env.ANTHROPIC_BASE_URL}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 16000, temperature: 0, system: SYSTEM_PROMPT, messages: [{ role: "user", content }] }),
      signal: AbortSignal.timeout(170_000),
    });
  } catch {
    throw new UpstreamError("The reading service could not be reached. Try again.", true);
  }
  if (!res.ok) {
    const retryable = res.status === 429 || res.status === 529 || res.status >= 500;
    throw new UpstreamError(`Reading service busy or unavailable (${res.status}).`, retryable);
  }
  const body = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number }; stop_reason?: string };
  const text = (body.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
  let parsed: unknown;
  try { parsed = extractJson(text); } catch {
    throw new UpstreamError("The model did not return valid JSON. Press Try again.", false);
  }
  const v = ModelPage.safeParse(parsed);
  if (!v.success) throw new UpstreamError("The model output did not match the expected format. Press Try again.", false);
  return { page: v.data, model, tokensIn: body.usage?.input_tokens ?? null, tokensOut: body.usage?.output_tokens ?? null };
}
