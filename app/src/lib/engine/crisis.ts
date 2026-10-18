// Incident response team (business continuity): a situation report (text and/or a photo) becomes a team staffed by
// role fit, proximity and availability, compared with the team a skills-only search would send. The Risk Sentinel
// proposes it; a person approves. Every number is computed here; Gemini only reads the report.
import { all, get, run } from "../db.ts";
import { money } from "../format.ts";
import { mirror, publishEvent } from "../cloud/index.ts";
import { startRun, finishRun, propose, ensureAgentTables, type Step } from "../agents/store.ts";
import { data, type Model } from "./data.ts";
import { rankForRole } from "./match.ts";
import { activate } from "./impact.ts";
import { recordSocial } from "./socialStore.ts";
import { trip, TRAVEL, type Place } from "./geo.ts";
import { parseSitrep, type IntakeFile, type Severity } from "./intake.ts";
import { consentingPool, privateQualifiers, rankNearby, type NearbyCandidate } from "./proximity.ts";
import type { Provider, RoleRequirement } from "../types.ts";

export interface CrisisInput { text?: string; file?: IntakeFile; fallbackText?: string }

export interface TeamMember {
  personId: string; name: string; title: string; location: string; role: string; km: number; mode: "local" | "road" | "flight";
  etaHours: number; fit: number; availabilityPct: number; co2eKg: number; costAmt: number;
}
export interface RolePlan { role: string; skills: { id: string; name: string }[]; count: number; members: TeamMember[]; gap: boolean }
export interface CrisisTotals {
  etaHours: number; baselineEtaHours: number; downtimeHoursAvoided: number;
  travelKm: number; baselineTravelKm: number; travelKmAvoided: number;
  co2eKg: number; baselineCo2eKg: number; co2eKgAvoided: number;
  travelCostAmt: number; baselineCostAmt: number; travelCostAvoided: number;
  travelHours: number; baselineTravelHours: number; travelHoursAvoided: number;
  productivityAmt: number; valueAmt: number;
}
export interface CrisisPlan {
  id: string; createdAt: string; status: "proposed" | "mobilised" | "dismissed" | "no team";
  summary: string; place: { id: string; name: string; lat: number; lon: number }; severity: Severity; customersReported: number | null;
  provider: Provider; read: "photo" | "text" | "photo and text";
  roles: RolePlan[]; teamIds: string[]; skillIds: string[];
  baseline: { personId: string; role: string; location: string; km: number; mode: string; etaHours: number }[];
  totals: CrisisTotals; privateCount: number; inboxId: number | null; basis: string[]; weights: { fit: number; prox: number; avail: number };
}

export const WEIGHTS = { fit: 0.6, prox: 0.25, avail: 0.15 };
/** The more urgent the incident, the more travel time counts against a better fit further away. */
export const WEIGHTS_BY_SEVERITY: Record<Severity, typeof WEIGHTS> = {
  P1: { fit: 0.5, prox: 0.35, avail: 0.15 }, P2: WEIGHTS, P3: { fit: 0.7, prox: 0.15, avail: 0.15 },
};
export const MIN_FIT = 0.45;
const MAX_ROLES = 4, MAX_PER_ROLE = 3, MAX_TEAM = 8;

/** The bundled sample report (tools/samples/sitrep.html), read by the rules when Gemini cannot read the photo. */
export const SAMPLE_SITREP = [
  "Veridane Networks. Field Operations, Northern Territory. Field situation report FSR-NT-1018-02. Severity: P1.",
  "Location: Stuart Highway, 22 km south of Katherine NT.",
  "Event: an overnight storm with gusts above 100 km/h brought down an aerial fibre span (48-core trunk) between poles KTH-114 and KTH-117.",
  "Impact: 2 mobile sites offline on battery, about 4 h left. LoRaWAN gateway GW-KTH-03 serving the regional clinic's cold-chain and patient monitoring sensors offline.",
  "About 1,200 customers reported affected (mobile and fixed wireless).",
  "Requested: fibre splicing crew (2) to re-splice the trunk; OTDR testing (1) to locate further breaks and certify the repair;",
  "field coordination (1) for crew dispatch and road access; LoRaWAN restore (1) for the clinic gateway and sensors.",
].join(" ");

let ready = false;
function ensureTable(): void {
  if (ready) return;
  run(`CREATE TABLE IF NOT EXISTS crisis_events (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, place TEXT NOT NULL, severity TEXT NOT NULL,
    status TEXT NOT NULL, inbox_id INTEGER, people_ids TEXT NOT NULL DEFAULT '', plan TEXT NOT NULL)`);
  ready = true;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const nextId = () => `SIM-CRX-${(get<{ n: number | null }>("SELECT MAX(CAST(substr(id, 9) AS INTEGER)) n FROM crisis_events")?.n ?? 0) + 1}`;

function member(c: NearbyCandidate, role: string): TeamMember {
  return { personId: c.personId, name: c.name, title: c.title, location: c.location, role, km: c.trip.km, mode: c.trip.mode, etaHours: c.trip.etaHours,
    fit: c.fit, availabilityPct: c.availabilityPct, co2eKg: c.trip.co2eKg, costAmt: c.trip.costAmt };
}

/** Staff the roles: nearest good fit first, nobody twice, at most 8 people; plus the skills-only baseline. */
export function assemble(roles: RoleRequirement[], counts: number[], place: Place, w: typeof WEIGHTS = WEIGHTS, m: Model = data()) {
  const chosen = new Set<string>();
  const plans: RolePlan[] = [];
  roles.slice(0, MAX_ROLES).forEach((role, i) => {
    const want = Math.min(MAX_PER_ROLE, Math.max(1, counts[i] ?? 1), MAX_TEAM - chosen.size);
    const picks = want > 0 ? rankNearby(role, place, { w, minFit: MIN_FIT, exclude: chosen }, m).candidates.slice(0, want) : [];
    for (const p of picks) chosen.add(p.personId);
    plans.push({ role: role.role, skills: [...role.must, ...role.nice].map((id) => ({ id, name: m.skills.get(id)?.name ?? id })), count: want,
      members: picks.map((p) => member(p, role.role)), gap: picks.length < want });
  });
  // baseline: the same consent rules, ranked by skill only, the same number of people per role
  const visible = consentingPool(m);
  const hidden = new Set([...m.people.keys()].filter((id) => !visible.has(id)));
  const taken = new Set<string>(hidden);
  const baseline: CrisisPlan["baseline"] = [];
  roles.slice(0, MAX_ROLES).forEach((role, i) => {
    const n = plans[i].members.length;
    for (const c of rankForRole(role, taken, m).slice(0, n)) {
      taken.add(c.personId);
      const p = m.people.get(c.personId)!;
      const t = trip(p.location_id, place);
      baseline.push({ personId: c.personId, role: role.role, location: m.locations.get(p.location_id) ?? p.location_id, km: t.km, mode: t.mode, etaHours: t.etaHours });
    }
  });
  const privateCount = new Set(roles.slice(0, MAX_ROLES).flatMap((r) => privateQualifiers(r, MIN_FIT, undefined, m))).size;
  return { plans, baseline, privateCount };
}

export function totalsFor(plans: RolePlan[], baseline: CrisisPlan["baseline"], place: Place, m: Model = data()): CrisisTotals {
  const team = plans.flatMap((r) => r.members);
  const base = baseline.map((b) => ({ ...b, t: trip(m.people.get(b.personId)!.location_id, place) }));
  const etaHours = team.length ? Math.max(...team.map((x) => x.etaHours)) : 0;
  const baselineEtaHours = base.length ? Math.max(...base.map((x) => x.etaHours)) : 0;
  const travelKm = sum(team.map((x) => 2 * x.km)), baselineTravelKm = sum(base.map((x) => 2 * x.km));
  const co2eKg = sum(team.map((x) => x.co2eKg)), baselineCo2eKg = sum(base.map((x) => x.t.co2eKg));
  const travelCostAmt = sum(team.map((x) => x.costAmt)), baselineCostAmt = sum(base.map((x) => x.t.costAmt));
  const travelHours = round1(sum(team.map((x) => 2 * x.etaHours))), baselineTravelHours = round1(sum(base.map((x) => 2 * x.etaHours)));
  const travelHoursAvoided = round1(Math.max(0, baselineTravelHours - travelHours));
  const avgRate = team.length ? sum(team.map((x) => m.people.get(x.personId)!.loaded_rate_amt)) / team.length : 0;
  const travelCostAvoided = Math.max(0, baselineCostAmt - travelCostAmt);
  const productivityAmt = Math.round(travelHoursAvoided * avgRate);
  return {
    etaHours, baselineEtaHours, downtimeHoursAvoided: round1(Math.max(0, baselineEtaHours - etaHours)),
    travelKm, baselineTravelKm, travelKmAvoided: Math.max(0, baselineTravelKm - travelKm),
    co2eKg, baselineCo2eKg, co2eKgAvoided: Math.max(0, baselineCo2eKg - co2eKg),
    travelCostAmt, baselineCostAmt, travelCostAvoided,
    travelHours, baselineTravelHours, travelHoursAvoided, productivityAmt, valueAmt: travelCostAvoided + productivityAmt,
  };
}

const basisFor = (sev: Severity, w: typeof WEIGHTS) => [
  `Team ranked by fit ${w.fit}, proximity ${w.prox} and availability ${w.avail} (${sev}; P2 is ${WEIGHTS.fit}/${WEIGHTS.prox}/${WEIGHTS.avail}); minimum fit ${MIN_FIT}. Proximity is 1 - ETA/12 h. Baseline: the same consenting people ranked by skill alone.`,
  `Travel: local within ${TRAVEL.localKm} km, road up to ${TRAVEL.roadMaxKm} km at ${TRAVEL.roadKmh} km/h, flights at ${TRAVEL.flightKmh} km/h plus ${TRAVEL.flightOverheadH} h; ${TRAVEL.mobiliseH} h to mobilise.`,
  `Km, CO2e, cost and travel hours cover the return trip. CO2e ${TRAVEL.roadCo2eKgPerKm} kg/km by road (per vehicle), ${TRAVEL.flightCo2eKgPerKm} kg/km by air (per passenger).`,
  "Downtime avoided: how much sooner the whole team is on site. Productivity: travel hours avoided x the team's average loaded hourly rate.",
  "Customers affected is shown as reported and is not used in any value.",
];

/** Read the report, staff the team, store the plan and put it in the Risk Sentinel's proposals. */
export async function respond(input: CrisisInput): Promise<CrisisPlan> {
  ensureTable();
  ensureAgentTables();
  const m = data();
  const t0 = Date.now();
  const s = await parseSitrep({ text: input.text, file: input.file, fallbackText: input.fallbackText }, m);
  const readMs = Date.now() - t0;
  if (!s.place) throw new Error("The report does not name a place SkillBridge knows. Add the nearest town (for example Katherine, Tennant Creek or Townsville).");
  if (!s.roles.length) throw new Error("No crew or skill could be read from the report. Name the work needed, for example fibre splicing or OTDR testing.");
  const place = s.place;
  const t1 = Date.now();
  // staffed on the role's first (core) skill; extra skills are shown, not scored, so they cannot sink a nearby specialist
  const roles: RoleRequirement[] = s.roles.map((r) => ({ role: r.role, must: r.must.slice(0, 1), nice: [] }));
  const extra = s.roles.map((r) => r.must.slice(1));
  const w = WEIGHTS_BY_SEVERITY[s.severity] ?? WEIGHTS;
  const { plans, baseline, privateCount } = assemble(roles, s.roles.map((r) => r.count), place, w, m);
  plans.forEach((p, i) => p.skills.push(...extra[i].map((id) => ({ id, name: m.skills.get(id)?.name ?? id }))));
  const totals = totalsFor(plans, baseline, place, m);
  const rankMs = Date.now() - t1;
  const team = plans.flatMap((r) => r.members);
  const skillIds = [...new Set(plans.flatMap((r) => r.skills.map((x) => x.id)))];
  const id = nextId();
  const plan: CrisisPlan = {
    id, createdAt: new Date().toISOString(), status: team.length ? "proposed" : "no team", summary: s.summary,
    place: { id: place.id, name: place.name, lat: place.lat, lon: place.lon }, severity: s.severity, customersReported: s.customersReported,
    provider: s.provider, read: s.read, roles: plans, teamIds: team.map((x) => x.personId), skillIds, baseline, totals, privateCount, inboxId: null, basis: basisFor(s.severity, w), weights: w,
  };

  const ai = s.provider === "vertex" || s.provider === "cache";
  const offices = [...new Set(team.map((x) => x.location))];
  const steps: Step[] = [
    { tool: ai ? "Gemini read" : "Rules read", detail: `Read the ${s.read}: ${s.severity} at ${place.name}, ${s.roles.length} roles${s.customersReported ? `, ${s.customersReported.toLocaleString("en-US")} customers reported` : ""}.`, ms: readMs, ai },
    { tool: "Place resolved", detail: `${place.name} (${place.lat}, ${place.lon}).`, ms: 0 },
    { tool: "Proximity ranking", detail: `${team.length} people from ${offices.join(", ") || "no office"}: on site in ${totals.etaHours} h, against ${totals.baselineEtaHours} h staffed by skill alone.`, ms: rankMs },
    { tool: "Consent check", detail: `${privateCount} qualified people keep their profile private: counted, not named.`, ms: 0 },
  ];
  const runId = startRun("sentinel", "Situation report");
  const nodeIds = [...plan.teamIds, ...skillIds];
  const summary = team.length
    ? `Incident team of ${team.length} for ${place.name}: on site in ${totals.etaHours} h; ${totals.travelKmAvoided.toLocaleString("en-US")} km of travel avoided.`
    : `No consenting person qualifies for ${place.name}.`;
  finishRun(runId, "done", steps, summary, s.provider, nodeIds);

  if (team.length) {
    const value = { costAvoided: totals.travelCostAvoided, productivity: totals.productivityAmt };
    const social = { co2eKg: totals.co2eKgAvoided, travelKm: totals.travelKmAvoided, downtimeHours: totals.downtimeHoursAvoided,
      basis: `Against a skills-only team: ${totals.downtimeHoursAvoided} h sooner on site, ${totals.travelKmAvoided} km and ${totals.co2eKgAvoided} kg CO2e of return travel avoided.` };
    propose({
      agent: "sentinel", runId, kind: "mobilise", title: `Mobilise incident team: ${place.name}`,
      detail: `${s.summary} Team of ${team.length} from ${offices.join(", ")}: on site in ${totals.etaHours} h, against ${totals.baselineEtaHours} h if staffed by skill alone.`,
      evidence: [
        ...team.map((x) => `${x.name}, ${x.title} (${x.location}), ${x.role}: ${x.km} km by ${x.mode}, ${x.etaHours} h, fit ${Math.round(x.fit * 100)}%`),
        `Travel avoided: ${totals.travelKmAvoided.toLocaleString("en-US")} km, ${totals.co2eKgAvoided} kg CO2e, ${money(totals.travelCostAvoided)}, ${totals.travelHoursAvoided} travel hours.`,
        `${privateCount} qualified people kept private.`,
      ],
      valueAmt: totals.valueAmt, nodeIds, approver: "Head of Field Ops Regional",
      action: { type: "mobilise", crisisId: id, place: place.name, personIds: plan.teamIds, value, social },
      dedupeKey: `crisis:${id}`, provider: s.provider,
    });
    plan.inboxId = get<{ id: number }>("SELECT id FROM agent_inbox WHERE dedupe_key = ?", `crisis:${id}`)?.id ?? null;
  }
  run("INSERT INTO crisis_events (id, created_at, place, severity, status, inbox_id, people_ids, plan) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    id, plan.createdAt, place.name, s.severity, plan.status, plan.inboxId, plan.teamIds.join(","), JSON.stringify(plan));

  // cloud copies carry no names: roles, counts and totals only
  mirror("crises", id, { id, createdAt: plan.createdAt, place: place.name, severity: s.severity, status: plan.status, provider: s.provider,
    roles: plans.map((r) => ({ role: r.role, skills: r.skills.map((x) => x.name), filled: r.members.length, wanted: r.count })),
    teamSize: team.length, privateCount, totals });
  void publishEvent("crisis", { id, place: place.name, severity: s.severity, teamSize: team.length, etaHours: totals.etaHours,
    downtimeHoursAvoided: totals.downtimeHoursAvoided, co2eKgAvoided: totals.co2eKgAvoided }).catch(() => false);
  return plan;
}

function withStatus(plan: CrisisPlan, rowStatus: string): CrisisPlan {
  if (rowStatus === "mobilised") return { ...plan, status: "mobilised" };
  if (plan.inboxId) {
    const st = get<{ status: string }>("SELECT status FROM agent_inbox WHERE id = ?", plan.inboxId)?.status;
    if (st === "dismissed") return { ...plan, status: "dismissed" };
  }
  return plan;
}

export function latestCrisis(): CrisisPlan | null {
  ensureTable();
  ensureAgentTables();
  const r = get<{ plan: string; status: string }>("SELECT plan, status FROM crisis_events ORDER BY created_at DESC, rowid DESC LIMIT 1");
  return r ? withStatus(JSON.parse(r.plan) as CrisisPlan, r.status) : null;
}

export function crisisById(id: string): CrisisPlan | null {
  ensureTable();
  const r = get<{ plan: string; status: string }>("SELECT plan, status FROM crisis_events WHERE id = ?", id);
  return r ? withStatus(JSON.parse(r.plan) as CrisisPlan, r.status) : null;
}

/** Approval of a "mobilise" proposal (agents/actions.ts): an impact record, a social row, the crisis marked mobilised. */
export function approveMobilise(a: Record<string, any>, _inboxId: number): { outcome: string; changed: boolean } {
  ensureTable();
  const personIds: string[] = a.personIds ?? [];
  const value = a.value ?? {};
  const rec = activate(null, `Incident response: ${a.place}`, personIds,
    { costAvoided: Number(value.costAvoided) || 0, productivity: Number(value.productivity) || 0, revenuePotential: 0, recruitmentAvoided: 0, assumptions: [], estimated: false },
    "Business continuity", "agent");
  const so = a.social ?? {};
  recordSocial({ ref: a.crisisId, kind: "crisis", impactId: rec.id, co2eKg: Number(so.co2eKg) || 0, travelKm: Number(so.travelKm) || 0, jobsRetained: 0,
    volunteerHours: 0, downtimeHours: Number(so.downtimeHours) || 0, peopleIds: personIds, basis: String(so.basis ?? "") });
  run("UPDATE crisis_events SET status = 'mobilised' WHERE id = ?", a.crisisId);
  const total = rec.cost_avoided_amt + rec.productivity_amt;
  return { outcome: `Team of ${personIds.length} mobilised to ${a.place}. Impact record ${rec.id}: ${money(total)} recorded; ${Number(so.downtimeHours) || 0} h of downtime avoided.`, changed: false };
}

/** Demo reset: remove simulated crisis rows. Returns rows removed. */
export function resetCrisis(): number {
  ensureTable();
  const n = all<{ id: string }>("SELECT id FROM crisis_events").length;
  run("DELETE FROM crisis_events");
  return n;
}
