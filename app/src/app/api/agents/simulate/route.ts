import { NextResponse } from "next/server";
import { SCENARIOS, simulate, type Scenario } from "../../../../lib/agents/simulate.ts";
import { tick } from "../../../../lib/agents/runner.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/agents/simulate {scenario}: writes demo records into the data tables; the triggers do the rest
export async function POST(req: Request) {
  const { scenario } = (await req.json().catch(() => ({}))) as { scenario?: string };
  if (!SCENARIOS.some((s) => s.id === scenario)) return NextResponse.json({ error: "Unknown scenario." }, { status: 400 });
  try {
    const r = simulate(scenario as Scenario);
    setTimeout(() => { void tick(true); }, 300); // do not wait for the next poll
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: `Could not simulate: ${(e as Error).message}` }, { status: 500 });
  }
}
