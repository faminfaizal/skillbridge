// Pub/Sub publishing for domain events (simulated feeds, approvals). A push subscription brings them back to
// /api/events/push, which wakes the agent runner. Counters live in memory and in agent_state "cloud_pubsub".
import { gcpRequest, projectId, status } from "./gcp.ts";
import { env } from "../env.ts";
import { getState, setState } from "../agents/store.ts";

const STATE_KEY = "cloud_pubsub";
type Saved = { published: number; failed: number; lastAt: string | null; lastFailAt: string | null; pushes: number; lastPushLagMs: number | null; lastPushAt: string | null };

export function topic(): string {
  const t = env("PUBSUB_TOPIC", "skillbridge-events");
  if (!/^[A-Za-z][\w.~+%-]{2,254}$/.test(t)) throw new Error("PUBSUB_TOPIC is not a valid topic id");
  return t;
}

/** Pub/Sub counters, loaded once from SQLite so they survive a restart. */
export function pubsubCounters(): typeof status.pubsub {
  const p = status.pubsub;
  if (!p.loaded) {
    p.loaded = true;
    try { Object.assign(p, getState<Saved>(STATE_KEY) ?? {}); } catch { /* fresh counters */ }
  }
  return p;
}

export function saveCounters(): void {
  const { loaded: _loaded, ...rest } = pubsubCounters();
  try { setState(STATE_KEY, rest); } catch (e) { console.error("[cloud] could not save pub/sub counters:", (e as Error).message); }
}

/** Publish one event; true when Pub/Sub accepted it within the cap. Never rejects. */
export async function publish(kind: string, payload: Record<string, unknown>, timeoutMs = 1500): Promise<boolean> {
  const c = pubsubCounters();
  try {
    const data = Buffer.from(JSON.stringify({ kind, at: new Date().toISOString(), ...payload })).toString("base64");
    const r = await gcpRequest<{ messageIds?: string[] }>(`https://pubsub.googleapis.com/v1/projects/${projectId()}/topics/${topic()}:publish`, {
      method: "POST", timeoutMs, data: { messages: [{ data, attributes: { kind: kind.slice(0, 100) } }] },
    });
    const ok = !!r.messageIds?.length;
    if (ok) { c.published++; c.lastAt = new Date().toISOString(); } else { c.failed++; c.lastFailAt = new Date().toISOString(); }
    saveCounters();
    return ok;
  } catch (e) {
    c.failed++;
    c.lastFailAt = new Date().toISOString();
    saveCounters();
    console.error(`[cloud] pub/sub publish ${kind} failed:`, (e as Error).message);
    return false;
  }
}
