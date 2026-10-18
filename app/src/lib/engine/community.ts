// Community skills exchange (skills-based volunteering): community and small-business requests matched to consenting
// volunteers, nearest first. Owned by the respond track (T2). Stub: signatures only.

export interface CommunityInput { org?: string; text?: string; file?: { mimeType: string; data: Buffer } }

/** One request on the board with its matched volunteers. T2 defines the full shape. */
export interface CommunityRequest { id: string; [k: string]: unknown }

export function board(): CommunityRequest[] {
  return [];
}

export function offer(_requestId: string): { proposed: boolean; inboxId?: number; message: string } {
  return { proposed: false, message: "Not available yet." };
}

export async function postRequest(_input: CommunityInput): Promise<CommunityRequest> {
  throw new Error("Posting requests is not available yet.");
}

/** Approval of a "volunteer" proposal (agents/actions.ts). */
export function approveVolunteer(_a: Record<string, any>, _inboxId: number): { outcome: string; changed: boolean } {
  return { outcome: "Approved; owner notified.", changed: false };
}

/** Demo reset: remove posted requests and volunteer logs. Returns rows removed. */
export function resetCommunity(): number {
  return 0;
}
