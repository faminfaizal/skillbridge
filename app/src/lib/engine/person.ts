// Person profile for "Dive into a person" and the evidence panel. Respects the visibility consent flag.
import { all, get } from "../db.ts";
import { data } from "./data.ts";
import { growthPaths } from "./growth.ts";

export function personProfile(id: string) {
  const m = data();
  const p = m.people.get(id);
  if (!p) return null;
  const declared = [...(m.declared.get(id)?.values() ?? [])]
    .map((d) => ({ skillId: d.skill_id, skill: m.skills.get(d.skill_id)!.name, level: d.level, source: d.source, year: d.last_used_year }))
    .sort((a, b) => b.level - a.level);
  const evidenceById = new Map((m.evidence.get(id) ?? []).map((e) => [e.id, e]));
  const inferred = [...(m.inferred.get(id)?.values() ?? [])].map((i) => ({
    skillId: i.skill_id, skill: m.skills.get(i.skill_id)!.name, confidence: i.confidence, rationale: i.rationale, model: i.model,
    evidence: i.evidence_ids.split(",").map((eid) => evidenceById.get(eid)).filter(Boolean).map((e) => ({ id: e!.id, kind: e!.kind, text: e!.text, date: e!.date })),
  })).sort((a, b) => b.confidence - a.confidence);
  const projects = (m.assignments.get(id) ?? []).map((a) => {
    const pr = m.projects.get(a.project_id)!;
    return { id: pr.id, name: pr.name, status: pr.status, role: a.role, note: a.contribution_note, start: a.start_date, end: a.end_date };
  }).sort((a, b) => b.end.localeCompare(a.end));
  const systems = all<{ id: string; name: string; role: string }>(
    "SELECT s.id, s.name, r.role FROM system_roles r JOIN systems s ON s.id = r.system_id WHERE r.person_id = ?", id);
  const incidents = get<{ n: number }>("SELECT COUNT(*) n FROM incident_resolvers WHERE person_id = ?", id)?.n ?? 0;
  const recognition = all<{ question: string; n: number }>(
    "SELECT question, COUNT(*) n FROM peer_recognition WHERE to_id = ? GROUP BY question ORDER BY n DESC", id);
  const knowledge = all<{ id: string; title: string; reuse_count: number }>(
    "SELECT id, title, reuse_count FROM knowledge_items WHERE author_id = ? ORDER BY reuse_count DESC", id);
  const manager = p.manager_id ? m.people.get(p.manager_id) : undefined;
  return {
    id: p.id, name: p.name, title: p.title, level: p.level,
    department: p.department_id ? m.departments.get(p.department_id) ?? "" : "Leadership",
    location: m.locations.get(p.location_id) ?? "", hireYear: p.hire_year, availabilityPct: p.availability_pct,
    manager: manager ? { id: manager.id, name: manager.name, title: manager.title } : null,
    consent: p.consent_visibility === 1,
    declared, inferred, projects, systems, incidentsResolved: incidents, knowledge,
    recognition: recognition.reduce((a, r) => a + r.n, 0), recognitionBreakdown: recognition,
    growth: growthPaths(id),
  };
}
