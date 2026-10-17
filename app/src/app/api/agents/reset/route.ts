import { NextResponse } from "next/server";
import { resetAgents } from "../../../../lib/agents/simulate.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/agents/reset: remove simulated records and approved agent actions, rebuild skills and graph
export async function POST() {
  try {
    return NextResponse.json(await resetAgents());
  } catch (e) {
    return NextResponse.json({ error: `Could not reset: ${(e as Error).message}` }, { status: 500 });
  }
}
