// Google Cloud REST access with Application Default Credentials (Cloud Run service account in prod, gcloud ADC locally),
// plus the shared, in-process cloud status that /api/cloud/status reports. Every call has a hard timeout.
import type { GoogleAuth } from "google-auth-library";
import { env } from "../env.ts";

export type CloudState = "off" | "pending" | "live" | "error";

interface CloudStatusState {
  firestore: { state: CloudState; lastSyncAt: string | null; docs?: number; lastError?: string };
  bigquery: { state: CloudState; lastQueryMs: number | null; lastSyncAt: string | null; lastError?: string };
  pubsub: { published: number; failed: number; lastAt: string | null; lastFailAt: string | null; pushes: number; lastPushLagMs: number | null; lastPushAt: string | null; loaded: boolean };
}

const G = globalThis as unknown as { __sbGcpAuth?: GoogleAuth; __sbCloudStatus?: CloudStatusState };

export const status: CloudStatusState = (G.__sbCloudStatus ??= {
  firestore: { state: "pending", lastSyncAt: null },
  bigquery: { state: "pending", lastQueryMs: null, lastSyncAt: null },
  pubsub: { published: 0, failed: 0, lastAt: null, lastFailAt: null, pushes: 0, lastPushLagMs: null, lastPushAt: null, loaded: false },
});

export function projectId(): string {
  const p = env("GOOGLE_CLOUD_PROJECT");
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(p)) throw new GcpError("GOOGLE_CLOUD_PROJECT is not set");
  return p;
}

export class GcpError extends Error {
  status: number;
  constructor(message: string, status = 0) { super(message); this.status = status; }
}

// Loaded lazily so the app never pulls the auth library in while cloud sync is off
async function auth(): Promise<GoogleAuth> {
  if (!G.__sbGcpAuth) {
    const { GoogleAuth } = await import("google-auth-library");
    G.__sbGcpAuth ??= new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  }
  return G.__sbGcpAuth;
}

/** Short, log-safe error text: HTTP status plus the API's message (never the request body). */
export function errText(e: unknown): string {
  const any = e as { status?: number; response?: { status?: number; data?: { error?: { message?: string } } }; message?: string };
  const code = any.response?.status ?? any.status;
  const msg = any.response?.data?.error?.message ?? any.message ?? String(e);
  return `${code ? `HTTP ${code}: ` : ""}${msg}`.slice(0, 240);
}

/** One authenticated REST call. Rejects with GcpError on HTTP errors and after timeoutMs (the request is aborted). */
export async function gcpRequest<T>(url: string, opts: { method?: string; data?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = (async () => {
    const client = await (await auth()).getClient();
    const r = await client.request<T>({ url, method: (opts.method ?? "GET") as "GET", data: opts.data, timeout: timeoutMs, signal: ctrl.signal, retry: false });
    return r.data;
  })();
  work.catch(() => { /* the timeout below reports it */ });
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { ctrl.abort(); reject(new GcpError(`timeout after ${timeoutMs} ms`)); }, timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } catch (e) {
    if (e instanceof GcpError) throw e;
    const any = e as { response?: { status?: number }; status?: number };
    throw new GcpError(errText(e), any.response?.status ?? any.status ?? 0);
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve within ms or give up with null; never rejects. */
export async function capped<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p.catch(() => null), new Promise<null>((r) => { timer = setTimeout(() => r(null), ms); })]);
  } finally {
    clearTimeout(timer);
  }
}
