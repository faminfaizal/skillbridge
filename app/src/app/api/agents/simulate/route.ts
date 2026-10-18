import { NextResponse } from "next/server";
import { SCENARIOS, simulate, type Scenario } from "../../../../lib/agents/simulate.ts";
import { tick } from "../../../../lib/agents/runner.ts";
import { publishEvent } from "../../../../lib/cloud/index.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/agents/simulate {scenario}: writes demo records into the data tables; the triggers do the rest.
// With cloud on, the change is also published to Pub/Sub so the push subscription wakes the agents.
export async function POST(req: Request) {
  const { scenario } = (await req.json().catch(() => ({}))) as { scenario?: string };
  if (!SCENARIOS.some((s) => s.id === scenario)) return NextResponse.json({ error: "Unknown scenario." }, { status: 400 });
  try {
    const r = simulate(scenario as Scenario);
    // Pub/Sub push (/api/events/push) wakes the runner; the local tick is the fallback (and the 3 s poller behind it)
    const ok = await publishEvent("simulate", { scenario, inserted: r.inserted.length });
    setTimeout(() => { void tick(true); }, ok ? 2500 : 300);
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: `Could not simulate: ${(e as Error).message}` }, { status: 500 });
  }
}
