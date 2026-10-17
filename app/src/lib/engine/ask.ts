// Ask AI orchestration. Executive questions -> Executive Intelligence; everything else:
// request -> roles -> team + gaps -> value -> narrative -> graph highlight.
import { data } from "./data.ts";
import { exactOpportunity, matchOpportunity, parseRequest } from "./requirements.ts";
import { concierge, conciergeRule } from "../agents/concierge.ts";
import { formTeam } from "./team.ts";
import { estimateValue, valueForOpportunity } from "./value.ts";
import { narrative } from "./explain.ts";
import { classifyIntent, execAnswer, looksLikeQuestion, ruleIntent } from "./exec.ts";
import type { AskResult } from "../types.ts";

export async function ask(query: string): Promise<AskResult> {
  const t0 = Date.now();
  const m = data();
  // 1. executive questions (rules); 2. exact demo requests; 3. Concierge questions (rules); 4. fuzzy opportunity match;
  // 5. the LLM classifier for anything else that reads as a question
  const rule = ruleIntent(query);
  if (rule) return execAnswer(rule, query, t0, m);
  let matched: Awaited<ReturnType<typeof matchOpportunity>> | undefined = exactOpportunity(query) ?? undefined;
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
