// Inclusion lens (opportunity equity): does opportunity reach people outside headquarters, in remote regions and off
// the org chart? Per location: headcount share against share of the people proposed for open work, activations on
// record, and who to look at (consenting off-chart contributors, the best near-miss for an open role).
import { all } from "../db.ts";
import { pct } from "../format.ts";
import type { Model } from "./data.ts";
import type { RoleRequirement, SignalItem } from "../types.ts";
import { isRemote } from "./geo.ts";
import { capability, scorePerson } from "./match.ts";
import { openOpportunities, staffed } from "./portfolio.ts";

export interface InclusionRow {
  locId: string; name: string; region: string; remote: boolean;
  headcount: number; headShare: number;
  proposed: string[]; proposedShare: number;
  activated: number;
  ratio: number;                       // proposed share / headcount share
  offChart: { id: string; name: string }[];
  nearMiss: { id: string; name: string; role: string; title: string; score: number } | null;
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function inclusionStats(m: Model, offChart: SignalItem[] = []): InclusionRow[] {
  const people = [...m.people.values()].filter((p) => p.level !== "C");
  const visible = (id: string) => m.people.get(id)?.consent_visibility === 1;
  const proposed = new Set<string>();
  const roles: { role: RoleRequirement; title: string }[] = [];
  for (const o of openOpportunities()) {
    const t = staffed(o.id);
    for (const c of t.team) proposed.add(c.personId);
    for (const g of t.gaps) for (const r of g.reskill) proposed.add(r.personId);
    for (const role of o.roles) roles.push({ role, title: o.title });
  }
  const activatedIds = new Set(all<{ person_ids: string | null }>("SELECT person_ids FROM impact_records WHERE person_ids IS NOT NULL AND person_ids <> ''")
    .flatMap((r) => r.person_ids!.split(",")));
  const meta = new Map(all<{ id: string; name: string; region: string }>("SELECT id, name, region FROM locations").map((r) => [r.id, r]));
  const total = people.length || 1;
  const totalProposed = [...proposed].filter((id) => m.people.get(id)?.level !== "C").length || 1;
  const threshold = Number(m.finance.role_fill_threshold ?? 0.7);
  const byLoc = new Map<string, typeof people>();
  for (const p of people) byLoc.set(p.location_id, [...(byLoc.get(p.location_id) ?? []), p]);

  return [...byLoc.entries()].map(([loc, ps]) => {
    const here = new Set(ps.map((p) => p.id));
    const prop = [...proposed].filter((id) => here.has(id)).sort();
    const headShare = ps.length / total, proposedShare = prop.length / totalProposed;
    // near-miss: the consenting person here, not already proposed, closest to an open role (cheap skill prefilter, then the full score)
    let near: InclusionRow["nearMiss"] = null;
    const pool = ps.filter((p) => visible(p.id) && !proposed.has(p.id));
    for (const { role, title } of roles) {
      const top = pool.map((p) => ({ p, s: mean(role.must.map((sk) => capability(m, p.id, sk).value)) })).sort((a, b) => b.s - a.s || a.p.id.localeCompare(b.p.id)).slice(0, 2);
      for (const { p, s } of top) {
        if (s < 0.4) continue;
        const score = scorePerson(p.id, role, m).score;
        if (score < threshold && (!near || score > near.score)) near = { id: p.id, name: p.name, role: role.role, title, score };
      }
    }
    return {
      locId: loc, name: m.locations.get(loc) ?? loc, region: meta.get(loc)?.region ?? "", remote: isRemote(loc),
      headcount: ps.length, headShare: round2(headShare), proposed: prop, proposedShare: round2(proposedShare),
      activated: [...activatedIds].filter((id) => here.has(id)).length,
      ratio: headShare ? round2(proposedShare / headShare) : 0,
      offChart: offChart.flatMap((it) => it.people).filter((x) => here.has(x.id) && visible(x.id)),
      nearMiss: near,
    };
  }).sort((a, b) => a.ratio - b.ratio || Number(b.remote) - Number(a.remote) || a.locId.localeCompare(b.locId));
}

export function inclusionItems(m: Model, offChart: SignalItem[]): SignalItem[] {
  return inclusionStats(m, offChart).map((r) => {
    const people = [...r.offChart, ...(r.nearMiss ? [{ id: r.nearMiss.id, name: r.nearMiss.name }] : [])]
      .filter((x, i, xs) => xs.findIndex((y) => y.id === x.id) === i);
    const shown = r.proposed.filter((id) => m.people.get(id)?.consent_visibility === 1);
    return {
      id: `INC-${r.locId}`,
      title: r.name,
      subtitle: `${r.remote ? "Remote region" : "Office"}${r.region ? `, ${r.region}` : ""}`,
      metric: `${r.ratio.toFixed(1)}x`,
      metricLabel: "share of open work vs share of headcount",
      facts: [
        `${r.headcount} people, ${pct(r.headShare)} of headcount`,
        `${r.proposed.length} proposed for open work, ${pct(r.proposedShare)} of all proposals`,
        `${r.activated} on activations recorded in the app`,
        ...(r.offChart.length ? [`Off-chart contributors here: ${r.offChart.map((x) => x.name).join(", ")}`] : []),
        ...(r.nearMiss ? [`Consider ${r.nearMiss.name} for ${r.nearMiss.role} (${r.nearMiss.title}), ${pct(r.nearMiss.score)} match`] : []),
      ],
      people,
      focusId: people[0]?.id ?? shown[0] ?? r.locId,
      nodeIds: [...people.map((x) => x.id), ...shown],
      score: round2(Math.max(0, 1 - r.ratio)),
    };
  });
}
