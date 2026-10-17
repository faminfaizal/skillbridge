import { NextResponse } from "next/server";
import { evaluateTeam, nextBest, searchForRole } from "../../../lib/engine/teamFit.ts";
import type { RoleRequirement } from "../../../lib/types.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  mode?: "evaluate" | "next" | "search";
  requirements?: RoleRequirement[];
  personIds?: (string | null)[]; // one per requirement, null = unfilled
  hasOpportunity?: boolean;
  slot?: number; // next / search: which role
  exclude?: string[]; // next: people already passed over for this slot
  q?: string; // search: name
  extras?: { slot: number; personId: string }[]; // people added beyond one per role
};

// POST /api/team: Challenge Team. evaluate = re-score a team; next = AI's next best for one role; search = people by name, scored for a role
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Body;
  const roles = b.requirements;
  if (!Array.isArray(roles) || !roles.length || !roles.every((r) => r && typeof r.role === "string" && Array.isArray(r.must))) {
    return NextResponse.json({ error: "Ask for a team first." }, { status: 400 });
  }
  const ids = roles.map((_, i) => b.personIds?.[i] ?? null);
  const extras = (Array.isArray(b.extras) ? b.extras : [])
    .filter((x) => x && Number.isInteger(x.slot) && typeof x.personId === "string")
    .map((x) => ({ slot: x.slot, personId: x.personId }));
  const onTeam = [...ids.filter((x): x is string => !!x), ...extras.map((x) => x.personId)];
  try {
    if (b.mode === "evaluate") return NextResponse.json(evaluateTeam(roles, ids, !!b.hasOpportunity, undefined, extras));
    const role = roles[b.slot ?? -1];
    if (!role) return NextResponse.json({ error: "Pick a role on the team." }, { status: 400 });
    if (b.mode === "next") {
      const c = nextBest(role, [...onTeam, ...(b.exclude ?? [])]);
      return c ? NextResponse.json(c) : NextResponse.json({ error: `No one else fits the ${role.role} role.` }, { status: 404 });
    }
    if (b.mode === "search") return NextResponse.json(searchForRole(role, String(b.q ?? "").slice(0, 60), onTeam));
    return NextResponse.json({ error: "mode must be evaluate, next or search" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: `Could not score the team: ${(e as Error).message}` }, { status: 500 });
  }
}
