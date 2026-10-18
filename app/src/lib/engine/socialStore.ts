// Social and environmental outcomes of approved actions (crisis mobilised, volunteering, redeployment), kept next to
// the money in impact_records. Written only by approvals; read by the social ledger (engine/social.ts).
import { all, get, run } from "../db.ts";

export type SocialKind = "crisis" | "volunteer" | "redeploy";

export interface SocialRow {
  ref: string;              // the crisis, community request or redeploy plan id
  kind: SocialKind;
  impactId: string | null;  // the impact record it belongs to, when the approval also created one
  co2eKg: number;
  travelKm: number;
  jobsRetained: number;
  volunteerHours: number;
  downtimeHours: number;
  peopleIds: string[];
  basis: string;            // how the figures were derived, shown to users
  createdAt?: string;
}

let ready = false;
export function ensureSocialTable(): void {
  if (ready) return;
  run(`CREATE TABLE IF NOT EXISTS social_records (
    ref TEXT PRIMARY KEY, kind TEXT NOT NULL, impact_id TEXT, co2e_kg REAL NOT NULL DEFAULT 0, travel_km REAL NOT NULL DEFAULT 0,
    jobs_retained INTEGER NOT NULL DEFAULT 0, volunteer_hours REAL NOT NULL DEFAULT 0, downtime_hours REAL NOT NULL DEFAULT 0,
    people_ids TEXT NOT NULL DEFAULT '', basis TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)`);
  ready = true;
}

export function recordSocial(r: SocialRow): void {
  ensureSocialTable();
  run(`INSERT OR REPLACE INTO social_records (ref, kind, impact_id, co2e_kg, travel_km, jobs_retained, volunteer_hours, downtime_hours, people_ids, basis, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    r.ref, r.kind, r.impactId, r.co2eKg, r.travelKm, r.jobsRetained, r.volunteerHours, r.downtimeHours, r.peopleIds.join(","), r.basis, new Date().toISOString());
}

export function socialRows(): SocialRow[] {
  ensureSocialTable();
  return all<{ ref: string; kind: SocialKind; impact_id: string | null; co2e_kg: number; travel_km: number; jobs_retained: number; volunteer_hours: number;
    downtime_hours: number; people_ids: string; basis: string; created_at: string }>("SELECT * FROM social_records ORDER BY created_at")
    .map((r) => ({ ref: r.ref, kind: r.kind, impactId: r.impact_id, co2eKg: r.co2e_kg, travelKm: r.travel_km, jobsRetained: r.jobs_retained,
      volunteerHours: r.volunteer_hours, downtimeHours: r.downtime_hours, peopleIds: r.people_ids ? r.people_ids.split(",") : [], basis: r.basis, createdAt: r.created_at }));
}

export function resetSocial(): number {
  ensureSocialTable();
  const n = get<{ n: number }>("SELECT COUNT(*) n FROM social_records")?.n ?? 0;
  run("DELETE FROM social_records");
  return n;
}
