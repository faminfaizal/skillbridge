// Proximity staffing: rank consenting, available people for a role by fit, travel time to the place, and availability.
// People who keep their profile private are never ranked or named; the caller only learns how many would have qualified.
import { data, type Model } from "./data.ts";
import { capability, eligiblePeople, scorePerson } from "./match.ts";
import { trip, type Place, type Trip } from "./geo.ts";
import type { RoleRequirement, SkillCapability } from "../types.ts";

export interface Weights { fit: number; prox: number; avail: number }
export interface NearbyOptions { w: Weights; minFit: number; minCap?: number; exclude?: Set<string> }
export interface NearbyCandidate {
  personId: string; name: string; title: string; level: string; locationId: string; location: string;
  fit: number; proximity: number; availability: number; total: number; availabilityPct: number; ratePerHour: number;
  capabilities: SkillCapability[]; trip: Trip;
}

export const MIN_AVAILABILITY = 10;
const round2 = (x: number) => Math.round(x * 100) / 100;
export const proximityScore = (etaHours: number) => 1 - Math.min(1, etaHours / 12);
export const availabilityScore = (pct: number) => Math.min(1, pct / 50);

/** Not C level, at least 10% available; `visible` splits consenting people from those who keep their profile private. */
function pool(m: Model, visible: boolean): string[] {
  return eligiblePeople(m).filter((id) => {
    const p = m.people.get(id)!;
    return p.level !== "C" && (p.consent_visibility === 1) === visible && p.availability_pct >= MIN_AVAILABILITY;
  });
}

/** Everyone who may be staffed and named: consenting, not C level, available. */
export function consentingPool(m: Model = data()): Set<string> {
  return new Set(pool(m, true));
}

function qualifies(m: Model, id: string, role: RoleRequirement, minFit: number, minCap?: number): boolean {
  if (minCap !== undefined && !role.must.every((s) => capability(m, id, s).value >= minCap)) return false;
  return scorePerson(id, role, m).score >= minFit;
}

/** Private people who would have qualified. Ids stay inside the engine: callers show only the count. */
export function privateQualifiers(role: RoleRequirement, minFit: number, minCap?: number, m: Model = data()): string[] {
  return pool(m, false).filter((id) => qualifies(m, id, role, minFit, minCap));
}

export function rankNearby(role: RoleRequirement, place: Place, opts: NearbyOptions, m: Model = data()): { candidates: NearbyCandidate[]; privateQualified: number } {
  const { w, minFit, minCap, exclude } = opts;
  const candidates: NearbyCandidate[] = [];
  for (const id of pool(m, true)) {
    if (exclude?.has(id)) continue;
    const c = scorePerson(id, role, m);
    if (c.score < minFit) continue;
    if (minCap !== undefined && !c.capabilities.every((x) => x.value >= minCap)) continue;
    const p = m.people.get(id)!;
    const t = trip(p.location_id, place);
    const proximity = round2(proximityScore(t.etaHours));
    const availability = round2(availabilityScore(p.availability_pct));
    candidates.push({
      personId: id, name: p.name, title: p.title, level: p.level, locationId: p.location_id, location: m.locations.get(p.location_id) ?? p.location_id,
      fit: c.score, proximity, availability, total: round2(w.fit * c.score + w.prox * proximity + w.avail * availability),
      availabilityPct: p.availability_pct, ratePerHour: p.loaded_rate_amt, capabilities: c.capabilities, trip: t,
    });
  }
  candidates.sort((a, b) => b.total - a.total || b.fit - a.fit || a.personId.localeCompare(b.personId));
  const privateQualified = privateQualifiers(role, minFit, minCap, m).length;
  return { candidates, privateQualified };
}
