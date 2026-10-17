// Deterministic capability matching: "Why this person?" breakdown. Scores are formulas over data, never LLM output.
import { data, type Model } from "./data.ts";
import { supportingEvidence } from "./infer.ts";
import type { Candidate, EvidenceItem, RoleRequirement, ScoreBreakdown, SkillCapability } from "../types.ts";

const round2 = (x: number) => Math.round(x * 100) / 100;

function heldValue(m: Model, personId: string, skillId: string): { value: number; source: "declared" | "inferred"; year?: number } | null {
  const d = m.declared.get(personId)?.get(skillId);
  const i = m.inferred.get(personId)?.get(skillId);
  const dv = d ? d.level / 5 : 0;
  const iv = i ? i.confidence : 0;
  if (!d && !i) return null;
  if (dv >= iv) return { value: dv, source: "declared", year: d!.last_used_year };
  return { value: iv, source: "inferred", year: inferredYear(m, personId, skillId) };
}

function inferredYear(m: Model, personId: string, skillId: string): number | undefined {
  const i = m.inferred.get(personId)?.get(skillId);
  if (!i) return undefined;
  const ids = new Set(i.evidence_ids.split(",").filter(Boolean));
  const dates = (m.evidence.get(personId) ?? []).filter((e) => ids.has(e.id)).map((e) => e.date).sort();
  return dates.length ? Number(dates[dates.length - 1].slice(0, 4)) : undefined;
}

/** Best transfer into skillId from other skills the person holds (adjacency weight x held value). */
function transfer(m: Model, personId: string, skillId: string): { value: number; via?: string; year?: number } {
  let best = { value: 0 } as { value: number; via?: string; year?: number };
  const adj = m.adjacency.get(skillId);
  if (!adj) return best;
  for (const [other, w] of adj) {
    const h = heldValue(m, personId, other);
    if (h && h.value * w > best.value) best = { value: h.value * w, via: m.skills.get(other)!.name, year: h.year };
  }
  return best;
}

export function capability(m: Model, personId: string, skillId: string): SkillCapability {
  const name = m.skills.get(skillId)?.name ?? skillId;
  const h = heldValue(m, personId, skillId);
  const factor = Number(m.finance.adjacency_transfer ?? 0.8);
  const t = transfer(m, personId, skillId);
  const tv = t.value * factor;
  if (h && h.value >= tv) return { skillId, skill: name, value: round2(h.value), source: h.source, year: h.year };
  if (tv > 0) return { skillId, skill: name, value: round2(tv), source: "adjacent", via: t.via, year: t.year };
  return { skillId, skill: name, value: 0, source: "none" };
}

/** How close a person is to one skill for reskilling: held value, else raw adjacency (and the skill it transfers from). */
export function skillReadiness(m: Model, personId: string, skillId: string): { value: number; via?: string } {
  const held = heldValue(m, personId, skillId)?.value ?? 0;
  const t = transfer(m, personId, skillId);
  return t.value > held ? { value: round2(t.value), via: t.via } : { value: round2(held) };
}

/** How close a person is to a skill set (used for reskilling readiness): mean of skillReadiness. */
export function readiness(m: Model, personId: string, skillIds: string[]): number {
  if (!skillIds.length) return 0;
  const vals = skillIds.map((s) => skillReadiness(m, personId, s).value);
  return round2(vals.reduce((a, b) => a + b, 0) / vals.length);
}

function recencyValue(m: Model, year?: number): number {
  const r = m.finance.recency_by_year ?? {};
  if (!year) return r.none ?? 0.3;
  return r[String(year)] ?? (year >= 2026 ? 1 : r.older ?? 0.5);
}

export function scorePerson(personId: string, role: RoleRequirement, m: Model = data()): Candidate {
  const p = m.people.get(personId)!;
  const w = m.finance.match_weights ?? { skill: 0.4, project: 0.2, domain: 0.15, recency: 0.15, adjacent: 0.1 };
  const caps = role.must.map((s) => capability(m, personId, s));
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  const skill = mean(caps.map((c) => c.value));
  let exp = 0;
  const projEvidence: EvidenceItem[] = [];
  let solvedSimilar = false;
  for (const a of m.assignments.get(personId) ?? []) {
    const ps = m.projectSkills.get(a.project_id) ?? new Set();
    const overlap = role.must.filter((s) => ps.has(s)).length;
    if (!overlap) continue;
    exp += (overlap / role.must.length) * Math.min(1, a.man_days / 60);
    const proj = m.projects.get(a.project_id)!;
    if (proj.status === "completed" && overlap >= Math.min(2, role.must.length)) solvedSimilar = true;
    projEvidence.push({ id: a.id, kind: "assignment", text: `${proj.name}: ${a.contribution_note}`, date: a.end_date, nodeId: a.project_id });
  }
  // experience with the same problem type: resolved customer cases and completed projects on that problem
  if (role.problemClassId) {
    for (const e of m.evidence.get(personId) ?? []) {
      if (e.kind === "case" && e.problem_class_id === role.problemClassId) {
        exp += 0.5;
        solvedSimilar = true;
        projEvidence.unshift({ id: e.id, kind: "case", text: e.text, date: e.date, nodeId: e.problem_class_id ?? undefined });
      }
    }
    for (const a of m.assignments.get(personId) ?? []) {
      const proj = m.projects.get(a.project_id)!;
      if (proj.problem_class_id === role.problemClassId && proj.status === "completed") solvedSimilar = true;
    }
  }
  const project = Math.min(1, exp / Number(m.finance.project_saturation ?? 2));
  // domain: nice-to-have context skills, blended with core skill so one missing context skill is not fatal
  const domain = role.nice.length ? 0.5 * mean(role.nice.map((s) => capability(m, personId, s).value)) + 0.5 * skill : skill;
  const recency = mean(caps.map((c) => (c.source === "none" ? recencyValue(m) : recencyValue(m, c.year))));
  const adjacent = mean(role.must.map((s) => transfer(m, personId, s).value));
  const breakdown: ScoreBreakdown = { skill: round2(skill), project: round2(project), domain: round2(domain), recency: round2(recency), adjacent: round2(adjacent) };
  const score = round2(w.skill * skill + w.project * project + w.domain * domain + w.recency * recency + w.adjacent * adjacent);

  // evidence: inferred-skill records first (they explain hidden capability), then project history
  const evidence: EvidenceItem[] = [];
  const rows = m.evidence.get(personId) ?? [];
  for (const c of caps.filter((c) => c.source === "inferred")) {
    for (const e of supportingEvidence(rows, c.skill).slice(0, 3)) {
      if (!evidence.some((x) => x.id === e.id)) {
        evidence.push({ id: e.id, kind: e.kind, text: e.text, date: e.date, nodeId: e.kind === "assignment" ? e.ref : e.id });
      }
    }
  }
  for (const e of projEvidence) if (evidence.length < 6 && !evidence.some((x) => x.id === e.id)) evidence.push(e);

  return {
    personId,
    name: p.name,
    title: p.title,
    department: p.department_id ? m.departments.get(p.department_id) ?? "" : "Leadership",
    location: m.locations.get(p.location_id) ?? "",
    role: role.role,
    score,
    breakdown,
    capabilities: caps,
    evidence,
    hidden: caps.some((c) => c.source === "inferred" && c.value >= 0.5),
    solvedSimilar,
    availabilityPct: p.availability_pct,
  };
}

export function eligiblePeople(m: Model = data()): string[] {
  return [...m.people.values()].filter((p) => p.level !== "C").map((p) => p.id);
}

export function rankForRole(role: RoleRequirement, exclude: Set<string> = new Set(), m: Model = data()): Candidate[] {
  return eligiblePeople(m)
    .filter((id) => !exclude.has(id))
    .map((id) => scorePerson(id, role, m))
    .sort((a, b) => b.score - a.score || b.availabilityPct - a.availabilityPct || a.personId.localeCompare(b.personId));
}
