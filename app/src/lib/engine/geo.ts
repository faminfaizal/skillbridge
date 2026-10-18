// Geography for proximity staffing: office and field-town coordinates, distances, and what a trip costs in time,
// money and emissions. Every figure here is a stated assumption (TRAVEL), so the engine stays deterministic.
import { all } from "../db.ts";

export interface Place { id: string; name: string; lat: number; lon: number; locId?: string }

/** Offices (people.location_id). */
export const OFFICES: Record<string, Place> = {
  "LOC-SIN": { id: "LOC-SIN", name: "Singapore HQ", lat: 1.29, lon: 103.85, locId: "LOC-SIN" },
  "LOC-BLR": { id: "LOC-BLR", name: "Bengaluru", lat: 12.97, lon: 77.59, locId: "LOC-BLR" },
  "LOC-LIS": { id: "LOC-LIS", name: "Lisbon", lat: 38.72, lon: -9.14, locId: "LOC-LIS" },
  "LOC-SYD": { id: "LOC-SYD", name: "Sydney", lat: -33.87, lon: 151.21, locId: "LOC-SYD" },
  "LOC-MNL": { id: "LOC-MNL", name: "Manila", lat: 14.6, lon: 120.98, locId: "LOC-MNL" },
  "LOC-DRW": { id: "LOC-DRW", name: "Darwin", lat: -12.46, lon: 130.84, locId: "LOC-DRW" },
  "LOC-CNS": { id: "LOC-CNS", name: "Cairns", lat: -16.92, lon: 145.77, locId: "LOC-CNS" },
};

/** Field towns a situation report or a community request may name, plus the offices. */
export const PLACES: Place[] = [
  ...Object.values(OFFICES),
  { id: "PL-KTH", name: "Katherine", lat: -14.47, lon: 132.26 },
  { id: "PL-PAL", name: "Palmerston", lat: -12.48, lon: 130.98 },
  { id: "PL-TNC", name: "Tennant Creek", lat: -19.65, lon: 134.19 },
  { id: "PL-ASP", name: "Alice Springs", lat: -23.7, lon: 133.88 },
  { id: "PL-TSV", name: "Townsville", lat: -19.26, lon: 146.82 },
  { id: "PL-MRB", name: "Mareeba", lat: -17.0, lon: 145.42 },
  { id: "PL-PDG", name: "Port Douglas", lat: -16.48, lon: 145.46 },
];

/** Travel assumptions, shown to users as stated assumptions. */
export const TRAVEL = {
  localKm: 30,           // within this, travel is local
  localKmh: 40,
  roadMaxKm: 600,        // beyond this, people fly
  roadKmh: 80,
  flightKmh: 750,
  flightOverheadH: 3,    // check-in, transfers, last leg
  mobiliseH: 0.5,        // pack up and leave
  roadCo2eKgPerKm: 0.17, // per vehicle
  flightCo2eKgPerKm: 0.15, // per passenger
  roadCostPerKm: 0.6,
  flightCostPerKm: 0.25,
  flightFixedCost: 150,
};

export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(b.lat - a.lat), dLon = r(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface Trip { km: number; mode: "local" | "road" | "flight"; etaHours: number; co2eKg: number; costAmt: number }

/** One-way trip from an office to a place. Emissions and cost cover the return journey. */
export function trip(fromLocId: string, to: Place): Trip {
  const from = OFFICES[fromLocId];
  if (!from) return { km: 99999, mode: "flight", etaHours: 48, co2eKg: 0, costAmt: 0 };
  const km = Math.round(haversineKm(from, to));
  const T = TRAVEL;
  if (km <= T.localKm) return { km, mode: "local", etaHours: round1(T.mobiliseH + km / T.localKmh), co2eKg: Math.round(2 * km * T.roadCo2eKgPerKm), costAmt: Math.round(2 * km * T.roadCostPerKm) };
  if (km <= T.roadMaxKm) return { km, mode: "road", etaHours: round1(T.mobiliseH + km / T.roadKmh), co2eKg: Math.round(2 * km * T.roadCo2eKgPerKm), costAmt: Math.round(2 * km * T.roadCostPerKm) };
  return { km, mode: "flight", etaHours: round1(T.mobiliseH + T.flightOverheadH + km / T.flightKmh), co2eKg: Math.round(2 * km * T.flightCo2eKgPerKm), costAmt: Math.round(T.flightFixedCost + 2 * km * T.flightCostPerKm) };
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/** The place a text names, longest name first ("Port Douglas" before "Douglas"). */
export function findPlace(text: string): Place | null {
  const t = text.toLowerCase();
  const byName = [...PLACES].sort((a, b) => b.name.length - a.name.length);
  return byName.find((p) => t.includes(p.name.toLowerCase().replace(" hq", ""))) ?? null;
}

export function placeById(id: string): Place | null {
  return PLACES.find((p) => p.id === id) ?? null;
}

let remote: Set<string> | null = null;
/** Offices in remote regions (locations.remote_region = 1). */
export function isRemote(locId: string): boolean {
  if (!remote) {
    try {
      remote = new Set(all<{ id: string }>("SELECT id FROM locations WHERE remote_region = 1").map((r) => r.id));
    } catch {
      remote = new Set(["LOC-DRW", "LOC-CNS"]);
    }
  }
  return remote.has(locId);
}
