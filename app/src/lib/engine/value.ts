// Financial value of activating internal capability (PRD 6). Formulas and their assumptions are returned together.
import { data, type Model } from "./data.ts";
import type { Candidate, RoleRequirement, ValueEstimate } from "../types.ts";

export interface OpportunityRow {
  id: string; title: string; kind: string; external_quote_amt: number; internal_cost_amt: number; revenue_potential_amt: number;
  hours_saved: number; win_probability: number;
}

export function valueForOpportunity(o: OpportunityRow, m: Model = data()): ValueEstimate {
  const blended = Number(m.finance.blended_rate_amt ?? 100);
  return {
    costAvoided: Math.max(0, o.external_quote_amt - o.internal_cost_amt),
    productivity: o.hours_saved * blended,
    revenuePotential: o.revenue_potential_amt,
    recruitmentAvoided: 0,
    estimated: false,
    assumptions: [
      `Cost avoided = external quote $${o.external_quote_amt.toLocaleString()} - internal cost $${o.internal_cost_amt.toLocaleString()}`,
      `Productivity = ${o.hours_saved} hours recovered x blended $${blended}/hour`,
      `Revenue potential = opportunity value (win probability ${Math.round(o.win_probability * 100)}%)`,
    ],
  };
}

/** For a free-text request with no matching opportunity: conservative estimate from consultant day rates. */
export function estimateValue(roles: RoleRequirement[], team: Candidate[], m: Model = data()): ValueEstimate {
  const rates = m.finance.consultant_day_rate_amt ?? { default: 4000 };
  const blended = Number(m.finance.blended_rate_amt ?? 100);
  const searchHours = Number(m.finance.expert_search_hours_before ?? 16) - Number(m.finance.expert_search_hours_after ?? 0.25);
  const days = 20;
  let external = 0;
  let internal = 0;
  for (const c of team) {
    const role = roles.find((r) => r.role === c.role);
    const fam = role ? m.skills.get(role.must[0])?.family ?? "default" : "default";
    external += (rates[fam] ?? rates.default) * days;
    internal += (m.people.get(c.personId)?.loaded_rate_amt ?? blended) * 8 * days;
  }
  return {
    costAvoided: Math.max(0, Math.round((external - internal) / 1000) * 1000),
    productivity: Math.round(team.length * searchHours * blended),
    revenuePotential: 0,
    recruitmentAvoided: 0,
    estimated: true,
    assumptions: [
      `Estimated: ${days} working days per role at consultant day rates vs internal loaded cost`,
      `Productivity = ${team.length} expert searches x ${searchHours} hours saved x $${blended}/hour`,
    ],
  };
}
