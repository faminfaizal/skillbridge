import { NextResponse } from "next/server";
import { socialLedger, socialStatement } from "../../../lib/engine/social.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Social and environmental value ledger, with a grounded statement (Gemini, template fallback). */
export async function GET() {
  const ledger = socialLedger();
  return NextResponse.json({ ledger, statement: await socialStatement(ledger) });
}
