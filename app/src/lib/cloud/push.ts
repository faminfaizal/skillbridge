// Pub/Sub push endpoint logic: authenticate the push (shared token from Secret Manager, timing-safe compare), parse
// the envelope, record pushes and delivery lag. The route wakes the agent runner after an accepted push.
import crypto from "node:crypto";
import { env } from "../env.ts";
import { pubsubCounters, saveCounters } from "./pubsub.ts";

/** True only when a token is configured and the given one matches it exactly. */
export function tokenOk(given: string | null | undefined, expected = env("PUSH_TOKEN")): boolean {
  if (!expected || !given) return false;
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b) && given.length === expected.length;
}

/** The token from the x-sync-token header or ?token= query parameter. */
export function requestToken(req: Request): string | null {
  return req.headers.get("x-sync-token") ?? new URL(req.url).searchParams.get("token");
}

export interface PushEvent { kind: string; messageId: string; lagMs: number | null; payload: Record<string, unknown> | null }

/** Parse a push envelope {message: {data, attributes, messageId, publishTime}, subscription}; null when malformed. */
export function parseEnvelope(body: unknown, now = Date.now()): PushEvent | null {
  const msg = (body as { message?: { data?: unknown; attributes?: Record<string, unknown>; messageId?: unknown; message_id?: unknown; publishTime?: unknown } })?.message;
  if (!msg || typeof msg !== "object") return null;
  let payload: Record<string, unknown> | null = null;
  if (typeof msg.data === "string" && msg.data.length < 200_000) {
    try { payload = JSON.parse(Buffer.from(msg.data, "base64").toString("utf-8")); } catch { payload = null; }
  }
  const published = typeof msg.publishTime === "string" ? Date.parse(msg.publishTime) : NaN;
  const kind = typeof msg.attributes?.kind === "string" ? msg.attributes.kind : typeof payload?.kind === "string" ? (payload.kind as string) : "unknown";
  return {
    kind: kind.slice(0, 100),
    messageId: String(msg.messageId ?? msg.message_id ?? "").slice(0, 100),
    lagMs: Number.isFinite(published) ? Math.max(0, now - published) : null,
    payload,
  };
}

/** Handle one push: 403 on a bad token, 400 on a malformed envelope, else record it and return the event. */
export async function handlePush(req: Request): Promise<{ status: 204 | 400 | 403; event?: PushEvent }> {
  if (!tokenOk(requestToken(req))) return { status: 403 };
  const ev = parseEnvelope(await req.json().catch(() => null));
  if (!ev) return { status: 400 };
  const c = pubsubCounters();
  c.pushes++;
  c.lastPushLagMs = ev.lagMs;
  c.lastPushAt = new Date().toISOString();
  saveCounters();
  return { status: 204, event: ev };
}
