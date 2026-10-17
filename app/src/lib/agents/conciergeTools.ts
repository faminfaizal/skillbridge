// The Concierge's tools: read-only wrappers over the SkillBridge engines and the other agents' state.
// Each returns compact facts for the model, a one-line summary (used when no model is available),
// and references the UI can link to. People who opted out of visibility are never returned.
import { all } from "../db.ts";
import { pct, money } from "../format.ts";
import { data, type Model } from "../engine/data.ts";
import { capability } from "../engine/match.ts";
import { growthPaths } from "../engine/growth.ts";
import { hiddenTalent } from "../engine/hidden.ts";
import { signals } from "../engine/signals.ts";
import { discover } from "../engine/discover.ts";
import { execFacts } from "../engine/exec.ts";
import { impactSummary } from "../engine/impact.ts";
import { whatIf } from "../engine/whatif.ts";
import { parseRequest } from "../engine/requirements.ts";
import { formTeam } from "../engine/team.ts";
import { estimateValue, valueForOpportunity } from "../engine/value.ts";
import { agentName } from "./registry.ts";
import type { ToolSpec } from "../llm.ts";
import type { ConciergeRef, ExecIntent, SignalKind } from "../types.ts";

export interface ToolOut { facts: unknown; summary: string; refs: ConciergeRef[]; nodeIds: string[]; stars?: string[] }

const LENSES = ["hidden_talent", "rising", "bridges", "bottlenecks", "islands", "forgotten", "ghosts"] as const;
const LENS_NAME: Record<string, string> = { hidden_talent: "Hidden talent", rising: "Rising stars", bridges: "Collaboration bridges", bottlenecks: "Overloaded connectors",
  islands: "Knowledge islands", forgotten: "Experts to re-engage", ghosts: "Off-chart contributors" };
const TOPICS: ExecIntent[] = ["gaps", "external", "future", "dependency", "revenue", "value", "invest"];

const visible = (m: Model, id: string) => m.people.get(id)?.consent_visibility === 1;
const personRef = (m: Model, id: string): ConciergeRef => ({ id, label: m.people.get(id)!.name, kind: "person" });
const ago = (iso: string) => { const s = Math.round((Date.now() - Date.parse(iso)) / 1000); return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };

/** Resolve a person id or a (partial) name to visible people, best match first. */
export function resolvePeople(m: Model, q: string): string[] {
  const s = String(q ?? "").trim().toLowerCase();
  if (!s) return [];
  if (m.people.has(q) && visible(m, q)) return [q];
  const words = s.split(/\s+/).filter((w) => w.length > 1);
  return [...m.people.values()]
    .filter((p) => visible(m, p.id) && p.level !== "C")
    .map((p) => ({ id: p.id, n: p.name.toLowerCase(), hit: words.filter((w) => p.name.toLowerCase().includes(w)).length }))
    .filter((x) => x.hit > 0 && (x.hit === words.length || x.n === s))
    .sort((a, b) => b.hit - a.hit || a.n.localeCompare(b.n))
    .map((x) => x.id);
}

function lensMembership(m: Model, id: string): string[] {
  const out: string[] = [];
  for (const k of ["rising", "bridges", "bottlenecks", "forgotten", "ghosts"] as SignalKind[]) {
    const it = signals(k).items.find((x) => x.id === id);
    if (it) out.push(`${LENS_NAME[k]}: ${it.metric} ${it.metricLabel}`);
  }
  const ht = hiddenTalent(10).find((x) => x.personId === id);
  if (ht) out.push(`Hidden talent: contribution ${ht.contribution}, visibility ${ht.visibility}`);
  return out;
}

export const TOOLS: Record<string, { spec: ToolSpec; run: (args: Record<string, any>) => Promise<ToolOut> | ToolOut }> = {
  find_people: {
    spec: { type: "function", function: { name: "find_people", description: "Find people by name, job title, department or skill. Returns ids for get_person.",
      parameters: { type: "object", properties: { query: { type: "string", description: "A name, title, department or skill" } }, required: ["query"] } } },
    run: ({ query }) => {
      const m = data();
      const q = String(query ?? "").toLowerCase();
      const skill = [...m.skills.values()].find((s) => s.name.toLowerCase() === q || q.includes(s.name.toLowerCase()));
      let ids = resolvePeople(m, query);
      if (!ids.length) {
        ids = [...m.people.values()].filter((p) => visible(m, p.id) && p.level !== "C" && (
          p.title.toLowerCase().includes(q) || (m.departments.get(p.department_id ?? "") ?? "").toLowerCase().includes(q) ||
          (skill ? capability(m, p.id, skill.id).value >= 0.7 && capability(m, p.id, skill.id).source !== "adjacent" : false)))
          .sort((a, b) => (skill ? capability(m, b.id, skill.id).value - capability(m, a.id, skill.id).value : 0)).map((p) => p.id);
      }
      const top = ids.slice(0, 8);
      const facts = top.map((id) => {
        const p = m.people.get(id)!;
        const skills = [...(m.declared.get(id)?.values() ?? [])].sort((a, b) => b.level - a.level).slice(0, 3).map((d) => m.skills.get(d.skill_id)?.name);
        return { id, name: p.name, title: p.title, department: m.departments.get(p.department_id ?? "") ?? "", location: m.locations.get(p.location_id), top_skills: skills, ...(skill ? { [skill.name]: pct(capability(m, id, skill.id).value) } : {}) };
      });
      return { facts, summary: top.length ? `${top.length} match${top.length === 1 ? "" : "es"} for "${query}": ${facts.slice(0, 4).map((f) => f.name).join(", ")}.` : `Nobody visible matches "${query}".`,
        refs: top.map((id) => personRef(m, id)), nodeIds: top };
    },
  },
  get_person: {
    spec: { type: "function", function: { name: "get_person", description: "Profile of one person: role, skills (declared and AI-inferred with evidence), work, growth paths, and which SkillBridge lenses list them.",
      parameters: { type: "object", properties: { person: { type: "string", description: "Person id (P-123) or full name" } }, required: ["person"] } } },
    run: ({ person }) => {
      const m = data();
      const id = resolvePeople(m, person)[0];
      if (!id) return { facts: { error: "No visible person with that name or id (they may have a private profile)." }, summary: `No visible profile for "${person}".`, refs: [], nodeIds: [] };
      const p = m.people.get(id)!;
      const declared = [...(m.declared.get(id)?.values() ?? [])].sort((a, b) => b.level - a.level).slice(0, 5).map((d) => `${m.skills.get(d.skill_id)?.name} ${d.level}/5`);
      const inferred = [...(m.inferred.get(id)?.values() ?? [])].map((i) => `${m.skills.get(i.skill_id)?.name} (${pct(i.confidence)}, AI-inferred from ${i.evidence_ids.split(",").length} records)`);
      const projects = (m.assignments.get(id) ?? []).sort((a, b) => b.end_date.localeCompare(a.end_date));
      const incidents = all<{ n: number }>("SELECT COUNT(*) n FROM incident_resolvers WHERE person_id = ?", id)[0].n;
      const g = growthPaths(id);
      const lenses = lensMembership(m, id);
      const facts = {
        id, name: p.name, title: p.title, department: m.departments.get(p.department_id ?? "") ?? "", location: m.locations.get(p.location_id), since: p.hire_year,
        availability: `${p.availability_pct}%`, declared_skills: declared, ai_inferred_skills: inferred,
        projects: `${projects.length} (latest: ${projects.slice(0, 2).map((a) => m.projects.get(a.project_id)?.name).join("; ")})`, incidents_resolved: incidents,
        ready_now_for: g.readyNow.map((x) => `${x.role} on ${x.title} (${pct(x.score)})`),
        nearly_ready_for: g.nearlyReady.map((x) => `${x.role} on ${x.title}: ${pct(x.readiness)} ready, ${x.weeks} weeks`),
        listed_in_lenses: lenses,
      };
      return { facts, summary: `${p.name}, ${p.title} (${facts.department}). ${inferred.length ? `AI-inferred: ${inferred.slice(0, 2).join("; ")}. ` : ""}${lenses.length ? `Listed in ${lenses.map((l) => l.split(":")[0]).join(", ")}.` : ""}`,
        refs: [personRef(m, id)], nodeIds: [id, ...projects.slice(0, 4).map((a) => a.project_id)], stars: [id] };
    },
  },
  staff_request: {
    spec: { type: "function", function: { name: "staff_request", description: "Build a team from inside for a piece of work: best person per role, gaps, reskilling options and the value in USD.",
      parameters: { type: "object", properties: { request: { type: "string", description: "The work, in the user's words" } }, required: ["request"] } } },
    run: async ({ request }) => {
      const m = data();
      const parsed = await parseRequest(String(request), m);
      const t = formTeam(parsed.roles, m);
      const v = parsed.opportunity ? valueForOpportunity(parsed.opportunity, m) : estimateValue(parsed.roles, t.team, m);
      const facts = {
        matched_opportunity: parsed.opportunity?.title ?? null, coverage: pct(t.coverage),
        team: t.team.map((c) => ({ role: c.role, name: visible(m, c.personId) ? c.name : "a colleague with a private profile", match: pct(c.score), found_via_evidence: c.hidden })),
        gaps: t.gaps.map((g) => ({ role: g.role, skills: g.skills, reskill: g.reskill.map((r) => `${r.name} ${pct(r.readiness)} ready, ${r.weeks} weeks`) })),
        value: { cost_avoided: money(v.costAvoided), productivity: money(v.productivity), revenue_potential: v.revenuePotential ? money(v.revenuePotential) : "none" },
      };
      const people = t.team.filter((c) => visible(m, c.personId)).map((c) => c.personId);
      return { facts, summary: `${t.team.length} internal people cover ${pct(t.coverage)} of the roles${t.gaps.length ? `, ${t.gaps.length} gap${t.gaps.length === 1 ? "" : "s"}` : ""}; ${money(v.costAvoided)} external cost avoided.`,
        refs: [...(parsed.opportunity ? [{ id: parsed.opportunity.id, label: parsed.opportunity.title, kind: "opportunity" as const }] : []), ...people.map((id) => personRef(m, id))],
        nodeIds: [...(parsed.opportunity ? [parsed.opportunity.id] : []), ...people], stars: t.team.filter((c) => c.hidden).map((c) => c.personId) };
    },
  },
  executive_question: {
    spec: { type: "function", function: { name: "executive_question", description: "A strategic answer as a decision: capability gaps, paying externals for skills we have, future critical skills, over-dependence on individuals, revenue from under-used capability, value created, where to invest the savings.",
      parameters: { type: "object", properties: { topic: { type: "string", enum: TOPICS } }, required: ["topic"] } } },
    run: ({ topic }) => {
      const t = (TOPICS.includes(topic) ? topic : "gaps") as ExecIntent;
      const b = execFacts(t);
      const facts = { decision: b.headline, figures: Object.fromEntries(b.metrics.map((x) => [x.label, x.value])),
        top_rows: b.table.rows.slice(0, 4).map((r) => Object.fromEntries(b.table.columns.map((c, i) => [c.label, r.cells[i]]))) };
      return { facts, summary: b.headline, refs: [], nodeIds: b.highlight.nodeIds.slice(0, 30) };
    },
  },
  people_signal: {
    spec: { type: "function", function: { name: "people_signal", description: "People or skills listed by a SkillBridge lens: hidden_talent, rising (rising stars), bridges (only link between teams), bottlenecks (overloaded connectors), islands (expertise trapped in one team), forgotten (experts to re-engage), ghosts (off-chart contributors).",
      parameters: { type: "object", properties: { lens: { type: "string", enum: LENSES as unknown as string[] } }, required: ["lens"] } } },
    run: ({ lens }) => {
      const m = data();
      const k = (LENSES as readonly string[]).includes(lens) ? lens : "rising";
      const ref: ConciergeRef = { id: k === "hidden_talent" ? "talent" : k, label: LENS_NAME[k], kind: "lens" };
      if (k === "hidden_talent") {
        const list = hiddenTalent(5);
        return { facts: list.map((p) => ({ name: p.name, title: p.title, projects: p.projects, contribution: p.contribution, visibility: p.visibility, trend: p.trend })),
          summary: `Hidden talent: ${list.slice(0, 3).map((p) => p.name).join(", ")}.`, refs: [ref, ...list.slice(0, 5).map((p) => personRef(m, p.personId))],
          nodeIds: list.map((p) => p.personId), stars: list.map((p) => p.personId) };
      }
      const r = signals(k as SignalKind);
      const items = r.items.slice(0, 5);
      const facts = items.map((it) => ({ name: it.title, who: it.subtitle, [it.metricLabel]: it.metric, evidence: it.facts.slice(0, 2) }));
      return { facts, summary: items.length ? `${r.title}: ${items.slice(0, 3).map((it) => `${it.title} (${it.metric})`).join(", ")}.` : `${r.title}: nothing stands out.`,
        refs: [ref, ...items.flatMap((it) => it.people.slice(0, 1).map((p) => personRef(m, p.id)))],
        nodeIds: items.map((it) => it.focusId), stars: k === "bottlenecks" || k === "islands" ? [] : items.map((it) => it.id) };
    },
  },
  opportunities: {
    spec: { type: "function", function: { name: "opportunities", description: "Opportunity board: revenue offers, consultancy we did not need, spare capacity, hires avoidable by reskilling, duplicated work, hidden experts, collaboration gaps, key-person risk, SME requests.",
      parameters: { type: "object", properties: { type: { type: "string", enum: ["any", "revenue", "external_spend", "capacity", "reskill", "duplicate", "hidden_expert", "collaboration", "risk", "sme"] } } } } },
    run: ({ type }) => {
      const d = discover();
      const cards = d.cards.filter((c) => !type || type === "any" || c.type === type).slice(0, 6);
      return { facts: { total_found: money(d.totalValueAmt), cards: cards.map((c) => ({ type: c.type, title: c.title, figure: c.metric, detail: c.detail })) },
        summary: `${cards.length} finding${cards.length === 1 ? "" : "s"}${cards[0] ? `, led by ${cards[0].title} (${cards[0].metric})` : ""}.`,
        refs: [{ id: "discover", label: "Opportunities", kind: "lens" }], nodeIds: cards.flatMap((c) => c.nodeIds.slice(0, 4)) };
    },
  },
  agent_inbox: {
    spec: { type: "function", function: { name: "agent_inbox", description: "Proposals from the AI agents (People Growth, Opportunity Scout, Risk Sentinel) waiting for a human decision.",
      parameters: { type: "object", properties: {} } } },
    run: () => {
      const rows = all<{ agent: string; title: string; value_amt: number; approver: string; created_at: string; node_ids: string }>(
        "SELECT agent, title, value_amt, approver, created_at, node_ids FROM agent_inbox WHERE status = 'pending' ORDER BY id DESC LIMIT 8");
      return { facts: { waiting: rows.length, proposals: rows.map((r) => ({ from: agentName(r.agent), title: r.title, value: r.value_amt ? money(r.value_amt) : "none", approver: r.approver, raised: ago(r.created_at) })) },
        summary: rows.length ? `${rows.length} proposal${rows.length === 1 ? "" : "s"} waiting, e.g. ${rows[0].title}.` : "No proposals waiting.",
        refs: [{ id: "agents", label: "Agents inbox", kind: "agents" }], nodeIds: rows.flatMap((r) => (JSON.parse(r.node_ids) as string[]).slice(0, 3)) };
    },
  },
  agent_activity: {
    spec: { type: "function", function: { name: "agent_activity", description: "What the AI agents did recently: each run's trigger and result (new data, graph changes, proposals).",
      parameters: { type: "object", properties: {} } } },
    run: () => {
      const rows = all<{ agent: string; trigger: string; summary: string | null; started_at: string }>(
        "SELECT agent, trigger, summary, started_at FROM agent_runs WHERE agent <> 'concierge' ORDER BY id DESC LIMIT 6");
      return { facts: rows.map((r) => ({ agent: agentName(r.agent), trigger: r.trigger, result: r.summary, when: ago(r.started_at) })),
        summary: rows.length ? `${rows.length} recent agent run${rows.length === 1 ? "" : "s"}; latest: ${agentName(rows[0].agent)}, ${rows[0].summary}` : "The agents have not run since the last reset.",
        refs: [{ id: "agents", label: "Agent activity", kind: "agents" }], nodeIds: [] };
    },
  },
  what_if: {
    spec: { type: "function", function: { name: "what_if", description: "Blast radius if some people leave: systems that lose most of their expertise and customers affected.",
      parameters: { type: "object", properties: { people: { type: "array", items: { type: "string" }, description: "Person ids or full names" } }, required: ["people"] } } },
    run: ({ people }) => {
      const m = data();
      const ids = [...new Set((Array.isArray(people) ? people : [people]).flatMap((p: string) => resolvePeople(m, p).slice(0, 1)))];
      if (!ids.length) return { facts: { error: "No visible people matched." }, summary: "No visible people matched.", refs: [], nodeIds: [] };
      const w = whatIf(ids);
      return { facts: { removed: ids.map((id) => m.people.get(id)!.name), systems: w.systems.map((s) => `${s.name}: loses ${pct(s.coverageLost)} of its expertise, ${s.remainingExperts} experts left`), customers_affected: w.customers.length },
        summary: `If ${ids.map((id) => m.people.get(id)!.name).join(", ")} ${ids.length === 1 ? "leaves" : "leave"}: ${w.systems.length} system${w.systems.length === 1 ? "" : "s"} hit, ${w.customers.length} customers affected.`,
        refs: [...ids.map((id) => personRef(m, id)), { id: "risk", label: "Dependency risk", kind: "lens" }], nodeIds: w.highlight.nodeIds };
    },
  },
  value_dashboard: {
    spec: { type: "function", function: { name: "value_dashboard", description: "Value unlocked so far in USD: cost avoided, productivity, recruitment avoided, revenue, and the latest impact records.",
      parameters: { type: "object", properties: {} } } },
    run: () => {
      const s = impactSummary();
      return { facts: { total: money(s.totals.total), cost_avoided: money(s.totals.costAvoided), productivity: money(s.totals.productivity), recruitment: money(s.totals.recruitment), revenue: money(s.totals.revenue),
        records: s.records.length, latest: s.records.slice(0, 3).map((r) => `${r.date}: ${r.title}`) },
        summary: `${money(s.totals.total)} unlocked across ${s.records.length} impact records.`, refs: [], nodeIds: [] };
    },
  },
};

export const TOOL_SPECS: ToolSpec[] = Object.values(TOOLS).map((t) => t.spec);
export { LENS_NAME };
