// Hidden Talent: evidence of contribution vs organisational visibility, for people who consented to be visible.
import { all } from "../db.ts";
import { data, type Model } from "./data.ts";
import type { HiddenTalentPerson } from "../types.ts";

export function hiddenTalent(limit = 10, m: Model = data()): HiddenTalentPerson[] {
  const rec = new Map<string, number>();
  for (const r of all<{ to_id: string; n: number }>("SELECT to_id, COUNT(*) n FROM peer_recognition GROUP BY to_id")) rec.set(r.to_id, r.n);
  const vis = new Map<string, number>();
  for (const r of all<{ person_id: string; n: number }>("SELECT person_id, COUNT(*) n FROM visibility_signals GROUP BY person_id")) vis.set(r.person_id, r.n);
  const incidents = new Map<string, number>();
  for (const r of all<{ person_id: string; n: number }>("SELECT person_id, COUNT(*) n FROM incident_resolvers GROUP BY person_id")) incidents.set(r.person_id, r.n);
  const reuse = new Map<string, { sum: number; areas: number }>();
  for (const r of all<{ author_id: string; sum: number; areas: number }>(
    "SELECT author_id, SUM(reuse_count) sum, COUNT(DISTINCT CASE WHEN reuse_count >= 5 THEN COALESCE(system_id, problem_class_id) END) areas FROM knowledge_items GROUP BY author_id")) {
    reuse.set(r.author_id, { sum: r.sum, areas: r.areas });
  }
  const crossDeps = new Map<string, number>();
  for (const r of all<{ person_id: string; n: number }>(
    `SELECT a.person_id, COUNT(DISTINCT p2.department_id) n FROM assignments a JOIN assignments b ON a.project_id = b.project_id
     JOIN people p2 ON p2.id = b.person_id WHERE b.person_id <> a.person_id GROUP BY a.person_id`)) crossDeps.set(r.person_id, r.n);
  const trend = new Map<string, { early: number; late: number }>();
  for (const r of all<{ person_id: string; early: number; late: number }>(
    `SELECT person_id, SUM(date < '2026-01-01') early, SUM(date >= '2026-01-01') late FROM events GROUP BY person_id`)) trend.set(r.person_id, r);

  const raw = [...m.people.values()]
    .filter((p) => p.consent_visibility === 1 && !["C", "GM", "SM"].includes(p.level))
    .map((p) => {
      const projects = new Set((m.assignments.get(p.id) ?? []).map((a) => a.project_id)).size;
      const k = reuse.get(p.id) ?? { sum: 0, areas: 0 };
      const score = projects * 6 + (incidents.get(p.id) ?? 0) * 3 + (rec.get(p.id) ?? 0) * 2 + k.sum * 1.5 + (crossDeps.get(p.id) ?? 0) * 2;
      // visibility: formal signals and seniority (more senior roles are more visible by default)
      const visibility = Math.min(100, (vis.get(p.id) ?? 0) * 22 + (9 - p.level_rank) * 5);
      return { p, projects, k, score, visibility };
    });
  const max = Math.max(...raw.map((r) => r.score), 1);
  return raw
    .map(({ p, projects, k, score, visibility }) => {
      const contribution = Math.round((score / max) * 100);
      const t = trend.get(p.id) ?? { early: 0, late: 0 };
      // 2026 covers 9 months, 2025 covers 12: compare monthly rates
      const lateRate = t.late / 9, earlyRate = t.early / 12;
      const deps = crossDeps.get(p.id) ?? 0;
      return {
        personId: p.id, name: p.name, title: p.title,
        department: p.department_id ? m.departments.get(p.department_id) ?? "" : "",
        location: m.locations.get(p.location_id) ?? "",
        contribution, visibility, gap: contribution - visibility, projects,
        crossTeamDependency: (deps >= 6 ? "high" : deps >= 3 ? "medium" : "low") as HiddenTalentPerson["crossTeamDependency"],
        criticalKnowledgeAreas: k.areas, recognition: rec.get(p.id) ?? 0,
        trend: (lateRate > earlyRate * 1.2 ? "rising" : lateRate < earlyRate * 0.8 ? "falling" : "steady") as HiddenTalentPerson["trend"],
      };
    })
    .sort((a, b) => b.gap - a.gap || a.personId.localeCompare(b.personId))
    .slice(0, limit);
}
