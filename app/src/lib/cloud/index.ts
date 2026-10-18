// Google Cloud side effects (Firestore mirror, BigQuery sync, Pub/Sub events). One switch: CLOUD_SYNC=on.
// Every hook is fire-and-forget: it never throws and never blocks the engine; SQLite stays the source of truth.
// Owned by the cloud track (T1); this file is the stable contract the rest of the app calls. The cloud modules load
// lazily, so with cloud off nothing beyond this file is ever imported.
import { env } from "../env.ts";

/** Cloud work is on only when CLOUD_SYNC=on, and never under the test runner. */
export function cloudOn(): boolean {
  return env("CLOUD_SYNC") === "on" && !process.env.NODE_TEST_CONTEXT;
}

/** Run work after the current call returns; log and swallow any failure. */
function later(what: string, work: () => Promise<unknown>): void {
  setTimeout(() => { work().catch((e) => console.error(`[cloud] ${what} failed:`, (e as Error).message)); }, 0);
}

/** The impact ledger changed (activation, approval, reset): mirror it to Firestore and BigQuery. */
export function ledgerChanged(reason: string): void {
  if (!cloudOn()) return;
  later(`ledger sync (${reason})`, async () => (await import("./sync.ts")).scheduleLedger());
}

/** The agent inbox or activity changed: mirror it to Firestore. */
export function agentsChanged(reason: string): void {
  if (!cloudOn()) return;
  later(`agents sync (${reason})`, async () => (await import("./sync.ts")).scheduleAgents());
}

/** Mirror one document (crisis plans, community requests) to Firestore. */
export function mirror(collection: string, id: string, doc: Record<string, unknown>): void {
  if (!cloudOn() || !/^[A-Za-z][\w-]{0,60}$/.test(collection) || !id) return;
  let copy: Record<string, unknown>;
  try { copy = JSON.parse(JSON.stringify(doc)); } catch { return; } // snapshot now; the caller may mutate doc later
  later(`mirror ${collection}`, async () => (await import("./sync.ts")).mirrorDoc(collection, String(id), copy));
}

/** Publish a domain event to Pub/Sub. Resolves true when published; never rejects. */
export async function publishEvent(kind: string, payload: Record<string, unknown>): Promise<boolean> {
  if (!cloudOn()) return false;
  try {
    return await (await import("./pubsub.ts")).publish(kind, payload);
  } catch (e) {
    console.error(`[cloud] publish ${kind} failed:`, (e as Error).message);
    return false;
  }
}
