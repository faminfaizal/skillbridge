// Social and environmental value ledger: CO2e avoided, jobs kept, volunteer hours, remote-region opportunity and
// downtime avoided. Each line splits the seeded history from approvals made in the app and states its basis.
// Gemini only words the statement over these facts (grounding-checked, template fallback).
import { all } from "../db.ts";
import { chatJson } from "../llm.ts";
import { data, type Model } from "./data.ts";
import { isRemote } from "./geo.ts";
import { socialAssumptions, socialAssumptionText } from "./assumptions.ts";
import { openOpportunities, staffed } from "./portfolio.ts";
import { socialRows } from "./socialStore.ts";
import { ungrounded } from "../agents/concierge.ts";
import type { ImpactRecord } from "../types.ts";

export interface SocialLine {
  key: "co2e" | "jobs" | "volunteer" | "remote" | "downtime";
  label: string;
  value: number;
  unit: string;
  seed: number;          // from the seeded history
  live: number;          // from approvals made in the app
  basis: string;         // how it is counted
  note?: string;         // context that is not part of the value (requested hours, people offered work)
}

export interface SocialLedger { lines: SocialLine[]; assumptions: string[] }

const MOBILITY = /internal mobility|reskill|redeploy/i;
const REGIONAL = /regional talent/i;
const round1 = (x: number) => Math.round(x * 10) / 10;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const n = (x: number) => x.toLocaleString("en-US");

/** People in remote offices on the current staffing proposals for open work (team members and reskilling picks). */
export function remoteOffered(m: Model): string[] {
  const ids = new Set<string>();
  for (const o of openOpportunities()) {
    const t = staffed(o.id);
    for (const id of [...t.team.map((c) => c.personId), ...t.gaps.flatMap((g) => g.reskill.map((r) => r.personId))]) {
      const p = m.people.get(id);
      if (p && isRemote(p.location_id)) ids.add(id);
    }
  }
  return [...ids].sort();
}

export function socialLedger(m: Model = data()): SocialLedger {
  const s = socialAssumptions(m);
  const dayRate = Number(m.finance.consultant_day_rate_amt?.default ?? 4000);
  const records = all<ImpactRecord>("SELECT * FROM impact_records ORDER BY id");
  const ids = new Set(records.map((r) => r.id));
  const seed = records.filter((r) => r.source === "seed");
  const live = records.filter((r) => r.source !== "seed");
  // rows tied to an impact record count only while that record exists (a demo reset removes both)
  const rows = socialRows().filter((r) => !r.impactId || ids.has(r.impactId));
  const of = (k: string) => rows.filter((r) => r.kind === k);

  // CO2e: each seeded record with cost avoided stands for consultant days not bought, so trips not flown
  const trips = sum(seed.filter((r) => r.cost_avoided_amt > 0).map((r) => Math.ceil(r.cost_avoided_amt / dayRate / s.daysPerTrip)));
  const co2Seed = round1((trips * s.tripKm * s.co2eKgPerKm) / 1000);
  const co2Live = round1(sum(of("crisis").map((r) => r.co2eKg)) / 1000);

  const jobsSeed = sum(seed.filter((r) => MOBILITY.test(r.strategic_value) || MOBILITY.test(r.title)).map((r) => r.people_count));
  const jobsLive = sum(of("redeploy").map((r) => r.jobsRetained));

  const volLive = round1(sum(of("volunteer").map((r) => r.volunteerHours)));
  const requests = all<{ n: number }>("SELECT COUNT(*) n FROM sme_requests")[0]?.n ?? 0;

  const remoteSeed = sum(seed.filter((r) => REGIONAL.test(r.strategic_value)).map((r) => r.people_count));
  const takenUp = new Set<string>();
  for (const id of [...live.flatMap((r) => (r.person_ids ? r.person_ids.split(",") : [])), ...rows.flatMap((r) => r.peopleIds)]) {
    const p = m.people.get(id);
    if (p && isRemote(p.location_id)) takenUp.add(id);
  }
  const offered = remoteOffered(m).filter((id) => !takenUp.has(id)).length;

  const downLive = round1(sum(of("crisis").map((r) => r.downtimeHours)));

  const lines: SocialLine[] = [
    { key: "co2e", label: "CO2e avoided", value: round1(co2Seed + co2Live), unit: "t CO2e", seed: co2Seed, live: co2Live,
      basis: `Consultant travel not needed: ${trips} trips (cost avoided / $${n(dayRate)} a day / ${s.daysPerTrip} days a trip, ${n(s.tripKm)} km return at ${s.co2eKgPerKm} kg per km), plus travel avoided by mobilising nearby people in incidents.` },
    { key: "jobs", label: "Jobs kept in the company", value: jobsSeed + jobsLive, unit: "people", seed: jobsSeed, live: jobsLive,
      basis: "People on impact records for internal mobility, reskilling or redeployment, plus people kept through approved redeployment plans." },
    { key: "volunteer", label: "Volunteer hours", value: volLive, unit: "hours", seed: 0, live: volLive,
      basis: "Hours logged by approved skills-based volunteering for community and small-business requests.",
      note: requests ? `${requests} community requests open, about ${requests * s.volunteerHoursPerRequest} hours requested` : undefined },
    { key: "remote", label: "Remote-region people in the work", value: remoteSeed + takenUp.size, unit: "people", seed: remoteSeed, live: takenUp.size,
      basis: "People in remote-region offices (Darwin, Cairns) on regional-talent impact records, approved activations and approved responses.",
      note: offered ? `${offered} more offered on current staffing proposals` : undefined },
    { key: "downtime", label: "Downtime avoided", value: downLive, unit: "hours", seed: 0, live: downLive,
      basis: "Customer downtime hours avoided by approved incident responses (nearest qualified people instead of the default team)." },
  ];
  return { lines, assumptions: socialAssumptionText(s, dayRate) };
}

export const SOCIAL_SYSTEM =
  "You write a 2 or 3 sentence social and environmental impact statement for a company's leadership, plain words, no hype. " +
  "Use only the facts given and the exact figures with their units; never invent figures, names or causes, and skip lines whose value is 0. " +
  'Return ONLY JSON: {"statement": string}.';

const factsOf = (l: SocialLedger) => l.lines.map((x) => ({ line: x.label, value: `${n(x.value)} ${x.unit}`, from_history: n(x.seed), from_approvals_in_app: n(x.live), basis: x.basis, ...(x.note ? { note: x.note } : {}) }));

/** Figures in the text that the facts do not contain: ungrounded() plus any number of two or more digits. */
export function unsupported(text: string, evidence: string): string[] {
  const nums = new Set((evidence.replace(/(\d),(\d)/g, "$1$2").match(/\d+(\.\d+)?/g) ?? []));
  const extra = (text.replace(/(\d),(\d)/g, "$1$2").match(/\d+(\.\d+)?/g) ?? []).filter((x) => x.replace(".", "").length >= 2 && !nums.has(x));
  return [...new Set([...ungrounded(text, evidence), ...extra])];
}

export function templateStatement(l: SocialLedger): string {
  const by = Object.fromEntries(l.lines.map((x) => [x.key, x]));
  const and = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0]);
  const parts: string[] = [];
  if (by.jobs?.value) parts.push(`kept ${n(by.jobs.value)} ${by.jobs.value === 1 ? "person" : "people"} in work through internal moves and reskilling`);
  if (by.co2e?.value) parts.push(`avoided an estimated ${n(by.co2e.value)} t CO2e of consultant travel`);
  if (by.remote?.value) parts.push(`brought ${n(by.remote.value)} ${by.remote.value === 1 ? "person" : "people"} from remote regions into the work`);
  const extra: string[] = [];
  if (by.volunteer?.value) extra.push(`${n(by.volunteer.value)} volunteer hours`);
  if (by.downtime?.value) extra.push(`${n(by.downtime.value)} hours of customer downtime avoided`);
  if (!parts.length && !extra.length) return "No social or environmental value recorded yet.";
  const first = parts.length ? `Reusing capability inside has ${and(parts)}.` : "";
  const second = extra.length ? ` Approvals in the app added ${and(extra)}.` : "";
  return `${first}${second}`.trim();
}

export async function socialStatement(l: SocialLedger): Promise<{ text: string; provider: string; grounded: boolean }> {
  const facts = JSON.stringify(factsOf(l));
  const fallback = () => { const text = templateStatement(l); return { text, provider: "template", grounded: unsupported(text, facts).length === 0 }; };
  if (!l.lines.some((x) => x.value)) return fallback();
  try {
    const r = await chatJson<{ statement: string }>("fast", SOCIAL_SYSTEM, facts, { kind: "social_statement", maxTokens: 300 });
    const text = r.data.statement?.replace(/\s*[–—]\s*/g, ", ").trim();
    if (text && text.length > 30 && unsupported(text, facts).length === 0) return { text, provider: r.provider, grounded: true };
  } catch {
    /* template below */
  }
  return fallback();
}
