// Plain-language summary of a team result. LLM (fast model) first, template fallback; numbers always from the engine.
import { chatJson } from "../llm.ts";
import type { Candidate, Gap, Provider, ValueEstimate } from "../types.ts";

const money = (n: number) => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : `$${Math.round(n / 1000)}k`);

export function templateNarrative(title: string, team: Candidate[], gaps: Gap[], value: ValueEstimate): string {
  if (!team.length && !gaps.length) {
    return "I could not work out which skills this needs. Try naming the outcome and the skills, for example \"a team with machine learning and retail analytics\".";
  }
  const hidden = team.filter((c) => c.hidden);
  const parts = [
    `${team.length} internal people can deliver "${title}".`,
    hidden.length ? `${hidden.map((h) => h.name).join(" and ")} ${hidden.length > 1 ? "were" : "was"} found through evidence in past work, not job title.` : "",
    gaps.length ? `${gaps.length} gap${gaps.length > 1 ? "s" : ""} (${gaps.map((g) => g.skills.join(" + ")).join("; ")}) can be closed by targeted reskilling instead of hiring.` : "No capability gaps.",
    `Value: ${money(value.costAvoided)} external cost avoided, ${money(value.productivity)} productivity${value.revenuePotential ? `, ${money(value.revenuePotential)} revenue potential` : ""}.`,
  ];
  return parts.filter(Boolean).join(" ");
}

const SYSTEM =
  "You brief a general manager on a staffing answer in 3 short sentences, plain words, no hype. " +
  "Sentence 1: how many internal people can deliver the request, naming anyone found_via_evidence and what their work records show. " +
  "Sentence 2: the gap roles and who could be reskilled (with readiness), or say there are no gaps. " +
  "Sentence 3: the value, using the exact figures given. Use only the facts given; never invent names, roles or numbers, and never write field names such as found_via_evidence. " +
  'Return ONLY JSON: {"narrative": string}.';

export async function narrative(title: string, team: Candidate[], gaps: Gap[], value: ValueEstimate): Promise<{ text: string; provider: Provider }> {
  const facts = {
    request: title,
    people_count: team.length,
    team: team.map((c) => ({ name: c.name, role: c.role, match: `${Math.round(c.score * 100)}%`, found_via_evidence: c.hidden
        ? `their job title does not say it, but past work shows ${c.capabilities.filter((x) => x.source === "inferred").map((x) => x.skill).join(", ")}` : undefined })),
    gaps: gaps.map((g) => ({ role: g.role, skills: g.skills, reskill: g.reskill.map((r) => `${r.name} ${Math.round(r.readiness * 100)}% ready`) })),
    value: { cost_avoided: money(value.costAvoided), productivity: money(value.productivity), revenue_potential: value.revenuePotential ? money(value.revenuePotential) : "none" },
  };
  if (!team.length && !gaps.length) return { text: templateNarrative(title, team, gaps, value), provider: "template" };
  try {
    const r = await chatJson<{ narrative: string }>("chat", SYSTEM, JSON.stringify(facts), { kind: "narrative", maxTokens: 300 });
    // house style: no em/en dashes in user-facing copy
    const text = r.data.narrative?.replace(/\s*[–—]\s*/g, ", ");
    if (text && text.length > 20) return { text, provider: r.provider };
  } catch {
    /* template below */
  }
  return { text: templateNarrative(title, team, gaps, value), provider: "template" };
}
