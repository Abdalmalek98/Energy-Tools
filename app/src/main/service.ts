// The only network code in the app: talks to the licensing/proxy service.
export type ServiceError = { ok: false; error: string; message: string; status: number; retryable?: boolean; network?: boolean };
export type ServiceOk<T> = { ok: true; data: T };

export interface LeaseResponse {
  lease: string; serverTime: number;
  license: { customer: string; endsAt: number | null; leaseExpiresAt: number; quotaMonth: number | null; quotaLeft: number | null };
}

async function post<T>(base: string, path: string, body: unknown, timeoutMs: number): Promise<ServiceOk<T> | ServiceError> {
  try {
    const r = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (r.ok) return { ok: true, data: j as T };
    return { ok: false, error: String(j.error ?? "upstream"), message: String(j.message ?? `Service error (${r.status})`), status: r.status, retryable: Boolean(j.retryable) };
  } catch {
    return { ok: false, error: "network", message: "Could not reach the licence service. Check your internet connection.", status: 0, network: true };
  }
}

export const createService = (base: string) => ({
  activate: (code: string, deviceId: string, appVersion: string) => post<LeaseResponse>(base, "/v1/activate", { code, deviceId, appVersion }, 20_000),
  refresh: (lease: string) => post<LeaseResponse>(base, "/v1/refresh", { lease }, 20_000),
  deactivate: (lease: string) => post<{ ok: true }>(base, "/v1/deactivate", { lease }, 20_000),
  /** Retries overloaded/rate-limited upstream with back-off; never retries invalid model output (retryable=false). */
  async readPage(lease: string, images: Uint8Array[], quality: "best" | "fast", hint: string | undefined, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))) {
    const body = { lease, quality, hint, images: images.map((b) => Buffer.from(b).toString("base64")) };
    const waits = [1500, 5000, 12000];
    for (let attempt = 0; ; attempt++) {
      const r = await post<{ page: unknown; quotaLeft: number | null }>(base, "/v1/read-page", body, 190_000);
      const retry = !r.ok && (r.retryable || r.error === "rate_limited") && attempt < waits.length;
      if (!retry) return r;
      await sleep(waits[attempt]);
    }
  },
});
export type Service = ReturnType<typeof createService>;
