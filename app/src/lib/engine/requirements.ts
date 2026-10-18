// Turn a free-text request into role requirements: match an open opportunity first, else ask the LLM, else keywords.
import { all } from "../db.ts";
import { chatJson, cosine, embed } from "../llm.ts";
import { data, type Model } from "./data.ts";
import type { Provider, RoleRequirement } from "../types.ts";
import type { OpportunityRow } from "./value.ts";

export interface ParsedRequest {
  opportunity: (OpportunityRow & { demo_query: string | null }) | null;
  roles: RoleRequirement[];
  provider: Provider;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

export function opportunityRoles(opportunityId: string): RoleRequirement[] {
  const roles = all<{ id: string; role: string }>("SELECT id, role FROM opportunity_roles WHERE opportunity_id = ? ORDER BY id", opportunityId);
  const skills = all<{ role_id: string; skill_id: string; must: number }>(
    "SELECT s.role_id, s.skill_id, s.must FROM opportunity_role_skills s JOIN opportunity_roles r ON r.id = s.role_id WHERE r.opportunity_id = ? ORDER BY s.rowid",
    opportunityId,
  );
  const pc = all<{ problem_class_id: string | null }>("SELECT problem_class_id FROM opportunities WHERE id = ?", opportunityId)[0]?.problem_class_id ?? null;
  return roles.map((r) => ({
    role: r.role,
    problemClassId: pc,
    must: skills.filter((s) => s.role_id === r.id && s.must === 1).map((s) => s.skill_id),
    nice: skills.filter((s) => s.role_id === r.id && s.must === 0).map((s) => s.skill_id),
  }));
}

function opportunities() {
  return all<OpportunityRow & { demo_query: string | null }>("SELECT * FROM opportunities WHERE status = 'open'");
}

export type MatchedOpportunity = OpportunityRow & { demo_query: string | null };

/** An open opportunity whose demo question or title is exactly this request (no AI involved). */
export function exactOpportunity(query: string): MatchedOpportunity | null {
  const q = norm(query);
  return opportunities().find((o) => (o.demo_query && norm(o.demo_query) === q) || norm(o.title) === q) ?? null;
}

export async function matchOpportunity(query: string): Promise<MatchedOpportunity | null> {
  const q = norm(query);
  const opps = opportunities();
  const exact = exactOpportunity(query);
  if (exact) return exact;
  // semantic match against cached opportunity embeddings
  try {
    const vecs = all<{ ref_id: string; vector: string }>("SELECT ref_id, vector FROM embeddings WHERE ref_type = 'opportunity'");
    if (vecs.length) {
      const [qv] = await embed([query]);
      let best = { id: "", s: 0 };
      for (const v of vecs) {
        const s = cosine(qv, JSON.parse(v.vector));
        if (s > best.s) best = { id: v.ref_id, s };
      }
      if (best.s >= 0.8) return opps.find((o) => o.id === best.id) ?? null;
    }
  } catch {
    /* embeddings unavailable: fall through to keyword overlap */
  }
  const words = new Set(q.split(" ").filter((w) => w.length > 3));
  let best = { o: null as (OpportunityRow & { demo_query: string | null }) | null, s: 0 };
  for (const o of opps) {
    const ow = norm(`${o.title} ${o.demo_query ?? ""}`).split(" ").filter((w) => w.length > 3);
    const s = ow.filter((w) => words.has(w)).length / Math.max(4, ow.length);
    if (s > best.s) best = { o, s };
  }
  return best.s >= 0.5 ? best.o : null;
}

export function mapSkill(m: Model, name: string): string | null {
  const s = m.skillByName.get(name.toLowerCase());
  if (s) return s.id;
  for (const sk of m.skills.values()) {
    const a = sk.name.toLowerCase();
    const b = name.toLowerCase();
    if (a.includes(b) || b.includes(a)) return sk.id;
  }
  return null;
}

export const REQ_SYSTEM =
  "You turn a business request into a staffing requirement for SkillBridge. Use skills from this list only: {SKILLS}. " +
  'Return ONLY JSON: {"roles":[{"role":string,"must_have_skills":[string],"nice_to_have":[string]}]} with 2 to 6 roles.';

/** `matched` lets the caller pass an opportunity match it already ran (undefined = match here). */
export async function parseRequest(query: string, m: Model = data(), matched?: MatchedOpportunity | null): Promise<ParsedRequest> {
  const opp = matched === undefined ? await matchOpportunity(query) : matched;
  if (opp) return { opportunity: opp, roles: opportunityRoles(opp.id), provider: "rules" };
  const skillList = [...m.skills.values()].map((s) => s.name).join(", ");
  try {
    const r = await chatJson<{ roles: { role: string; must_have_skills: string[]; nice_to_have?: string[] }[] }>(
      "chat", REQ_SYSTEM.replace("{SKILLS}", skillList), query, { kind: "requirements", maxTokens: 900 });
    const roles = (r.data.roles ?? [])
      .map((x) => ({
        role: x.role,
        must: x.must_have_skills.map((s) => mapSkill(m, s)).filter((s): s is string => !!s).slice(0, 4),
        nice: (x.nice_to_have ?? []).map((s) => mapSkill(m, s)).filter((s): s is string => !!s).slice(0, 3),
      }))
      .filter((x) => x.must.length);
    if (roles.length) return { opportunity: null, roles, provider: r.provider };
  } catch {
    /* fall through to keyword parsing */
  }
  const q = query.toLowerCase();
  const hits = [...m.skills.values()].filter((s) => q.includes(s.name.toLowerCase())).map((s) => s.id);
  return { opportunity: null, roles: hits.length ? [{ role: "Specialist", must: hits.slice(0, 4), nice: [] }] : [], provider: "template" };
}
