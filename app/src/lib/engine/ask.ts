// Ask AI orchestration. Executive questions -> Executive Intelligence; everything else:
// request -> roles -> team + gaps -> value -> narrative -> graph highlight. With a session id, every answer is kept as
// conversation memory and a follow-up ("what about them?") goes to the Concierge with the earlier turns.
import { data } from "./data.ts";
import { exactOpportunity, matchOpportunity, parseRequest } from "./requirements.ts";
import { conciergeRule, runConcierge, type ConciergeOptions } from "../agents/concierge.ts";
import { formTeam } from "./team.ts";
import { estimateValue, valueForOpportunity } from "./value.ts";
import { narrative } from "./explain.ts";
import { classifyIntent, execAnswer, looksLikeQuestion, ruleIntent } from "./exec.ts";
import { isFollowUp, recall, remember } from "../cloud/memory.ts";
import type { AskResult, ConciergeAnswer } from "../types.ts";

export interface AskOptions { sessionId?: string }

export async function ask(query: string, opts: AskOptions = {}): Promise<AskResult> {
  const t0 = Date.now();
  let evidence = "";
  const concierge = async (q: string, t: number, o?: ConciergeOptions): Promise<ConciergeAnswer> => {
    const r = await runConcierge(q, t, o);
    evidence = r.evidence;
    return r.result;
  };
  const r = await route(query, t0, opts.sessionId, concierge);
  if (opts.sessionId) remember(opts.sessionId, turnOf(query, r, evidence));
  return r;
}

/** One answer as a memory turn: a one-line reply, the tools used and the figures it rests on. */
function turnOf(q: string, r: AskResult, evidence: string): Parameters<typeof remember>[1] {
  const at = Date.now();
  if (r.kind === "concierge") return { q, a: r.answer, kind: r.kind, tools: [...new Set(r.steps.filter((s) => !s.ai && s.tool !== "grounding check" && s.tool !== "Conversation memory" && !s.tool.startsWith("Gemini")).map((s) => s.tool))], evidence, at };
  if (r.kind === "exec") {
    const facts = { headline: r.headline, metrics: r.metrics, rows: r.table.rows.slice(0, 12).map((x) => x.cells) };
    return { q, a: `${r.headline} ${r.narrative}`, kind: r.kind, tools: [`executive:${r.intent}`], evidence: `${JSON.stringify(facts)} ${r.narrative}`, at };
  }
  const facts = {
    opportunity: r.opportunityTitle, team: r.team.map((c) => ({ name: c.name, role: c.role, score: c.score, availability: c.availabilityPct })),
    gaps: r.gaps.map((g) => ({ role: g.role, skills: g.skills })), value: { costAvoided: r.value.costAvoided, productivity: r.value.productivity, revenue: r.value.revenuePotential, recruitment: r.value.recruitmentAvoided },
  };
  return { q, a: r.narrative, kind: r.kind, tools: ["staff_request"], evidence: `${JSON.stringify(facts)} ${r.narrative}`, at };
}

type ConciergeFn = (q: string, t0: number, o?: ConciergeOptions) => Promise<ConciergeAnswer>;

async function route(query: string, t0: number, sessionId: string | undefined, concierge: ConciergeFn): Promise<AskResult> {
  const m = data();
  // 1. executive questions (rules); 2. exact demo requests; 3. Concierge questions (rules); 4. fuzzy opportunity match;
  // 5. the LLM classifier for anything else that reads as a question
  const rule = ruleIntent(query);
  if (rule) return execAnswer(rule, query, t0, m);
  let matched: Awaited<ReturnType<typeof matchOpportunity>> | undefined = exactOpportunity(query) ?? undefined;
  if (!matched && sessionId) {
    const mem = await recall(sessionId);
    if (isFollowUp(query, mem.turns)) return concierge(query, t0, { history: mem.turns, source: mem.source });
  }
  if (!matched && conciergeRule(query)) return concierge(query, t0);
  if (!matched) {
    matched = await matchOpportunity(query);
    if (!matched && looksLikeQuestion(query)) {
      const intent = await classifyIntent(query);
      if (intent === "explore") return concierge(query, t0);
      if (intent) return execAnswer(intent, query, t0, m);
    }
  }

  const parsed = await parseRequest(query, m, matched);
  const { team, gaps, coverage } = formTeam(parsed.roles, m);
  const value = parsed.opportunity ? valueForOpportunity(parsed.opportunity, m) : estimateValue(parsed.roles, team, m);
  const title = parsed.opportunity?.title ?? query;
  const story = await narrative(title, team, gaps, value);

  // highlight: team, their evidence records and the skills they were matched on, plus reskill candidates
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  if (parsed.opportunity) nodeIds.add(parsed.opportunity.id);
  for (const c of team) {
    nodeIds.add(c.personId);
    for (const cap of c.capabilities) {
      nodeIds.add(cap.skillId);
      edgeIds.add(`${cap.source === "inferred" ? "inf" : "has"}:${c.personId}:${cap.skillId}`);
    }
    for (const e of c.evidence) if (e.nodeId) nodeIds.add(e.nodeId);
  }
  for (const g of gaps) for (const r of g.reskill) nodeIds.add(r.personId);

  return {
    kind: "team",
    query,
    opportunityId: parsed.opportunity?.id ?? null,
    opportunityTitle: title,
    requirements: parsed.roles,
    team,
    gaps,
    coverage,
    value,
    highlight: { nodeIds: [...nodeIds], edgeIds: [...edgeIds] },
    narrative: story.text,
    provider: parsed.provider === "rules" ? story.provider : parsed.provider,
    elapsedMs: Date.now() - t0,
  };
}
