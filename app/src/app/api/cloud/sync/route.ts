import { NextResponse } from "next/server";
import { cloudOn } from "../../../../lib/cloud/index.ts";
import { requestToken, tokenOk } from "../../../../lib/cloud/push.ts";
import { fullResync } from "../../../../lib/cloud/sync.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/cloud/sync (x-sync-token header or ?token= equal to PUSH_TOKEN): full resync of Firestore and BigQuery,
// including skill_coverage. 403 without the token, 409 while cloud sync is off.
export async function POST(req: Request) {
  if (!tokenOk(requestToken(req))) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  if (!cloudOn()) return NextResponse.json({ error: "Cloud sync is off (CLOUD_SYNC is not on)." }, { status: 409 });
  try {
    const r = await fullResync();
    return NextResponse.json({ ok: !r.errors.length, ...r }, { status: r.errors.length ? 502 : 200 });
  } catch (e) {
    console.error("[cloud] full resync failed:", (e as Error).message);
    return NextResponse.json({ error: "Resync failed." }, { status: 500 });
  }
}
