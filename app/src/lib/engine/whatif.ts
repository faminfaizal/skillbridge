// What-if blast radius: if these people leave, which systems lose most of their expertise and which customers feel it.
import { all } from "../db.ts";
import type { WhatIfResult } from "../types.ts";

export function whatIf(removePersonIds: string[]): WhatIfResult {
  const removed = new Set(removePersonIds);
  const people = all<{ id: string; name: string }>(`SELECT id, name FROM people WHERE id IN (${removePersonIds.map(() => "?").join(",") || "''"})`, ...removePersonIds);
  const credits = all<{ system_id: string; person_id: string }>(
    "SELECT i.system_id, r.person_id FROM incident_resolvers r JOIN incidents i ON i.id = r.incident_id");
  const roles = all<{ system_id: string; person_id: string }>("SELECT system_id, person_id FROM system_roles");
  const systems = all<{ id: string; name: string; criticality: string }>("SELECT id, name, criticality FROM systems");
  const deps = all<{ system_id: string; depends_on_id: string }>("SELECT * FROM system_deps");

  const out: WhatIfResult["systems"] = [];
  for (const s of systems) {
    const c = credits.filter((x) => x.system_id === s.id);
    const r = roles.filter((x) => x.system_id === s.id);
    const lostCredits = c.length ? c.filter((x) => removed.has(x.person_id)).length / c.length : 0;
    const lostRoles = r.length ? r.filter((x) => removed.has(x.person_id)).length / r.length : 0;
    const lost = Math.max(lostCredits, lostRoles);
    if (lost >= 0.5) {
      out.push({ id: s.id, name: s.name, criticality: s.criticality, coverageLost: Math.round(lost * 100) / 100,
        remainingExperts: new Set(r.filter((x) => !removed.has(x.person_id)).map((x) => x.person_id)).size });
    }
  }
  // systems that depend on an impacted system are affected downstream
  const hit = new Set(out.map((s) => s.id));
  const downstream = deps.filter((d) => hit.has(d.depends_on_id)).map((d) => d.system_id);
  const affected = [...new Set([...hit, ...downstream])];
  const customers = affected.length
    ? all<{ id: string; name: string }>(
        `SELECT DISTINCT o.id, o.name FROM organisations o JOIN projects p ON p.customer_id = o.id JOIN project_systems ps ON ps.project_id = p.id
         WHERE ps.system_id IN (${affected.map(() => "?").join(",")}) ORDER BY o.name`, ...affected)
    : [];
  const total = credits.length;
  const share = total ? credits.filter((x) => removed.has(x.person_id)).length / total : 0;
  return {
    removed: people.map((p) => ({ personId: p.id, name: p.name })),
    systems: out.sort((a, b) => b.coverageLost - a.coverageLost),
    customers,
    incidentsShare: Math.round(share * 100) / 100,
    highlight: { nodeIds: [...removePersonIds, ...affected, ...customers.map((c) => c.id)], edgeIds: [] },
  };
}

/** Systems where the top three resolvers hold most incident work (concentration risk, A3). */
export function concentrationRisks(): { systemId: string; name: string; share: number; people: { id: string; name: string; retirementRisk: number; hireYear: number }[] }[] {
  const credits = all<{ system_id: string; person_id: string }>(
    "SELECT i.system_id, r.person_id FROM incident_resolvers r JOIN incidents i ON i.id = r.incident_id");
  const systems = all<{ id: string; name: string; criticality: string }>("SELECT id, name, criticality FROM systems WHERE criticality IN ('critical','high')");
  const people = new Map(all<{ id: string; name: string; retirement_risk: number; hire_year: number }>("SELECT id, name, retirement_risk, hire_year FROM people").map((p) => [p.id, p]));
  const out = [];
  for (const s of systems) {
    const c = credits.filter((x) => x.system_id === s.id);
    if (c.length < 10) continue;
    const counts = new Map<string, number>();
    for (const x of c) counts.set(x.person_id, (counts.get(x.person_id) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    const share = top.reduce((a, [, n]) => a + n, 0) / c.length;
    if (share >= 0.6) {
      out.push({ systemId: s.id, name: s.name, share: Math.round(share * 100) / 100,
        people: top.map(([id]) => { const p = people.get(id)!; return { id, name: p.name, retirementRisk: p.retirement_risk, hireYear: p.hire_year }; }) });
    }
  }
  return out.sort((a, b) => b.share - a.share);
}
