import { NextResponse } from "next/server";
import { valueQuarters } from "../../../../lib/cloud/ledger.ts";
import { cloudOn } from "../../../../lib/cloud/index.ts";
import { ensureBootSync } from "../../../../lib/cloud/sync.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/value/quarters: activations and value by quarter. BigQuery when cloud is on (cached 15 s), else SQLite.
export async function GET() {
  try {
    if (cloudOn()) ensureBootSync();
    return NextResponse.json(await valueQuarters());
  } catch (e) {
    console.error("[quarters] failed:", (e as Error).message);
    return NextResponse.json({ error: "Could not load value by quarter." }, { status: 500 });
  }
}
