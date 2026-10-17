import { NextResponse } from "next/server";
import { agentsView } from "../../../lib/agents/runner.ts";
import { SCENARIOS } from "../../../lib/agents/simulate.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/agents: agents, recent runs, the proposal inbox and runner status (also starts the runner if needed)
export async function GET() {
  try {
    return NextResponse.json({ ...agentsView(), scenarios: SCENARIOS });
  } catch (e) {
    return NextResponse.json({ error: `Agents unavailable: ${(e as Error).message}` }, { status: 500 });
  }
}
