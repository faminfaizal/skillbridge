// Challenge Team: how well a team fits together, and the options a manager has to change it.
// One deterministic team match score from four weighted parts, so every swap shows its effect and its reason.
// Working history is shown (pairs who shared a project) but not scored: cross-functional teams rarely have one.
import { data, type Model } from "./data.ts";
import { capability, eligiblePeople, rankForRole, scorePerson } from "./match.ts";
import { estimateValue } from "./value.ts";
import type { Candidate, RoleRequirement, TeamEvaluation, TeamFit } from "../types.ts";

const round2 = (x: number) => Math.round(x * 100) / 100;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** A skill counts as covered when someone on the team holds it at this level or above. */
export const COVERED = 0.6;

function weights(m: Model): TeamFit["weights"] {
  return m.finance.team_fit_weights ?? { roleFit: 0.45, coverage: 0.25, complementarity: 0.15, availability: 0.15 };
}

function projectsOf(m: Model, personId: string): Set<string> {
  return new Set((m.assignments.get(personId) ?? []).map((a) => a.project_id));
}

/** Score a team: one slot per role, a slot may be empty (an unfilled gap). */
export function teamFit(roles: RoleRequirement[], slots: (Candidate | null)[], m: Model = data()): TeamFit {
  const w = weights(m);
  const members = slots.filter((c): c is Candidate => !!c);
  const threshold = Number(m.finance.role_fill_threshold ?? 0.7);

  // role fit: each role's member score, an empty role scores 0
  const roleFit = mean(roles.map((_, i) => slots[i]?.score ?? 0));

  // skill coverage: every must-have skill across all roles, best holder on the team
  const skillIds = [...new Set(roles.flatMap((r) => r.must))];
  const skills = skillIds.map((sid) => {
    const byPerson: Record<string, number> = {};
    for (const c of members) byPerson[c.personId] = capability(m, c.personId, sid).value;
    const best = Math.max(0, ...Object.values(byPerson));
    return { skillId: sid, skill: m.skills.get(sid)?.name ?? sid, best: round2(best), byPerson };
  });
  const coverage = skills.length ? skills.filter((s) => s.best >= COVERED).length / skills.length : 0;

  // complementarity: share of members who are the team's strongest holder of at least one covered skill
  const brings: Record<string, string[]> = {};
  for (const c of members) brings[c.personId] = [];
  for (const s of skills) {
    if (s.best < COVERED) continue;
    for (const [pid, v] of Object.entries(s.byPerson)) if (v === s.best) brings[pid].push(s.skill);
  }
  const complementarity = members.length ? members.filter((c) => brings[c.personId].length).length / members.length : 0;

  // working history (shown, not scored): pairs who already shared a project
  const proj = new Map(members.map((c) => [c.personId, projectsOf(m, c.personId)]));
  const pairs: TeamFit["pairs"] = [];
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const a = members[i], b = members[j];
      const shared = [...proj.get(a.personId)!].filter((p) => proj.get(b.personId)!.has(p));
      if (shared.length) pairs.push({ a: a.personId, b: b.personId, projects: shared.map((p) => m.projects.get(p)?.name ?? p) });
    }
  }


  // availability: 50% free time counts as fully available for a project of this size
  const availability = mean(members.map((c) => Math.min(1, c.availabilityPct / 50)));

  const parts = { roleFit: round2(roleFit), coverage: round2(coverage), complementarity: round2(complementarity), availability: round2(availability) };
  const score = round2(w.roleFit * roleFit + w.coverage * coverage + w.complementarity * complementarity + w.availability * availability);
  const warnings: TeamFit["warnings"] = [];
  roles.forEach((r, i) => {
    const c = slots[i];
    if (!c) warnings.push({ role: r.role, text: "No one in this role yet" });
    else {
      if (c.score < threshold) warnings.push({ role: r.role, personId: c.personId, text: `${c.name} is below the ${Math.round(threshold * 100)}% fill threshold for this role: plan reskilling` });
      if (c.availabilityPct < 20) warnings.push({ role: r.role, personId: c.personId, text: `${c.name} is only ${c.availabilityPct}% available` });
    }
  });
  for (const s of skills) if (s.best < COVERED) warnings.push({ text: `${s.skill} is not covered by anyone on the team` });
  for (const c of members) if (!brings[c.personId].length) warnings.push({ personId: c.personId, text: `${c.name} adds no skill the rest of the team lacks` });
  const notes: string[] = [];
  if (members.length > 1 && !pairs.length) notes.push("First-time team: no two members have shared a project yet. Plan a kick-off.");
  return { score, parts, weights: w, skills, brings, pairs, warnings, notes, threshold };
}

/** Re-score a team chosen in the Challenge Team dialog. Value is re-estimated only for free-text requests. */
export function evaluateTeam(roles: RoleRequirement[], personIds: (string | null)[], hasOpportunity: boolean, m: Model = data()): TeamEvaluation {
  const slots = roles.map((r, i) => (personIds[i] && m.people.has(personIds[i]!) ? scorePerson(personIds[i]!, r, m) : null));
  const members = slots.filter((c): c is Candidate => !!c);
  return {
    slots,
    fit: teamFit(roles, slots, m),
    coverage: roles.length ? round2(members.length / roles.length) : 0,
    value: hasOpportunity ? null : estimateValue(roles, members, m),
  };
}

/** The best person for a role who is not on the team and not already passed over. */
export function nextBest(role: RoleRequirement, exclude: string[], m: Model = data()): Candidate | null {
  return rankForRole(role, new Set(exclude), m)[0] ?? null;
}

/** People whose name matches, scored for the role, best fit first. */
export function searchForRole(role: RoleRequirement, q: string, exclude: string[], m: Model = data(), limit = 8): Candidate[] {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return [];
  const skip = new Set(exclude);
  return eligiblePeople(m)
    .filter((id) => !skip.has(id) && m.people.get(id)!.name.toLowerCase().includes(needle))
    .map((id) => scorePerson(id, role, m))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);
}
