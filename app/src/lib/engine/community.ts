// Community skills exchange (skills-based volunteering): community and small-business requests matched to consenting
// volunteers by skill and distance. The People Growth agent offers a volunteer; the community programme lead approves.
// Volunteer hours are a social outcome, never money.
import { all, get, run } from "../db.ts";
import { mirror, publishEvent } from "../cloud/index.ts";
import { ensureAgentTables, finishRun, propose, startRun } from "../agents/store.ts";
import { data, type Model } from "./data.ts";
import { OFFICES, isRemote, placeById, type Place } from "./geo.ts";
import { parseCommunity, type IntakeFile } from "./intake.ts";
import { rankNearby } from "./proximity.ts";
import { recordSocial } from "./socialStore.ts";
import type { Provider } from "../types.ts";

export interface CommunityInput { org?: string; text?: string; file?: IntakeFile }

export interface Volunteer {
  personId: string; name: string; title: string; location: string; km: number; mode: "local" | "road" | "flight"; etaHours: number;
  fit: number; capability: number; availabilityPct: number;
}
export interface CommunityRequest {
  id: string; org: string; sector: string; place: string; placeId: string; remote: boolean; need: string;
  skills: { id: string; name: string }[]; hours: number; date: string; source: "seed" | "posted"; provider: Provider | null;
  status: "open" | "offered" | "approved" | "dismissed"; inboxId: number | null; matches: Volunteer[]; privateCount: number;
}

export const VOLUNTEER_WEIGHTS = { fit: 0.7, prox: 0.2, avail: 0.1 };
export const MIN_CAPABILITY = 0.6;

/** How a volunteer reaches the request: on site by road or locally, else remote help (no one flies to volunteer). */
export const reach = (v: Pick<Volunteer, "km" | "mode" | "location">) => (v.mode === "flight" ? `remote help from ${v.location}` : `${v.km} km by ${v.mode}`);
const MIN_FIT = 0.3, DEFAULT_HOURS = 8, APPROVER = "Community programme lead";

let ready = false;
function ensureTables(): void {
  if (ready) return;
  run(`CREATE TABLE IF NOT EXISTS community_requests (id TEXT PRIMARY KEY, org TEXT NOT NULL, location_id TEXT, place_id TEXT NOT NULL,
    description TEXT NOT NULL, skills TEXT NOT NULL, hours REAL NOT NULL, status TEXT NOT NULL, source TEXT NOT NULL, provider TEXT, created_at TEXT NOT NULL)`);
  run(`CREATE TABLE IF NOT EXISTS volunteer_logs (id TEXT PRIMARY KEY, request_id TEXT NOT NULL, person_id TEXT NOT NULL, org TEXT NOT NULL,
    hours REAL NOT NULL, inbox_id INTEGER, date TEXT NOT NULL)`);
  ready = true;
}

const nextId = () => `SIM-CR-${(get<{ n: number | null }>("SELECT MAX(CAST(substr(id, 8) AS INTEGER)) n FROM community_requests")?.n ?? 0) + 1}`;

/** Nearest office for a field town, so a posted request also has an office region. */
function nearestOffice(p: Place): string {
  if (p.locId) return p.locId;
  let best = { id: "LOC-SIN", d: Infinity };
  for (const o of Object.values(OFFICES)) {
    const d = (o.lat - p.lat) ** 2 + (o.lon - p.lon) ** 2;
    if (d < best.d) best = { id: o.id, d };
  }
  return best.id;
}

function matchFor(m: Model, skillIds: string[], place: Place, need: string): { matches: Volunteer[]; privateCount: number } {
  if (!skillIds.length) return { matches: [], privateCount: 0 };
  const r = rankNearby({ role: need, must: skillIds.slice(0, 1), nice: skillIds.slice(1) }, place, { w: VOLUNTEER_WEIGHTS, minFit: MIN_FIT, minCap: MIN_CAPABILITY }, m);
  return {
    matches: r.candidates.slice(0, 2).map((c) => ({ personId: c.personId, name: c.name, title: c.title, location: c.location, km: c.trip.km, mode: c.trip.mode,
      etaHours: c.trip.etaHours, fit: c.fit, capability: Math.min(...c.capabilities.map((x) => x.value)), availabilityPct: c.availabilityPct })),
    privateCount: r.privateQualified,
  };
}

function inboxFor(id: string): { id: number; status: string } | null {
  return get<{ id: number; status: string }>("SELECT id, status FROM agent_inbox WHERE dedupe_key = ?", `community:${id}`) ?? null;
}

function statusOf(id: string): Pick<CommunityRequest, "status" | "inboxId"> {
  const ib = inboxFor(id);
  if (!ib) return { status: "open", inboxId: null };
  return { status: ib.status === "approved" ? "approved" : ib.status === "dismissed" ? "dismissed" : "offered", inboxId: ib.id };
}

interface Raw { id: string; org: string; sector: string; place: Place | null; need: string; skills: string[]; hours: number; date: string; source: "seed" | "posted"; provider: Provider | null }

function rawRequests(): Raw[] {
  ensureTables();
  const posted = all<{ id: string; org: string; place_id: string; description: string; skills: string; hours: number; provider: string | null; created_at: string }>(
    "SELECT * FROM community_requests ORDER BY created_at DESC, rowid DESC")
    .map((r) => ({ id: r.id, org: r.org, sector: "Community", place: placeById(r.place_id), need: r.description, skills: r.skills.split(",").filter(Boolean),
      hours: r.hours, date: r.created_at.slice(0, 10), source: "posted", provider: r.provider as Provider | null }) as Raw);
  const seed = all<{ id: string; org: string; sector: string; location_id: string; skill_id: string; description: string; date: string }>(
    `SELECT s.id, o.name org, o.sector, o.location_id, s.skill_id, s.description, s.date FROM sme_requests s JOIN organisations o ON o.id = s.org_id ORDER BY s.id`)
    .map((r) => ({ id: r.id, org: r.org, sector: r.sector, place: OFFICES[r.location_id], need: r.description, skills: [r.skill_id], hours: DEFAULT_HOURS,
      date: r.date, source: "seed", provider: null }) as Raw);
  return [...posted, ...seed].filter((r) => !!r.place);
}

function toRequest(m: Model, raw: Raw): CommunityRequest {
  const r = { ...raw, place: raw.place! };
  const { matches, privateCount } = matchFor(m, r.skills, r.place, r.need);
  return {
    id: r.id, org: r.org, sector: r.sector, place: r.place.name, placeId: r.place.id, remote: isRemote(nearestOffice(r.place)), need: r.need,
    skills: r.skills.map((id) => ({ id, name: m.skills.get(id)?.name ?? id })), hours: r.hours, date: r.date, source: r.source, provider: r.provider,
    ...statusOf(r.id), matches, privateCount,
  };
}

/** Every open and recent request with its two best volunteers (consenting, capability at least 0.6, nearest first). */
export function board(): CommunityRequest[] {
  ensureAgentTables();
  const m = data();
  return rawRequests().map((r) => toRequest(m, r));
}

export function requestById(id: string): CommunityRequest | null {
  ensureAgentTables();
  const r = rawRequests().find((x) => x.id === id);
  return r ? toRequest(data(), r) : null;
}

/** The People Growth agent offers the best volunteer to the requester; the community programme lead decides. */
export function offer(requestId: string): { proposed: boolean; inboxId?: number; message: string } {
  const r = requestById(requestId);
  if (!r) return { proposed: false, message: "Request not found." };
  if (r.status !== "open") return { proposed: false, inboxId: r.inboxId ?? undefined, message: r.status === "approved" ? "Already approved." : r.status === "dismissed" ? "This offer was dismissed." : "Already offered; waiting for approval." };
  const v = r.matches[0];
  if (!v) return { proposed: false, message: "No consenting volunteer with this skill is available." };
  const skillNames = r.skills.map((s) => s.name).join(", ");
  const nodeIds = [v.personId, ...r.skills.map((s) => s.id)];
  const runId = startRun("people", "Community request");
  finishRun(runId, "done", [
    { tool: "Volunteer match", detail: `${v.name} (${v.location}, ${reach(v)}): ${skillNames} ${Math.round(v.capability * 100)}%, fit ${Math.round(v.fit * 100)}%.`, ms: 0 },
    { tool: "Consent check", detail: `${r.privateCount} qualified people keep their profile private: counted, not named.`, ms: 0 },
  ], `Offer ${v.name} to ${r.org} for ${r.hours} h.`, "rules", nodeIds);
  propose({
    agent: "people", runId, kind: "volunteer", title: `Offer ${v.name} to ${r.org}`,
    detail: `${r.org} (${r.place}) asks for ${skillNames}: ${r.need}. ${v.name}, ${v.title} in ${v.location}, ${v.mode === "flight" ? "can help remotely" : `is ${v.km} km away`} and ${v.availabilityPct}% available. ${r.hours} h of volunteer time.`,
    evidence: [
      ...r.matches.map((x) => `${x.name}, ${x.title} (${x.location}): ${reach(x)}, ${skillNames} ${Math.round(x.capability * 100)}%`),
      `${r.privateCount} qualified people kept private.`,
    ],
    valueAmt: 0, nodeIds, approver: APPROVER,
    action: { type: "volunteer", requestId: r.id, personIds: [v.personId], hours: r.hours, org: r.org, place: r.place, km: v.km, remote: v.mode === "flight" },
    dedupeKey: `community:${r.id}`, provider: "rules",
  });
  const ib = inboxFor(r.id);
  return { proposed: true, inboxId: ib?.id, message: `${v.name} offered to ${r.org}; waiting for the ${APPROVER.toLowerCase()}.` };
}

/** Read a new request (Gemini, else keywords), store it and offer the best volunteer straight away. */
export async function postRequest(input: CommunityInput): Promise<CommunityRequest> {
  ensureTables();
  const m = data();
  const n = await parseCommunity({ org: input.org, text: input.text, file: input.file }, m);
  if (!n.place) throw new Error("Add the town or nearest office, for example Cairns, Darwin or Katherine.");
  if (!n.skills.length) throw new Error("No skill could be read from the request. Name the help needed, for example LoRaWAN sensors or a sales dashboard.");
  const id = nextId();
  run(`INSERT INTO community_requests (id, org, location_id, place_id, description, skills, hours, status, source, provider, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', 'posted', ?, ?)`,
    id, n.org, nearestOffice(n.place), n.place.id, n.need, n.skills.join(","), n.hours, n.provider, new Date().toISOString());
  offer(id);
  const req = requestById(id)!;
  // the cloud copy names the organisation, never a volunteer
  mirror("community", id, { id, org: req.org, place: req.place, need: req.need, skills: req.skills.map((s) => s.name), hours: req.hours, status: req.status,
    matched: req.matches.length, privateCount: req.privateCount, provider: n.provider, createdAt: new Date().toISOString() });
  void publishEvent("community", { id, org: req.org, place: req.place, skills: req.skills.map((s) => s.name), hours: req.hours, status: req.status }).catch(() => false);
  return req;
}

/** Approval of a "volunteer" proposal (agents/actions.ts): hours logged and a social row; no money record. */
export function approveVolunteer(a: Record<string, any>, inboxId: number): { outcome: string; changed: boolean } {
  ensureTables();
  const personIds: string[] = a.personIds ?? [];
  const hours = Number(a.hours) || DEFAULT_HOURS;
  const date = new Date().toISOString().slice(0, 10);
  for (const pid of personIds) {
    run("INSERT OR REPLACE INTO volunteer_logs (id, request_id, person_id, org, hours, inbox_id, date) VALUES (?, ?, ?, ?, ?, ?, ?)",
      `SIM-VOL-${inboxId}-${pid}`, a.requestId, pid, String(a.org ?? ""), hours, inboxId, date);
  }
  const total = hours * personIds.length;
  recordSocial({ ref: String(a.requestId), kind: "volunteer", impactId: null, co2eKg: 0, travelKm: 0, jobsRetained: 0, volunteerHours: total, downtimeHours: 0,
    peopleIds: personIds, basis: `${total} h of skilled volunteering for ${a.org} (${a.place}), matched by skill and distance (${a.remote ? "remote help" : `${a.km} km`}), with consent.` });
  return { outcome: `${total} h of volunteering logged for ${a.org}.`, changed: false };
}

/** Demo reset: remove posted requests and volunteer logs. Returns rows removed. */
export function resetCommunity(): number {
  ensureTables();
  const n = (get<{ n: number }>("SELECT COUNT(*) n FROM community_requests")?.n ?? 0) + (get<{ n: number }>("SELECT COUNT(*) n FROM volunteer_logs")?.n ?? 0);
  run("DELETE FROM community_requests");
  run("DELETE FROM volunteer_logs");
  return n;
}
