import { NextResponse } from "next/server";
import { hiddenTalent } from "../../../lib/engine/hidden.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(hiddenTalent(8));
}
