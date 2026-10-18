import { NextResponse } from "next/server";
import { ledgerView } from "../../../lib/cloud/ledger.ts";
import { cloudOn } from "../../../lib/cloud/index.ts";
import { ensureBootSync } from "../../../lib/cloud/sync.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/ledger: the public impact ledger (no person ids or names). Firestore mirror when cloud is on, else SQLite.
export async function GET() {
  try {
    if (cloudOn()) ensureBootSync();
    return NextResponse.json(await ledgerView(), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("[ledger] failed:", (e as Error).message);
    return NextResponse.json({ error: "Could not load the ledger." }, { status: 500 });
  }
}
