// Evidence-based skill inference. The LLM proposes skills from a person's work records; a deterministic
// evidence check keeps only skills that real records support, and sets confidence from the evidence count.
import type { EvidenceRow, Model } from "./data.ts";

const ALIASES: Record<string, RegExp> = {
  Python: /\bpython\b|\bpytest\b/i,
  "Test Automation": /\bpytest\b|automat\w*[^.;]{0,40}\btest|\btest\w*[^.;]{0,40}\bautomat|acceptance test script/i,
  "Network Telemetry": /telemetry/i,
  "Data Visualization": /power bi|dashboard/i,
  "Machine Learning": /machine learning|gradient boosting|propensity model|prediction model/i,
  "Fibre Testing (OTDR)": /\botdr\b/i,
  "Video Analytics": /video analytics/i,
};

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function aliasFor(skillName: string): RegExp {
  return ALIASES[skillName] ?? new RegExp(`\\b${escape(skillName.toLowerCase())}\\b`, "i");
}

export function supportingEvidence(rows: EvidenceRow[], skillName: string): EvidenceRow[] {
  const re = aliasFor(skillName);
  return rows.filter((r) => re.test(r.text));
}

export function confidenceFor(n: number, finance: Record<string, any>): number {
  const c = finance.inference_confidence ?? { base: 0.55, per_evidence: 0.11, max_evidence: 3 };
  return Math.round((c.base + c.per_evidence * Math.min(c.max_evidence, n)) * 100) / 100;
}

/** Skills not declared by the person that at least one work record supports. */
export function ruleCandidates(m: Model, personId: string): { skillId: string; evidence: EvidenceRow[] }[] {
  const rows = m.evidence.get(personId) ?? [];
  const declared = m.declared.get(personId) ?? new Map();
  const out: { skillId: string; evidence: EvidenceRow[] }[] = [];
  for (const s of m.skills.values()) {
    if (declared.has(s.id)) continue;
    const ev = supportingEvidence(rows, s.name);
    if (ev.length) out.push({ skillId: s.id, evidence: ev });
  }
  return out;
}

export const INFER_SYSTEM =
  "You are the SkillBridge capability engine. From the work records given, list skills the person has demonstrated " +
  "that are NOT in their declared list. Use only the records; never invent evidence. Return ONLY JSON: " +
  '{"inferred_skills":[{"skill":string,"evidence_ids":[string],"rationale":string}]}. Rationale: one short sentence.';

export function inferUserPrompt(m: Model, personId: string): string {
  const p = m.people.get(personId)!;
  const declared = [...(m.declared.get(personId)?.keys() ?? [])].map((id) => m.skills.get(id)!.name);
  const rows = (m.evidence.get(personId) ?? []).slice(0, 25);
  return [
    `Person: ${p.name}, ${p.title}.`,
    `Declared skills: ${declared.join(", ") || "none"}.`,
    "Work records:",
    ...rows.map((r) => `- [${r.id}] (${r.kind}, ${r.date}) ${r.text}`),
  ].join("\n");
}
