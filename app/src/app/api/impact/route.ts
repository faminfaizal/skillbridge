import { NextResponse } from "next/server";
import { impactSummary, resetActivations } from "../../../lib/engine/impact.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(impactSummary());
}

/** Demo reset: removes records created by Activate Capability. */
export async function DELETE() {
  return NextResponse.json({ removed: resetActivations() });
}
