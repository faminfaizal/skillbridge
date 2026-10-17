// Hidden-skill inference for one person: the LLM proposes and explains, the evidence check decides.
// Used by the precompute batch and by the Connectivity Agent (only for people whose records changed).
import { run } from "../db.ts";
import { chatJson } from "../llm.ts";
import type { Model } from "./data.ts";
import { INFER_SYSTEM, confidenceFor, inferUserPrompt, ruleCandidates } from "./infer.ts";
import type { Provider } from "../types.ts";

export interface InferResult {
  skills: { skillId: string; confidence: number; evidence: string[] }[];
  provider: Provider | "rules";
}

export async function inferPerson(m: Model, personId: string, useLlm = true): Promise<InferResult> {
  const cands = ruleCandidates(m, personId);
  run("DELETE FROM inferred_skills WHERE person_id = ?", personId);
  if (!cands.length) return { skills: [], provider: "rules" };
  const rationale = new Map<string, string>();
  let model = "rules";
  let provider: InferResult["provider"] = "rules";
  if (useLlm) {
    try {
      const r = await chatJson<{ inferred_skills: { skill: string; evidence_ids?: string[]; rationale?: string }[] }>(
        "fast", INFER_SYSTEM, inferUserPrompt(m, personId), { kind: "infer", maxTokens: 600 });
      model = `${r.provider}:${r.model}`;
      provider = r.provider;
      for (const s of r.data.inferred_skills ?? []) {
        const sk = m.skillByName.get(String(s.skill).toLowerCase());
        if (sk && s.rationale) rationale.set(sk.id, s.rationale);
      }
    } catch {
      /* rules only for this person */
    }
  }
  const out: InferResult["skills"] = [];
  for (const c of cands) {
    const sk = m.skills.get(c.skillId)!;
    const conf = confidenceFor(c.evidence.length, m.finance);
    const why = rationale.get(c.skillId) ??
      `${sk.name} appears in ${c.evidence.length} work record${c.evidence.length > 1 ? "s" : ""}: ${c.evidence[0].text.slice(0, 90)}`;
    run("INSERT OR REPLACE INTO inferred_skills (person_id, skill_id, confidence, evidence_ids, rationale, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      personId, c.skillId, conf, c.evidence.map((e) => e.id).join(","), why, rationale.has(c.skillId) ? model : "rules", new Date().toISOString());
    out.push({ skillId: c.skillId, confidence: conf, evidence: c.evidence.map((e) => e.id) });
  }
  return { skills: out, provider };
}
