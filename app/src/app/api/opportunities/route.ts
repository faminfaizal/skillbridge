import { NextResponse } from "next/server";
import { all } from "../../../lib/db.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(all("SELECT id, title, kind, demo_query, revenue_potential_amt, deadline FROM opportunities WHERE status = 'open' ORDER BY id"));
}
