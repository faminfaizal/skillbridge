import { NextResponse } from "next/server";
import { concentrationRisks } from "../../../lib/engine/whatif.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(concentrationRisks());
}
