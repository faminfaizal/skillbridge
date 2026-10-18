// Stated assumptions behind the social ledger (SOCIAL) and the redeployment answer (EXPOSURE). Every constant is shown
// to users as a sentence; finance_params "social" and "exposure" (when present) override the numbers.
import type { Model } from "./data.ts";
import { TRAVEL } from "./geo.ts";

export const SOCIAL = {
  tripKm: 5200,                             // return flight for one consultant visit
  co2eKgPerKm: TRAVEL.flightCo2eKgPerKm,    // per passenger km, as in proximity staffing
  daysPerTrip: 5,                           // consultant days covered by one trip
  volunteerHoursPerRequest: 8,              // one working day per open community request
};

export const EXPOSURE = {
  opportunityId: "OPP-002",                 // the AI customer-service rollout
  departments: ["DEP-CC"],
  titlePattern: "customer service executive",
  excludeLevels: ["C", "GM", "SM", "M"],    // leaders run the change; they are not exposed by it
  maxReskillWeeks: 16,
  severanceWeeksPerYear: 2,
  severanceMinWeeks: 4,
  severanceMaxWeeks: 26,
  hoursPerWeek: 40,
};

export type SocialAssumptions = typeof SOCIAL;
export type ExposureRule = typeof EXPOSURE;

export function socialAssumptions(m: Model): SocialAssumptions {
  return { ...SOCIAL, ...(m.finance.social ?? {}) };
}

export function exposureRule(m: Model): ExposureRule {
  return { ...EXPOSURE, ...(m.finance.exposure ?? {}) };
}

const n = (x: number) => x.toLocaleString("en-US");

export function socialAssumptionText(s: SocialAssumptions, dayRate: number): string[] {
  return [
    `Consultant days avoided = cost avoided / $${n(dayRate)} consultant day rate (finance default).`,
    `One trip per ${s.daysPerTrip} consultant days, ${n(s.tripKm)} km return by air.`,
    `Flight emissions ${s.co2eKgPerKm} kg CO2e per passenger km.`,
    `Requested volunteer hours: ${s.volunteerHoursPerRequest} hours per open community request.`,
    "Live figures come only from approvals made in the app; seed figures from the recorded history.",
  ];
}

export function exposureText(e: ExposureRule): string[] {
  return [
    `Exposed: ${e.departments.join(", ")} people titled "${e.titlePattern}", excluding levels ${e.excludeLevels.join(", ")} (they lead the change).`,
    `Destinations: every role of every open opportunity (one slot each) plus open requisitions as single-skill roles.`,
    `Ready now = match score at the role-fill threshold or above; otherwise the smallest learning path, if it reaches readiness within ${e.maxReskillWeeks} weeks.`,
    `Severance avoided = clamp(years of service x ${e.severanceWeeksPerYear}, ${e.severanceMinWeeks}, ${e.severanceMaxWeeks}) weeks x loaded hourly rate x ${e.hoursPerWeek} hours.`,
    "Hiring avoided = the open requisition for the destination skills, else the recruitment formula.",
  ];
}
