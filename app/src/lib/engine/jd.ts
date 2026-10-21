// Read a job description (position profile) for "Job vacancy to fill". Gemini only reads: it returns the title, grade,
// responsibilities, competencies and skill names, and every skill is mapped onto the engine's own list. When Gemini is
// unavailable, the taxonomy keyword rules read the text instead, so a vacancy never comes back blank.
import path from "node:path";
import { chatJson } from "../llm.ts";
import { DOC_TYPES, isVisual, MAX_BYTES, readText, ruleSuggestions } from "../me/documents.ts";
import { GRADES } from "../grades.ts";
import { data, type Model } from "./data.ts";
import { BadInput } from "./intake.ts";
import { mapSkill } from "./requirements.ts";
import type { Provider, VacancyInput } from "../types.ts";

export interface ReadVacancy { parsed: VacancyInput; unmapped: string[]; provider: Provider; read: "document" | "scan" }

export const JD_SYSTEM =
  "You read a job description or position profile for an internal vacancy at a telecoms operator. It may be a scan. " +
  "Extract only what the document states. Grade: one code from {GRADES}, or null when the document does not say. " +
  "Skills: names from this list only: {SKILLS}. 'must' are skills the document requires, 'nice' are skills it calls " +
  "desirable or an advantage. Put any other required skill the list does not have in 'other'. Responsibilities: up to " +
  "6 short sentences in the document's own words. Competencies: up to 4 behaviours or qualities it asks for. " +
  'Return JSON: {"title":"...","grade":"AM"|null,"responsibilities":["..."],"competencies":["..."],"must":["..."],"nice":["..."],"other":["..."]}.';

type AiJd = { title?: string; grade?: string | null; responsibilities?: string[]; competencies?: string[]; must?: string[]; nice?: string[]; other?: string[] };

const strs = (x: unknown, n: number, len = 200) => (Array.isArray(x) ? x : []).map((s) => String(s ?? "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, n).map((s) => s.slice(0, len));

function mapNames(m: Model, names: string[]): { ids: string[]; unmapped: string[] } {
  const ids: string[] = [];
  const unmapped: string[] = [];
  for (const n of names) {
    const id = n.length >= 3 ? mapSkill(m, n) : null;
    if (id) { if (!ids.includes(id)) ids.push(id); } else unmapped.push(n);
  }
  return { ids, unmapped };
}

/** Rules: title from the first line, bullets as responsibilities, taxonomy aliases as required skills. */
export function rulesVacancy(text: string): VacancyInput {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const title = (lines[0] ?? "").replace(/^(position|job title|role|post)\s*[:-]\s*/i, "").slice(0, 120);
  const responsibilities = lines.filter((l) => /^[-*•]\s+|^\d+[.)]\s+/.test(l)).map((l) => l.replace(/^[-*•]\s+|^\d+[.)]\s+/, "")).slice(0, 6);
  return { title, level: null, responsibilities, competencies: [], must: ruleSuggestions(text).map((s) => s.skillId).slice(0, 10), nice: [] };
}

export async function readVacancy(file: { filename: string; data: Buffer }, m: Model = data()): Promise<ReadVacancy> {
  const ext = path.extname(file.filename).toLowerCase();
  if (!DOC_TYPES[ext]) throw new BadInput("Upload a PDF, DOCX, TXT or an image (PNG, JPG, WebP).");
  if (file.data.length > MAX_BYTES) throw new BadInput("That file is over 5 MB. Upload a smaller copy.");
  if (file.data.length === 0) throw new BadInput("That file is empty.");
  let text: string;
  try {
    text = (await readText(ext, file.data)).slice(0, 12000);
  } catch (e) {
    throw new BadInput((e as Error).message || "This file could not be read.");
  }
  const visual = isVisual(ext);
  const read: ReadVacancy["read"] = visual && !text.trim() ? "scan" : "document";
  try {
    const sys = JD_SYSTEM.replace("{GRADES}", GRADES.map((g) => `${g.code} (${g.label})`).join(", "))
      .replace("{SKILLS}", [...m.skills.values()].map((s) => s.name).join(", "));
    const user = text.trim() ? `Job description:\n${text.slice(0, 8000)}` : "The job description is in the attached file.";
    const r = await chatJson<AiJd>("fast", sys, user, { kind: "vacancy-jd", maxTokens: 900,
      files: visual ? [{ mimeType: DOC_TYPES[ext], data: file.data }] : undefined });
    const d = r.data ?? {};
    const must = mapNames(m, strs(d.must, 12, 80));
    const nice = mapNames(m, strs(d.nice, 12, 80));
    if (must.ids.length + nice.ids.length > 0) {
      const grade = GRADES.some((g) => g.code === d.grade) ? String(d.grade) : null;
      return {
        parsed: { title: String(d.title ?? "").trim().slice(0, 120), level: grade, responsibilities: strs(d.responsibilities, 6),
          competencies: strs(d.competencies, 4, 120), must: must.ids, nice: nice.ids.filter((s) => !must.ids.includes(s)) },
        unmapped: [...must.unmapped, ...nice.unmapped, ...strs(d.other, 8, 80)], provider: r.provider, read,
      };
    }
  } catch {
    /* Gemini unavailable: keyword rules below */
  }
  if (!text.trim()) throw new BadInput("Could not read text from this file. Type the post details instead, or upload a PDF, DOCX or TXT.");
  return { parsed: rulesVacancy(text), unmapped: [], provider: "rules", read };
}
