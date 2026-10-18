// Incident response team (business continuity): a situation report (text and/or a photo) becomes a team staffed by
// role fit, proximity and availability. Owned by the respond track (T2). Stub: signatures only.

export interface CrisisInput { text?: string; file?: { mimeType: string; data: Buffer } }

/** The plan returned to the UI. T2 defines the full shape. */
export interface CrisisPlan { id: string; [k: string]: unknown }

export async function respond(_input: CrisisInput): Promise<CrisisPlan> {
  throw new Error("Incident response is not available yet.");
}

export function latestCrisis(): CrisisPlan | null {
  return null;
}

/** Approval of a "mobilise" proposal (agents/actions.ts). */
export function approveMobilise(_a: Record<string, any>, _inboxId: number): { outcome: string; changed: boolean } {
  return { outcome: "Approved; owner notified.", changed: false };
}

/** Demo reset: remove simulated crisis rows. Returns rows removed. */
export function resetCrisis(): number {
  return 0;
}
