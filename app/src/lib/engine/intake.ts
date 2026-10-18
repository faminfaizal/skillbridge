// Intake for the Act features: a situation report or a community request (text and/or a photo) becomes structured
// needs. Gemini reads it; a keyword table takes over when Gemini is unavailable, so intake never comes back blank.
// Gemini only extracts: places and skills are mapped onto the engine's own lists, and no figure it reads is used in money.
import { chatJson } from "../llm.ts";
import { data, type Model } from "./data.ts";
import { findPlace, PLACES, type Place } from "./geo.ts";
import { mapSkill } from "./requirements.ts";
import type { Provider } from "../types.ts";

export interface IntakeFile { mimeType: string; data: Buffer }
export type Severity = "P1" | "P2" | "P3";
export interface SitrepRole { role: string; must: string[]; count: number }
/** What was read and how: "photo", "text" or both, by Gemini ("vertex"/"cache") or by keyword rules. */
export interface Sitrep {
  summary: string; place: Place | null; severity: Severity; customersReported: number | null; roles: SitrepRole[];
  provider: Provider; read: "photo" | "text" | "photo and text";
}
export interface CommunityNeed { org: string; place: Place | null; need: string; skills: string[]; hours: number; provider: Provider }

/** Input the user can fix (shown as is, HTTP 400). */
export class BadInput extends Error {}

const PHOTO_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

/** A photo from a form field, checked for type and size. */
export async function photoFrom(f: unknown): Promise<IntakeFile | undefined> {
  if (!(f instanceof File) || f.size === 0) return undefined;
  if (!PHOTO_TYPES.has(f.type)) throw new BadInput("Use a PNG, JPEG or WebP photo.");
  if (f.size > MAX_PHOTO_BYTES) throw new BadInput("The photo is larger than 4 MB.");
  return { mimeType: f.type, data: Buffer.from(await f.arrayBuffer()) };
}

const PLACE_NAMES = () => PLACES.map((p) => p.name).join(", ");
const SKILL_NAMES = (m: Model) => [...m.skills.values()].map((s) => s.name).join(", ");

export const SITREP_SYSTEM =
  "You read a field situation report for a telecoms operator: typed text, a photo or scan of the report, or both. " +
  "Extract what an incident response team needs. Places (return one name exactly as written here, or null): {PLACES}. " +
  "Skills (names from this list only): {SKILLS}. One role per crew or task the report asks for, with 1 to 3 people each. " +
  'Return ONLY JSON: {"summary":string (at most 35 words, plain facts),"place":string|null,"severity":"P1"|"P2"|"P3",' +
  '"customers_reported":number|null,"roles":[{"role":string,"must_have_skills":[string],"count":number}]} with 1 to 4 roles.';

export const COMMUNITY_SYSTEM =
  "You read a request for skilled volunteer help from a community group or small business (text, a photo of a notice or " +
  "letter, or both). Places (return one name exactly as written here, or null): {PLACES}. Skills (names from this list only): {SKILLS}. " +
  'Return ONLY JSON: {"org":string|null,"place":string|null,"need":string (at most 20 words),"skills":[string] (1 to 2),"hours":number|null}.';

// offline reading: phrase -> role and skill names (checked against the skills table)
const SITREP_RULES: { re: RegExp; role: string; skills: string[]; count: number }[] = [
  { re: /splic|fib(re|er) (cut|break|span|down)|cable (cut|down)|span (down|damage)/i, role: "Fibre splicing crew", skills: ["Fibre Splicing"], count: 2 },
  { re: /otdr|fault locali[sz]|fib(re|er) test/i, role: "OTDR testing", skills: ["Fibre Testing (OTDR)"], count: 1 },
  { re: /coordinat|dispatch|field crew|logistic/i, role: "Field coordination", skills: ["Field Service Coordination"], count: 1 },
  { re: /lora|gateway|sensor/i, role: "LoRaWAN restore", skills: ["LoRaWAN"], count: 1 },
  { re: /outage|fault|alarm|mobile site|cell site|offline/i, role: "Network troubleshooting", skills: ["Network Troubleshooting"], count: 1 },
];

const COMMUNITY_RULES: { re: RegExp; skill: string }[] = [
  { re: /lora|soil|sensor|gateway/i, skill: "LoRaWAN" },
  { re: /dashboard|chart|visuali[sz]/i, skill: "Data Visualization" },
  { re: /sales data|shop|retail|stock/i, skill: "Retail Analytics" },
  { re: /marketing|campaign|social media|online store/i, skill: "Digital Marketing" },
  { re: /privacy|patient data|personal data|pdpa/i, skill: "Data Privacy (PDPA)" },
  { re: /wi-?fi|wireless/i, skill: "Wi-Fi Engineering" },
  { re: /website|web site|app\b/i, skill: "React" },
  { re: /cyber|security|phishing/i, skill: "Network Security" },
  { re: /spreadsheet|database|sql/i, skill: "SQL" },
];

/** A Gemini place name onto the engine's places: exact name first, then a search of the name and the summary. */
function resolvePlace(name: string | null | undefined, ...texts: (string | undefined)[]): Place | null {
  if (name) {
    const n = name.toLowerCase().trim();
    const exact = PLACES.find((p) => p.name.toLowerCase() === n);
    if (exact) return exact;
    const found = findPlace(name);
    if (found) return found;
  }
  for (const t of texts) if (t) { const p = findPlace(t); if (p) return p; }
  return null;
}

export function severityOf(text: string): Severity {
  const p = /\b(?:P|priority|sev(?:erity)?)\s*[:-]?\s*([123])\b/i.exec(text);
  if (p) return `P${p[1]}` as Severity;
  if (/critical|emergency|major outage|life safety|clinic|hospital/i.test(text)) return "P1";
  if (/minor|low impact|single customer/i.test(text)) return "P3";
  return "P2";
}

export function customersOf(text: string): number | null {
  const r = /(\d[\d,]*)\s+(?:[a-z-]+\s+){0,2}?(customers|subscribers|premises|services|households|users)/i.exec(text);
  if (!r) return null;
  const n = Number(r[1].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function sitrepRules(m: Model, text: string): SitrepRole[] {
  return SITREP_RULES.filter((r) => r.re.test(text))
    .map((r) => ({ role: r.role, must: r.skills.map((s) => mapSkill(m, s)).filter((s): s is string => !!s), count: r.count }))
    .filter((r) => r.must.length)
    .slice(0, 4);
}

function firstSentences(text: string, words = 35): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const w = flat.split(" ");
  return w.length <= words ? flat : `${w.slice(0, words).join(" ")}...`;
}

/** Rules summary: the sentences that describe what happened and its impact, else the opening words. */
function eventSummary(text: string): string {
  const sentences = text.replace(/\s+/g, " ").split(/(?<=[.;])\s+/);
  const hits = sentences.filter((x) => /storm|down|cut|outage|offline|fault|damage|flood|fire|customers/i.test(x)).slice(0, 3);
  const out = firstSentences((hits.length ? hits.join(" ") : text).replace(/^(event|impact|location):\s*/i, ""), 40);
  return out.charAt(0).toUpperCase() + out.slice(1);
}

const readOf = (text: string, file?: IntakeFile): Sitrep["read"] => (file && text ? "photo and text" : file ? "photo" : "text");

/**
 * Read a situation report. `fallbackText` is what the rules read when Gemini is unavailable and only a photo was
 * sent (the bundled sample ships with its text), so the demo still works offline.
 */
export async function parseSitrep(input: { text?: string; file?: IntakeFile; fallbackText?: string }, m: Model = data()): Promise<Sitrep> {
  const text = (input.text ?? "").trim().slice(0, 6000);
  if (!text && !input.file) throw new BadInput("Paste the situation report or add a photo of it.");
  const read = readOf(text, input.file);
  try {
    const user = text ? `Situation report:\n${text}` : "The situation report is in the attached photo.";
    const r = await chatJson<{ summary?: string; place?: string | null; severity?: string; customers_reported?: number | null;
      roles?: { role?: string; must_have_skills?: string[]; count?: number }[] }>(
      "chat", SITREP_SYSTEM.replace("{PLACES}", PLACE_NAMES()).replace("{SKILLS}", SKILL_NAMES(m)), user,
      { kind: "sitrep", maxTokens: 900, files: input.file ? [input.file] : undefined });
    const d = r.data ?? {};
    const roles = (d.roles ?? [])
      .map((x) => ({
        role: String(x.role ?? "Responder").slice(0, 60),
        must: [...new Set((x.must_have_skills ?? []).map((s) => mapSkill(m, String(s))).filter((s): s is string => !!s))].slice(0, 3),
        count: Math.max(1, Math.min(3, Math.round(Number(x.count) || 1))),
      }))
      .filter((x) => x.must.length)
      .slice(0, 4);
    const summary = String(d.summary ?? "").trim();
    const place = resolvePlace(d.place, summary, text);
    if (roles.length && place) {
      const sev = /^P[123]$/.test(String(d.severity)) ? (d.severity as Severity) : severityOf(`${summary} ${text}`);
      const cust = Number(d.customers_reported);
      return { summary: summary || firstSentences(text), place, severity: sev, customersReported: Number.isFinite(cust) && cust > 0 ? Math.round(cust) : customersOf(text),
        roles, provider: r.provider, read };
    }
  } catch {
    /* Gemini unavailable: keyword rules below */
  }
  const basis = text || input.fallbackText || "";
  return { summary: basis ? eventSummary(basis) : "Photo received; Gemini is offline, so it could not be read.", place: findPlace(basis),
    severity: severityOf(basis), customersReported: customersOf(basis), roles: sitrepRules(m, basis), provider: "rules", read };
}

const clampHours = (h: unknown) => Math.max(2, Math.min(40, Math.round(Number(h) || 8)));

function communityRules(m: Model, text: string): string[] {
  const named = [...m.skills.values()].filter((s) => s.name.length > 3 && text.toLowerCase().includes(s.name.toLowerCase())).map((s) => s.id);
  const keyed = COMMUNITY_RULES.filter((r) => r.re.test(text)).map((r) => mapSkill(m, r.skill)).filter((s): s is string => !!s);
  return [...new Set([...named, ...keyed])].slice(0, 2);
}

export function hoursOf(text: string): number | null {
  const h = /(\d{1,3})\s*(?:h\b|hrs?\b|hours?\b)/i.exec(text);
  if (h) return Number(h[1]);
  const d = /(\d{1,2})\s*(?:days?)\b/i.exec(text);
  return d ? Number(d[1]) * 8 : null;
}

/** Read a community request: who asks, where, what skill and how many hours (clamped 2 to 40). */
export async function parseCommunity(input: { org?: string; text?: string; file?: IntakeFile }, m: Model = data()): Promise<CommunityNeed> {
  const text = (input.text ?? "").trim().slice(0, 4000);
  const orgIn = (input.org ?? "").trim().slice(0, 80);
  if (!text && !input.file) throw new BadInput("Describe the request or add a photo of it.");
  try {
    const user = `${orgIn ? `Organisation: ${orgIn}\n` : ""}${text ? `Request:\n${text}` : "The request is in the attached photo."}`;
    const r = await chatJson<{ org?: string | null; place?: string | null; need?: string; skills?: string[]; hours?: number | null }>(
      "fast", COMMUNITY_SYSTEM.replace("{PLACES}", PLACE_NAMES()).replace("{SKILLS}", SKILL_NAMES(m)), user,
      { kind: "community", maxTokens: 400, files: input.file ? [input.file] : undefined });
    const d = r.data ?? {};
    const skills = [...new Set((d.skills ?? []).map((s) => mapSkill(m, String(s))).filter((s): s is string => !!s))].slice(0, 2);
    const place = resolvePlace(d.place, text, orgIn);
    if (skills.length && place) {
      return { org: orgIn || String(d.org ?? "").trim().slice(0, 80) || "Community partner", place, need: String(d.need ?? "").trim().slice(0, 160) || firstSentences(text, 20),
        skills, hours: clampHours(d.hours ?? hoursOf(text)), provider: r.provider };
    }
  } catch {
    /* Gemini unavailable: keyword rules below */
  }
  return { org: orgIn || "Community partner", place: findPlace(`${text} ${orgIn}`), need: text ? firstSentences(text, 20) : "Request received as a photo.",
    skills: communityRules(m, text), hours: clampHours(hoursOf(text)), provider: "rules" };
}
