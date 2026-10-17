// Concierge agent: answers a manager's question by choosing and calling SkillBridge tools itself (function
// calling: Gemini on Vertex AI plans and calls the tools), then writing a short answer.
// Guardrails: read-only tools; at least one tool call before any answer; a grounding check rejects figures the tools
// did not return; if no model can call tools, a rule-based planner calls them and the answer is built from their results.
import { chatJson, chatTools, toolProviders, type ChatMsg } from "../llm.ts";
import { TOOLS, TOOL_SPECS, type ToolOut } from "./conciergeTools.ts";
import { finishRun, startRun, type Step } from "./store.ts";
import type { ConciergeAnswer, ConciergeRef } from "../types.ts";

export const CONCIERGE_SYSTEM =
  "You are the SkillBridge Concierge, an AI agent for managers at Veridane Networks (a fictional international telecom and technology services company). " +
  "You answer by calling SkillBridge tools, which return facts from the capability graph and from the other agents " +
  "(Connectivity, People Growth, Opportunity Scout, Risk Sentinel). Rules: always call the tools that answer the question before replying, " +
  "and call several when the question has several parts; never invent people, numbers or facts the tools did not return; " +
  "people the tools do not return are private; you cannot approve or change anything, so point to the Agents inbox for decisions. " +
  "Reply in plain words, at most 5 short sentences or bullet points, lead with the answer, and copy figures exactly as the tools give them. Never use em dashes.";

const MAX_ROUNDS = 4;
const RESULT_CHARS = 2400;

// ---------------------------------------------------------------- routing
/** Questions the Concierge owns (checked after executive rules and exact demo requests). */
export function conciergeRule(q: string): boolean {
  return /\b(agents?|inbox|proposals?|waiting for (me|approval)|approve)\b|what (changed|happened|is new)|what did .* (find|do)|\btoday\b|this week|tell me about|\bprofile\b|\brising\b|\bbridges?\b|overload|bottleneck|knowledge islands?|re-?engage|forgotten|off-chart|recogni[sz]e|\bwhat if\b|\bif .* (leaves?|left|resigns?)\b|hidden talent|anyone (i|we) should/i.test(q)
    || /\bwho is [A-Z][a-z]+/.test(q);
}

// ---------------------------------------------------------------- planner (no tool-calling model available)
function plan(q: string): { name: string; args: Record<string, unknown> }[] {
  const s = q.toLowerCase();
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const lens = (re: RegExp, name: string) => { if (re.test(s)) calls.push({ name: "people_signal", args: { lens: name } }); };
  if (/inbox|proposals?|waiting|approv/.test(s)) calls.push({ name: "agent_inbox", args: {} });
  if (/agents?\b.*(find|did|do)|what (changed|happened|is new)|today|this week|activity/.test(s)) calls.push({ name: "agent_activity", args: {} });
  lens(/rising|growing|recogni[sz]e/, "rising");
  lens(/bridge|connect(s|ing)? teams/, "bridges");
  lens(/overload|bottleneck|too much work|burn/, "bottlenecks");
  lens(/island|trapped/, "islands");
  lens(/re-?engage|forgotten|faded/, "forgotten");
  lens(/off-chart|ghost|outside (their|the) (role|chart)/, "ghosts");
  lens(/hidden talent|under-?recogni/, "hidden_talent");
  const name = q.match(/(?:tell me about|who is|profile of|about)\s+([A-Z][\w'-]+(?:\s+[A-Z][\w'-]+){0,3})/);
  const leave = q.match(/(?:if|when)\s+([A-Z][\w'-]+(?:\s+[A-Z][\w'-]+){0,3})\s+(?:leaves?|left|resigns?)/);
  if (leave) calls.push({ name: "what_if", args: { people: [leave[1]] } });
  else if (name) calls.push({ name: "get_person", args: { person: name[1] } });
  if (/opportunit|revenue|saving|consultan/.test(s) && !calls.length) calls.push({ name: "opportunities", args: { type: "any" } });
  if (/value|unlocked|dashboard/.test(s) && !calls.some((c) => c.name === "opportunities")) calls.push({ name: "value_dashboard", args: {} });
  if (!calls.length) calls.push({ name: "staff_request", args: { request: q } });
  return calls.slice(0, 4);
}

// ---------------------------------------------------------------- grounding
/** Figures in the answer (dollar amounts, percentages, decimals) that no tool result contains. */
export function ungrounded(answer: string, evidence: string): string[] {
  const norm = (x: string) => x.toLowerCase().replace(/,/g, "").replace(/\s+/g, "");
  const ev = norm(evidence);
  const AMT = /\$\s?(\d[\d,]*(?:\.\d+)?)\s?([kKmM]?)\b/g;
  const amtValue = (num: string, unit: string) => parseFloat(num.replace(/,/g, "")) * (/k/i.test(unit) ? 1e3 : /m/i.test(unit) ? 1e6 : 1);
  const evAmt = [...evidence.matchAll(AMT)].map((m) => amtValue(m[1], m[2]));
  const missing: string[] = [];
  // dollar amounts compare by value ($168k = $168,000), within rounding
  for (const m of answer.matchAll(AMT)) {
    const v = amtValue(m[1], m[2]);
    if (!evAmt.some((e) => Math.abs(e - v) <= Math.max(500, e * 0.01))) missing.push(m[0]);
  }
  // percentages and decimals must appear as written
  for (const f of answer.replace(AMT, "").match(/\d+(\.\d+)?%|\b\d+\.\d+\b/g) ?? []) if (!ev.includes(norm(f))) missing.push(f);
  return [...new Set(missing)];
}

const FOLLOW_UPS: Record<string, string[]> = {
  agent_inbox: ["What did the agents find today?"],
  agent_activity: ["Is anything waiting for my approval?"],
  people_signal: ["Is anyone overloaded?", "Who connects teams that would otherwise not talk?"],
  get_person: ["Who is rising fastest?"],
  what_if: ["Where are we over-dependent on individuals?"],
  opportunities: ["Where should we invest the savings?"],
  staff_request: ["Where are our biggest capability gaps?"],
  value_dashboard: ["Where should we invest the savings?"],
  executive_question: ["What did the agents find today?"],
};

// ---------------------------------------------------------------- run
export async function concierge(query: string, t0 = Date.now()): Promise<ConciergeAnswer> {
  const runId = startRun("concierge", `Question: ${query.slice(0, 120)}`);
  const steps: ConciergeAnswer["steps"] = [];
  const outs: { name: string; out: ToolOut }[] = [];

  async function call(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = TOOLS[name];
    const t = Date.now();
    if (!tool) { steps.push({ tool: name, args: JSON.stringify(args), result: "unknown tool", ms: 0 }); return JSON.stringify({ error: `unknown tool ${name}` }); }
    try {
      const out = await tool.run(args as Record<string, any>);
      outs.push({ name, out });
      steps.push({ tool: name, args: JSON.stringify(args), result: out.summary, ms: Date.now() - t });
      return JSON.stringify(out.facts).slice(0, RESULT_CHARS);
    } catch (e) {
      steps.push({ tool: name, args: JSON.stringify(args), result: `error: ${(e as Error).message}`, ms: Date.now() - t });
      return JSON.stringify({ error: (e as Error).message });
    }
  }

  let answer = "", mode: ConciergeAnswer["mode"] = "planned", provider = "template", model = "rules";

  // 1. tool calling: the model plans, calls tools, reads results, answers
  for (const p of toolProviders()) {
    const messages: ChatMsg[] = [{ role: "system", content: CONCIERGE_SYSTEM }, { role: "user", content: query }];
    const before = outs.length;
    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const t = Date.now();
        const r = await chatTools(p, messages, TOOL_SPECS);
        const calls = r.message.tool_calls ?? [];
        steps.push({ tool: "Gemini", args: "", result: calls.length ? `chose ${calls.map((c) => c.function.name).join(", ")}` : "wrote the answer", ms: Date.now() - t, ai: true });
        model = r.model;
        if (!calls.length) { answer = (r.message.content ?? "").trim(); break; }
        messages.push(r.message);
        for (const c of calls) {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(c.function.arguments || "{}"); } catch { /* empty args */ }
          messages.push({ role: "tool", tool_call_id: c.id, content: await call(c.function.name, args) });
        }
      }
      if (outs.length === before) throw new Error("answered without calling any tool");
      if (!answer) throw new Error(`no answer after ${MAX_ROUNDS} rounds`);
      mode = "tool-calling";
      provider = p;
      break;
    } catch (e) {
      steps.push({ tool: "Gemini tool calling", args: "", result: `fell back: ${(e as Error).message.slice(0, 120)}`, ms: 0 });
      answer = "";
    }
  }

  // 2. no tool-calling model: the planner picks the tools; a model (or template) writes the answer
  if (!answer) {
    for (const c of plan(query)) await call(c.name, c.args);
    const facts = outs.map((o) => ({ tool: o.name, facts: o.out.facts }));
    try {
      const t = Date.now();
      const r = await chatJson<{ answer: string }>("chat", `${CONCIERGE_SYSTEM} Answer only from these tool results. Return ONLY JSON: {"answer": string}.`,
        JSON.stringify({ question: query, tool_results: facts }).slice(0, 7000), { kind: "concierge_summary", maxTokens: 400 });
      steps.push({ tool: "summary model", args: "", result: "wrote the answer from the tool results", ms: Date.now() - t, ai: true });
      answer = r.data.answer?.trim() ?? "";
      provider = r.provider;
      model = r.model;
    } catch {
      /* template below */
    }
    if (!answer) answer = outs.map((o) => `• ${o.out.summary}`).join("\n");
  }

  // 3. grounding: any figure the tools did not return means the answer is rebuilt from the tool results
  const evidence = outs.map((o) => `${JSON.stringify(o.out.facts)} ${o.out.summary}`).join(" ");
  answer = answer.replace(/\s*[–—]\s*/g, ", ");
  const missing = ungrounded(answer, evidence);
  const grounded = !missing.length;
  steps.push({ tool: "grounding check", args: "", result: grounded ? "every figure found in the tool results" : `not found: ${missing.join(", ")}; answer rebuilt from tool results`, ms: 0 });
  if (!grounded) answer = outs.map((o) => `• ${o.out.summary}`).join("\n");

  const refs = new Map<string, ConciergeRef>();
  for (const o of outs) for (const r of o.out.refs) if (!refs.has(`${r.kind}:${r.id}`)) refs.set(`${r.kind}:${r.id}`, r);
  const used = [...new Set(outs.map((o) => o.name))];
  const followUps = [...new Set(used.flatMap((u) => FOLLOW_UPS[u] ?? []))].filter((f) => f.toLowerCase() !== query.toLowerCase()).slice(0, 3);
  const result: ConciergeAnswer = {
    kind: "concierge", query, answer, mode, provider, model, grounded,
    steps, refs: [...refs.values()].slice(0, 14), followUps,
    highlight: { nodeIds: [...new Set(outs.flatMap((o) => o.out.nodeIds))].slice(0, 80), stars: [...new Set(outs.flatMap((o) => o.out.stars ?? []))] },
    elapsedMs: Date.now() - t0,
  };
  const logSteps: Step[] = steps.map((s) => ({ tool: s.tool, detail: `${s.args ? `${s.args} → ` : ""}${s.result}`, ms: s.ms, ai: s.ai }));
  finishRun(runId, "done", logSteps, `${mode === "tool-calling" ? "Tool calling" : "Planned"}: ${used.join(", ") || "no tools"}. ${answer.slice(0, 140)}`, provider, result.highlight.nodeIds);
  return result;
}
