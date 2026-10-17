// Reskilling Intelligence (PRD 8.5): target role -> required capability -> what the person has today -> gap ->
// smallest learning path -> time to readiness -> expected value. Formulas over the catalogue; no LLM.
import { all } from "../db.ts";
import type { Model } from "./data.ts";
import { eligiblePeople, readiness, skillReadiness } from "./match.ts";
import type { LearningStep, ReskillOption, RoleRequirement } from "../types.ts";

interface Training { id: string; name: string; skill_id: string; kind: string; cost_amt: number; weeks: number }
interface Cert { id: string; name: string; skill_id: string; cost_amt: number; months: number }
interface Requisition { id: string; title: string; skill_id: string; est_cost_amt: number; status: string }

let catalogue: { trainings: Training[]; certs: Cert[]; reqs: Requisition[] } | null = null;
function cat() {
  catalogue ??= {
    trainings: all<Training>("SELECT * FROM trainings ORDER BY id"),
    certs: all<Cert>("SELECT * FROM certifications ORDER BY id"),
    reqs: all<Requisition>("SELECT * FROM requisitions ORDER BY id"),
  };
  return catalogue;
}

// assumed capability gained per step (stated in the UI as an assumption)
export const UPLIFT: Record<string, number> = { short: 0.15, mentoring: 0.2, assignment: 0.25 };
const KIND_ORDER: Record<string, number> = { short: 0, mentoring: 1, assignment: 2 };
const MENTORING_WEEKS = 4;
const round2 = (x: number) => Math.round(x * 100) / 100;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Strongest consenting holder of a skill, used as a mentor when the catalogue has no course for it. */
function mentorFor(m: Model, skillId: string, exclude: string): { id: string; name: string } | null {
  let best: { id: string; name: string; level: number; avail: number } | null = null;
  for (const [pid, skills] of m.declared) {
    const d = skills.get(skillId);
    const p = m.people.get(pid)!;
    if (!d || d.level < 4 || pid === exclude || !p.consent_visibility || p.level === "C") continue;
    if (!best || d.level > best.level || (d.level === best.level && p.availability_pct > best.avail)) {
      best = { id: pid, name: p.name, level: d.level, avail: p.availability_pct };
    }
  }
  return best ? { id: best.id, name: best.name } : null;
}

/** What hiring for these skills would cost: an open requisition if there is one, else the recruitment formula. */
export function hireCost(m: Model, skillIds: string[]): { money: number; basis: string; requisitionId?: string } {
  const req = cat().reqs.find((r) => r.status === "open" && skillIds.includes(r.skill_id));
  if (req) return { money: req.est_cost_amt, basis: `open requisition ${req.id} (${req.title}) at $${req.est_cost_amt.toLocaleString()}`, requisitionId: req.id };
  const pct = Number(m.finance.recruitment_cost_pct_of_salary ?? 0.25);
  const rate = Number(m.finance.loaded_rate_by_level?.SE ?? 80);
  const money = Math.round((pct * rate * 8 * 220) / 1000) * 1000;
  return { money, basis: `recruitment at ${Math.round(pct * 100)}% of a senior engineer's annual cost ($${rate}/h x 1,760 h)` };
}

/** Smallest path for one person to one role. A skill is "ready" at the top of the reskill band (default 80%). */
export function learningPlan(m: Model, personId: string, role: RoleRequirement, today = new Date()): ReskillOption {
  const p = m.people.get(personId)!;
  const [, target] = (m.finance.reskill_band ?? [0.6, 0.8]) as number[];
  const trainings = cat().trainings;
  const skills = role.must.map((s) => {
    const r = skillReadiness(m, personId, s);
    return { skillId: s, skill: m.skills.get(s)?.name ?? s, now: r.value, after: r.value, via: r.via };
  });
  const steps: LearningStep[] = [];
  for (const s of skills) {
    if (s.now >= target) continue;
    const options: LearningStep[] = trainings
      .filter((t) => t.skill_id === s.skillId && (t.kind === "short" || t.kind === "assignment"))
      .map((t) => ({ id: t.id, name: t.name, kind: t.kind, weeks: t.weeks, costAmt: t.cost_amt, skill: s.skill }));
    if (!options.some((o) => o.kind === "short")) {
      const mentor = mentorFor(m, s.skillId, personId);
      if (mentor) options.push({ id: `MENTOR-${s.skillId}`, name: `Pair with ${mentor.name} on live ${s.skill} work`, kind: "mentoring",
        weeks: MENTORING_WEEKS, costAmt: 0, skill: s.skill, mentorId: mentor.id });
    }
    options.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.id.localeCompare(b.id));
    // smallest path: take steps in order (cheapest first) only until the skill reaches the target
    let v = s.now;
    for (const o of options) {
      if (v >= target) break;
      steps.push(o);
      v += UPLIFT[o.kind] ?? 0.1;
    }
    s.after = round2(Math.min(1, v));
  }
  steps.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.id.localeCompare(b.id));
  const weeks = steps.reduce((a, x) => a + x.weeks, 0);
  const costAmt = steps.reduce((a, x) => a + x.costAmt, 0);
  const gapSkills = new Set(skills.filter((s) => s.now < target).map((s) => s.skillId));
  const certT = trainings.find((t) => gapSkills.has(t.skill_id) && t.kind === "certification");
  const certC = cat().certs.find((c) => gapSkills.has(c.skill_id));
  const contrast = certT ? { id: certT.id, name: certT.name, weeks: certT.weeks, costAmt: certT.cost_amt }
    : certC ? { id: certC.id, name: certC.name, weeks: Math.round(certC.months * 4.33), costAmt: certC.cost_amt } : undefined;
  const hire = hireCost(m, role.must);
  const readyBy = new Date(today.getTime() + weeks * 7 * 86_400_000).toISOString().slice(0, 10);
  return {
    personId, name: p.name, title: p.title,
    readiness: readiness(m, personId, [...role.must, ...role.nice]),
    projected: round2(mean([...skills.map((s) => s.after), ...role.nice.map((s) => skillReadiness(m, personId, s).value)])),
    skills, path: steps, weeks, costAmt, readyBy, contrast,
    valueAmt: Math.max(0, hire.money - costAmt),
    valueBasis: `Hiring avoided: ${hire.basis}, minus $${costAmt.toLocaleString()} of training`,
  };
}

/** People inside the reskill band for a role, closest first. */
export function reskillCandidates(m: Model, role: RoleRequirement, exclude: Set<string> = new Set(), limit = 2): ReskillOption[] {
  const [lo, hi] = (m.finance.reskill_band ?? [0.6, 0.8]) as number[];
  const profile = [...role.must, ...role.nice];
  return eligiblePeople(m)
    .filter((id) => !exclude.has(id))
    .map((id) => ({ id, r: readiness(m, id, profile) }))
    .filter((x) => x.r >= lo && x.r < hi)
    .sort((a, b) => b.r - a.r || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map(({ id }) => learningPlan(m, id, role));
}
