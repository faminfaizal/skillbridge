// Job vacancy to fill: a post, typed details or a read job description becomes a role requirement, and the
// deterministic engine ranks internal people for it. No AI in any score; nothing is stored and nobody is contacted.
import { data, type Model } from "./data.ts";
import { BadInput } from "./intake.ts";
import { capability, rankForRole } from "./match.ts";
import { positionById, positionRequirement } from "./positions.ts";
import { learningPlan } from "./reskill.ts";
import { COVERED } from "./teamFit.ts";
import type { GradeMove, RoleRequirement, VacancyInput, VacancyMatch, VacancyResult } from "../types.ts";

/** Grade code to rank (1 = most senior), read from the people table. */
function rankOf(m: Model, level: string | null | undefined): number | null {
  if (!level) return null;
  for (const p of m.people.values()) if (p.level === level) return p.level_rank;
  return null;
}

function moveOf(candidateRank: number, target: number | null): GradeMove {
  if (target === null) return "lateral";
  const d = candidateRank - target;
  return d === 0 ? "lateral" : d === 1 ? "step up" : d >= 2 ? "stretch" : "step down";
}

/** Known skills only, must wins over nice, no duplicates; a vacancy with only nice-to-haves treats them as must. */
export function normaliseVacancy(v: VacancyInput, m: Model = data()): VacancyInput {
  const known = (ids: string[]) => [...new Set(ids.filter((s) => m.skills.has(s)))];
  let must = known(v.must ?? []);
  let nice = known(v.nice ?? []).filter((s) => !must.includes(s));
  if (!must.length) { must = nice; nice = []; }
  if (!must.length) throw new BadInput("Add at least one skill from the skills list before matching.");
  return { ...v, title: (v.title ?? "").trim().slice(0, 120), must: must.slice(0, 12), nice: nice.slice(0, 12) };
}

export function matchVacancy(input: VacancyInput, limit = 8, m: Model = data()): VacancyResult {
  let v = input;
  const exclude = new Set<string>();
  let postRank: number | null = null;
  if (input.positionId) {
    const post = positionById(input.positionId, m);
    if (!post) throw new BadInput("That post was not found.");
    const req = positionRequirement(post);
    v = { title: post.title, level: post.level, responsibilities: post.responsibilities, competencies: post.competencies,
      must: req.must, nice: req.nice, positionId: post.id };
    exclude.add(post.personId);
    postRank = post.levelRank;
  }
  v = normaliseVacancy(v, m);
  const target = rankOf(m, v.level) ?? postRank;
  const role: RoleRequirement = { role: v.title || "Vacancy", must: v.must, nice: v.nice };
  const threshold = Number(m.finance.role_fill_threshold ?? 0.7);

  const ranked = rankForRole(role, exclude, m);
  const visible = ranked.filter((c) => m.people.get(c.personId)!.consent_visibility === 1);
  const top = visible.slice(0, limit);
  const floor = top.length ? top[top.length - 1].score : 1;
  const privateCount = ranked.filter((c) => m.people.get(c.personId)!.consent_visibility !== 1 && c.score >= floor).length;

  const shortlist: VacancyMatch[] = top.map((c) => {
    const p = m.people.get(c.personId)!;
    const skills = [...v.must.map((s) => ({ s, must: true })), ...v.nice.map((s) => ({ s, must: false }))].map(({ s, must }) => {
      const value = capability(m, c.personId, s).value;
      return { skillId: s, skill: m.skills.get(s)?.name ?? s, must, value, met: value >= COVERED };
    });
    const readyNow = c.score >= threshold;
    const gaps = skills.filter((s) => s.must && !s.met).map((s) => s.skill);
    const weeks = !readyNow && gaps.length ? learningPlan(m, c.personId, role).weeks || null : null;
    return {
      personId: c.personId, name: c.name, post: p.title, level: p.level, unit: c.department, location: c.location,
      move: moveOf(p.level_rank, target), score: c.score, readyNow, availabilityPct: c.availabilityPct, hidden: c.hidden,
      breakdown: c.breakdown, evidence: c.evidence.slice(0, 3), skills, gaps, weeks,
    };
  });

  const w = m.finance.match_weights ?? { skill: 0.4, project: 0.2, domain: 0.15, recency: 0.15, adjacent: 0.1 };
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return {
    vacancy: { ...v, titleShown: v.title || "Untitled post", levelRank: target },
    shortlist, privateCount,
    basis: [
      `Match score: required skills ${pct(w.skill)}, project experience ${pct(w.project)}, context skills ${pct(w.domain)}, recency ${pct(w.recency)}, related skills ${pct(w.adjacent)}.`,
      `Ready now at a match of ${pct(threshold)} or more; a skill counts as met at ${pct(COVERED)} capability.`,
      "Skills include those AI inferred from work records, each backed by evidence. Responsibilities are shown, not scored.",
      "People who keep their profile private and the executive team are left out.",
    ],
  };
}
