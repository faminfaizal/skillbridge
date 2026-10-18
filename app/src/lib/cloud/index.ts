// Google Cloud side effects (Firestore mirror, BigQuery sync, Pub/Sub events). One switch: CLOUD_SYNC=on.
// Every hook is fire-and-forget: it never throws and never blocks the engine; SQLite stays the source of truth.
// Owned by the cloud track (T1); this file is the stable contract the rest of the app calls.
import { env } from "../env.ts";

/** Cloud work is on only when CLOUD_SYNC=on, and never under the test runner. */
export function cloudOn(): boolean {
  return env("CLOUD_SYNC") === "on" && !process.env.NODE_TEST_CONTEXT;
}

/** The impact ledger changed (activation, approval, reset): mirror it to Firestore and BigQuery. */
export function ledgerChanged(_reason: string): void {
  /* T1 */
}

/** The agent inbox or activity changed: mirror it to Firestore. */
export function agentsChanged(_reason: string): void {
  /* T1 */
}

/** Mirror one document (crisis plans, community requests) to Firestore. */
export function mirror(_collection: string, _id: string, _doc: Record<string, unknown>): void {
  /* T1 */
}

/** Publish a domain event to Pub/Sub. Resolves true when published; never rejects. */
export async function publishEvent(_kind: string, _payload: Record<string, unknown>): Promise<boolean> {
  return false;
}
