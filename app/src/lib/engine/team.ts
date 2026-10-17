// Team formation: best candidate per role, capability gaps, and the smallest reskilling path for each gap.
import { data, type Model } from "./data.ts";
import { rankForRole } from "./match.ts";
import { reskillCandidates } from "./reskill.ts";
import type { Candidate, Gap, RoleRequirement } from "../types.ts";

export interface TeamResult {
  team: Candidate[];
  gaps: Gap[];
  coverage: number;
}

export function formTeam(roles: RoleRequirement[], m: Model = data()): TeamResult {
  const threshold = Number(m.finance.role_fill_threshold ?? 0.7);
  const chosen = new Set<string>();
  const team: Candidate[] = [];
  const gaps: Gap[] = [];
  for (const role of roles) {
    const ranked = rankForRole(role, chosen, m);
    const top = ranked[0];
    if (top && top.score >= threshold) {
      team.push(top);
      chosen.add(top.personId);
    } else {
      gaps.push({
        role: role.role,
        skills: role.must.map((s) => m.skills.get(s)?.name ?? s),
        bestScore: top ? top.score : 0,
        reskill: [],
      });
    }
  }
  // reskilling candidates are chosen after the team so team members are not double-booked
  for (const role of roles) {
    const g = gaps.find((x) => x.role === role.role);
    if (!g) continue;
    g.reskill = reskillCandidates(m, role, chosen);
    for (const r of g.reskill) chosen.add(r.personId);
  }
  // coverage: share of roles that internal capability can fill now (PRD 8.4: "internal capability covers 82%")
  const coverage = roles.length ? Math.round((team.length / roles.length) * 100) / 100 : 0;
  return { team, gaps, coverage };
}
