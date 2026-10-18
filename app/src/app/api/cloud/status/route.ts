import { NextResponse } from "next/server";
import { cloudStatus } from "../../../../lib/cloud/status.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/cloud/status: Firestore mirror, BigQuery and Pub/Sub state for the Cloud status chips.
export async function GET() {
  return NextResponse.json(cloudStatus(), { headers: { "cache-control": "no-store" } });
}
