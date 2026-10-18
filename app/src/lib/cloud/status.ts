// The cloud status snapshot behind /api/cloud/status and the CloudStatus chips. Error details stay in the server log.
import { cloudOn } from "./index.ts";
import { status, type CloudState } from "./gcp.ts";
import { pubsubCounters } from "./pubsub.ts";
import { ensureBootSync } from "./sync.ts";

export interface CloudStatusView {
  on: boolean;
  firestore: { state: CloudState; lastSyncAt: string | null; docs?: number };
  bigquery: { state: CloudState; lastQueryMs: number | null; lastSyncAt: string | null };
  pubsub: { state: CloudState; published: number; failed: number; lastAt: string | null; lastFailAt: string | null; pushes: number; lastPushLagMs: number | null; lastPushAt: string | null };
}

export function cloudStatus(): CloudStatusView {
  const on = cloudOn();
  if (on) ensureBootSync();
  let p: Omit<CloudStatusView["pubsub"], "state"> = { published: 0, failed: 0, lastAt: null, lastFailAt: null, pushes: 0, lastPushLagMs: null, lastPushAt: null };
  try {
    const c = pubsubCounters();
    p = { published: c.published, failed: c.failed, lastAt: c.lastAt, lastFailAt: c.lastFailAt, pushes: c.pushes, lastPushLagMs: c.lastPushLagMs, lastPushAt: c.lastPushAt };
  } catch { /* counters unavailable */ }
  const f = status.firestore, b = status.bigquery;
  return {
    on,
    firestore: { state: on ? f.state : "off", lastSyncAt: f.lastSyncAt, ...(f.docs !== undefined ? { docs: f.docs } : {}) },
    bigquery: { state: on ? b.state : "off", lastQueryMs: b.lastQueryMs, lastSyncAt: b.lastSyncAt },
    pubsub: { state: !on ? "off" : p.lastFailAt && (!p.lastAt || p.lastFailAt > p.lastAt) ? "error" : p.published || p.pushes ? "live" : "pending", ...p },
  };
}
