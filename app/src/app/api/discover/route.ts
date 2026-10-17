import { NextResponse } from "next/server";
import { discover } from "../../../lib/engine/discover.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(discover());
  } catch (e) {
    return NextResponse.json({ error: `Could not scan the graph: ${(e as Error).message}` }, { status: 500 });
  }
}
