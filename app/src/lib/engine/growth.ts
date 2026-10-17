// Growth paths (Reskilling Intelligence, employee view): open roles a person can take now, and the ones they are
// close to, with the smallest learning path. Career visibility, not assessment.
import { data } from "./data.ts";
import { readiness, scorePerson } from "./match.ts";
import { learningPlan } from "./reskill.ts";
import { openOpportunities } from "./portfolio.ts";
import type { GrowthPaths } from "../types.ts";

export function growthPaths(personId: string): GrowthPaths {
  const m = data();
  if (!m.people.has(personId)) return { readyNow: [], nearlyReady: [] };
  const threshold = Number(m.finance.role_fill_threshold ?? 0.7);
  const [lo, hi] = (m.finance.reskill_band ?? [0.6, 0.8]) as number[];
  const readyNow: GrowthPaths["readyNow"] = [];
  const nearlyReady: GrowthPaths["nearlyReady"] = [];
  for (const o of openOpportunities()) {
    for (const role of o.roles) {
      const score = scorePerson(personId, role, m).score;
      if (score >= threshold) {
        readyNow.push({ opportunityId: o.id, title: o.title, role: role.role, score });
        continue;
      }
      const r = readiness(m, personId, [...role.must, ...role.nice]);
      if (r < lo || r >= hi) continue;
      const plan = learningPlan(m, personId, role);
      if (!plan.path.length) continue;
      nearlyReady.push({ opportunityId: o.id, title: o.title, role: role.role, readiness: r, weeks: plan.weeks, costAmt: plan.costAmt,
        steps: plan.path.map((s) => `${s.name} (${s.weeks}w)`) });
    }
  }
  readyNow.sort((a, b) => b.score - a.score);
  nearlyReady.sort((a, b) => b.readiness - a.readiness || a.weeks - b.weeks);
  return { readyNow: readyNow.slice(0, 3), nearlyReady: nearlyReady.slice(0, 3) };
}
