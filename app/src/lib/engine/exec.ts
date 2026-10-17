// Executive Intelligence (PRD 4, 8.7): strategic questions answered as decisions, from graph data.
// Intent comes from rules (an LLM classifier only for unmatched questions); every figure comes from the engine.
// The LLM only writes a short brief over the same facts, with a template fallback.
import { all } from "../db.ts";
import { chatJson } from "../llm.ts";
import { pct, money } from "../format.ts";
import { data, type Model } from "./data.ts";
import { capability, skillReadiness } from "./match.ts";
import { openOpportunities, staffed, type OpenOpportunity } from "./portfolio.ts";
import { duplicatedWork, externalSpend, hiddenExperts, revenueSignals, SINCE, spareCapacity } from "./discover.ts";
import { concentrationRisks, whatIf } from "./whatif.ts";
import { impactSummary } from "./impact.ts";
import { EXEC_QUESTIONS } from "../questions.ts";
import type { ExecAnswer, ExecIntent, Provider, ReskillOption } from "../types.ts";

export { EXEC_QUESTIONS };

// order matters: the more specific patterns first
const RULES: [ExecIntent, RegExp][] = [
  ["invest", /\b(re)?invest|where should .*(savings|money|value) go|allocate .*savings|spend the savings/i],
  ["value", /how much value|value .*(created|unlocked|delivered|generated)|internal reuse|value this (quarter|year)/i],
  ["external", /(pay|paying|paid|spend|spending|consultan|vendor|outsourc|external part).*(already|possess|in-?house|internal(ly)?|we have)/i],
  ["dependency", /over-?(dependen|reliant|reliance)|single points? of failure|key[- ]person|bus factor|depend(ent|ence)? on (a few|individuals|one person|few people)/i],
  ["future", /(critical|important|in demand|needed|matter).*(next|future|\d+\s*years?|two years|2027|2028)|future skills|emerging skills/i],
  ["revenue", /under-?(utili[sz]ed|used)|idle (capacity|capability)|(generate|earn|make|create) (new )?revenue|monetis|monetiz/i],
  ["gaps", /(capability|skills?) gaps?|biggest gaps?|missing (skills|capabilit)|skill shortage|where are we (weak|short|thin)/i],
];

export function ruleIntent(q: string): ExecIntent | null {
  return RULES.find(([, re]) => re.test(q))?.[0] ?? null;
}

export const looksLikeQuestion = (q: string) => /\?\s*$/.test(q) || /^(where|what|which|how|are|do|does|should|is)\b/i.test(q.trim());

export const CLASSIFY_SYSTEM =
  "Classify a business question for SkillBridge, a capability intelligence platform. Intents: " +
  "gaps (capability or skill gaps), external (paying vendors or consultants for skills we already have), future (skills that become critical), " +
  "dependency (over-reliance on individuals), revenue (under-used capability that could earn revenue), value (value created by internal reuse), " +
  "invest (where to invest the savings), staffing (find people or build a team for a piece of work), " +
  "explore (about specific people, who is rising, overloaded or connecting teams, what the AI agents found, or several of these at once). " +
  "Anything about whether one specific piece of work can be done, solved or staffed internally or without hiring is staffing. " +
  'Return ONLY JSON: {"intent": string}.';

export async function classifyIntent(q: string): Promise<ExecIntent | "explore" | null> {
  try {
    const r = await chatJson<{ intent: string }>("fast", CLASSIFY_SYSTEM, q, { kind: "intent", maxTokens: 60 });
    const i = r.data.intent?.trim().toLowerCase();
    if (i === "explore") return "explore";
    return i && i in EXEC_QUESTIONS ? (i as ExecIntent) : null;
  } catch {
    return null;
  }
}

type Built = Omit<ExecAnswer, "kind" | "query" | "intent" | "question" | "narrative" | "provider" | "elapsedMs">;
const worth = (o: OpenOpportunity) => Math.max(0, o.external_quote_amt - o.internal_cost_amt) + o.revenue_potential_amt * o.win_probability;
const skillId = (m: Model, name: string) => m.skillByName.get(name.toLowerCase())?.id ?? name;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const visible = (m: Model, id: string) => m.people.get(id)?.consent_visibility === 1;

// ---------------------------------------------------------------- gaps
interface GapRow { key: string; skills: string[]; opps: OpenOpportunity[]; best: number; reskill?: ReskillOption; worth: number }

export function capabilityGaps(m: Model = data()): GapRow[] {
  const rows = new Map<string, GapRow>();
  for (const o of openOpportunities()) {
    for (const g of staffed(o.id).gaps) {
      const key = g.skills.join(" + ");
      const r = rows.get(key) ?? { key, skills: g.skills, opps: [], best: 0, worth: 0 };
      r.opps.push(o);
      r.best = Math.max(r.best, g.bestScore);
      r.reskill ??= g.reskill.find((x) => visible(m, x.personId));
      r.worth += worth(o);
      rows.set(key, r);
    }
  }
  return [...rows.values()].sort((a, b) => b.worth - a.worth);
}

function gaps(m: Model): Built {
  const rows = capabilityGaps(m);
  const top = rows[0];
  const closable = rows.filter((r) => r.reskill);
  const fix = closable[0];
  const total = sum(rows.map((r) => r.worth));
  const reqs = all<{ skill_id: string; id: string }>("SELECT skill_id, id FROM requisitions WHERE status = 'open'");
  const fixLine = (r: GapRow) => `${r.key} can be closed by reskilling ${r.reskill!.name} in ${r.reskill!.weeks} weeks instead of hiring.`;
  return {
    headline: !top ? "Every open opportunity can be staffed from inside today."
      : top.reskill ? `${rows.length} capability gaps hold back ${money(total)} of open work. The biggest, ${fixLine(top)}`
      : `${rows.length} capability gaps hold back ${money(total)} of open work. The biggest, ${top.key}, has nobody close inside yet.${fix ? ` ${fixLine(fix)}` : ""}`,
    metrics: [
      { label: "Capability gaps", value: String(rows.length), tone: "risk" },
      { label: "Open work held back", value: money(total), tone: "rev" },
      { label: "Closable by reskilling", value: `${closable.length} of ${rows.length}`, tone: "prod" },
    ],
    table: {
      columns: [{ label: "Capability gap" }, { label: "Needed by" }, { label: "Value held back", numeric: true }, { label: "Closest inside" }, { label: "Fix" }],
      rows: rows.slice(0, 6).map((r) => {
        const req = reqs.find((q) => r.skills.some((s) => skillId(m, s) === q.skill_id));
        return {
          cells: [r.key, r.opps.map((o) => o.title).join("; "), money(r.worth),
            r.reskill ? `${r.reskill.name} (${pct(r.reskill.readiness)} ready)` : `Best match ${pct(r.best)}`,
            r.reskill ? `Reskill: ${r.reskill.weeks} weeks, ${r.reskill.costAmt ? money(r.reskill.costAmt) : "no fees"}` : req ? `Hire (${req.id} open)` : "Source externally, grow over time"],
          focusId: r.reskill?.personId,
        };
      }),
    },
    actions: [
      ...(fix ? [{ label: `Start ${fix.reskill!.name.split(" ")[0]}'s path`, detail: `${fix.reskill!.path.map((s) => s.name).join(", ")}: ready by ${fix.reskill!.readyBy}, ${money(fix.reskill!.valueAmt)} hiring cost avoided.`, query: fix.opps[0].demo_query ?? fix.opps[0].title }] : []),
      { label: "Fund targeted reskilling, not generic certificates", detail: `${closable.length} of ${rows.length} gaps have someone inside within reach of the role.` },
    ],
    assumptions: [
      "A gap is a role in an open opportunity where nobody inside scores 70% or more.",
      "Value held back = external cost avoided plus revenue potential x win probability of each opportunity that has the gap.",
      "Reskilling candidates are 60 to 80% ready today; paths take the cheapest steps first and stop once each skill reaches 80%.",
    ],
    highlight: {
      nodeIds: [...rows.flatMap((r) => r.skills.map((s) => skillId(m, s))), ...rows.flatMap((r) => (r.reskill ? [r.reskill.personId] : [])), ...rows.flatMap((r) => r.opps.map((o) => o.id))],
      edgeIds: [], danger: [],
    },
  };
}

// ---------------------------------------------------------------- external
function external(m: Model): Built {
  const rows = externalSpend(m);
  const total = sum(rows.map((r) => r.costAmt));
  const allSpend = all<{ s: number }>("SELECT COALESCE(SUM(cost_amt), 0) s FROM external_engagements WHERE start_date >= ?", SINCE)[0].s;
  const bySkill = new Map<string, number>();
  for (const r of rows) bySkill.set(r.skill, (bySkill.get(r.skill) ?? 0) + r.costAmt);
  const topSkills = [...bySkill.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const experts = new Set(rows.flatMap((r) => r.holders.map((h) => h.id)));
  return {
    headline: rows.length
      ? `${money(total)} of consultancy since ${SINCE.slice(0, 7)} bought skills we already had, mostly ${topSkills.map(([s, v]) => `${s} (${money(v)})`).join(", ")}. ${experts.size} internal experts were under 50% allocated at the time.`
      : "No recent consultancy bought a skill that internal experts had spare capacity for.",
    metrics: [
      { label: "Avoidable spend", value: money(total), tone: "cost" },
      { label: "Share of all consultancy", value: allSpend ? pct(total / allSpend) : "0%", tone: "neutral" },
      { label: "Idle internal experts", value: String(experts.size), tone: "prod" },
    ],
    table: {
      columns: [{ label: "Engagement" }, { label: "Skill" }, { label: "Paid", numeric: true }, { label: "Internal experts under 50%", numeric: true }, { label: "Started" }],
      rows: rows.map((r) => ({ cells: [`${r.vendor}${r.project ? `: ${r.project}` : ""}`, r.skill, money(r.costAmt), String(r.holders.length), r.start.slice(0, 7)], focusId: r.skillId })),
    },
    actions: [
      { label: "Check inside before any consultancy order", detail: `A SkillBridge search takes minutes. Make it a required step for purchase requests above $50k.` },
      ...(rows[0] ? [{ label: `Who can do ${rows[0].skill} work now?`, detail: `Redeploy the ${rows[0].holders.length} ${rows[0].skill} experts with spare capacity.`, query: `Who can deliver ${rows[0].skill} work from inside?` }] : []),
    ],
    assumptions: [
      `External engagements that started on or after ${SINCE}.`,
      "An internal expert holds the skill at 80% or more (declared level 4+ or evidence-backed) and had under 50% allocation on the engagement start date.",
      "Avoidable spend counts the full engagement fee; actual savings depend on internal cost (shown per opportunity in Ask AI).",
    ],
    highlight: { nodeIds: [...rows.map((r) => r.skillId), ...rows.map((r) => r.vendorId), ...experts], edgeIds: [], danger: [] },
  };
}

// ---------------------------------------------------------------- future skills
export interface FutureRow { skillId: string; skill: string; family: string; demand: number; holders: number; nearly: number; pressure: number }

export function futureSkills(m: Model = data()): FutureRow[] {
  const opps = openOpportunities();
  const casesByPc = new Map(all<{ pc: string; n: number }>("SELECT problem_class_id pc, COUNT(*) n FROM customer_cases GROUP BY problem_class_id").map((r) => [r.pc, r.n]));
  const reqs = all<{ skill_id: string }>("SELECT skill_id FROM requisitions WHERE status <> 'closed'");
  const sme = all<{ skill_id: string }>("SELECT skill_id FROM sme_requests");
  const ext = all<{ skill_id: string }>("SELECT skill_id FROM external_engagements WHERE start_date >= ?", SINCE);
  const people = [...m.people.values()].filter((p) => p.level !== "C");
  return [...m.skills.values()].filter((s) => s.emerging).map((s) => {
    // demand: open roles needing it (weighted by how often customers raise that problem), requisitions, SME asks, consultancy
    const roleDemand = sum(opps.map((o) => o.roles.filter((r) => r.must.includes(s.id)).length * (1 + (o.problem_class_id ? casesByPc.get(o.problem_class_id) ?? 0 : 0) / 5)));
    const demand = Math.round(roleDemand + reqs.filter((r) => r.skill_id === s.id).length + sme.filter((r) => r.skill_id === s.id).length + ext.filter((r) => r.skill_id === s.id).length);
    const holders = people.filter((p) => capability(m, p.id, s.id).value >= 0.7).length;
    const nearly = people.filter((p) => { const v = skillReadiness(m, p.id, s.id).value; return v >= 0.5 && v < 0.7; }).length;
    return { skillId: s.id, skill: s.name, family: s.family, demand, holders, nearly, pressure: demand / (holders + 1) };
  }).filter((r) => r.demand > 0).sort((a, b) => b.pressure - a.pressure || b.demand - a.demand);
}

function future(m: Model): Built {
  const rows = futureSkills(m);
  const critical = rows.filter((r) => r.pressure >= 1);
  const thin = critical.filter((r) => r.holders <= 2);
  return {
    headline: critical.length
      ? `${critical.length} emerging skills are in more demand than we can supply: ${critical.slice(0, 4).map((r) => r.skill).join(", ")}. ${thin.length} of them rest on two people or fewer, so start building them now.`
      : "Emerging-skill demand is covered by current holders.",
    metrics: [
      { label: "Critical in 2 years", value: String(critical.length), tone: "risk" },
      { label: "Held by 2 people or fewer", value: String(thin.length), tone: "risk" },
      { label: "People one step away", value: String(sum(critical.map((r) => r.nearly))), tone: "prod" },
    ],
    table: {
      columns: [{ label: "Skill" }, { label: "Demand signals", numeric: true }, { label: "Holders today", numeric: true }, { label: "One step away", numeric: true }],
      rows: rows.slice(0, 8).map((r) => ({ cells: [r.skill, String(r.demand), String(r.holders), String(r.nearly)], focusId: r.skillId })),
    },
    actions: [
      { label: "Grow the thin skills from adjacent ones", detail: `${sum(critical.map((r) => r.nearly))} people already hold an adjacent skill: reskill them before the market prices these roles up.` },
      { label: "Fund AI capability development", detail: "Point the AI capability budget at the top of this list, not at generic training.", query: EXEC_QUESTIONS.invest },
    ],
    assumptions: [
      "Emerging skills are flagged in the skills taxonomy.",
      "Demand = open roles that need the skill (weighted up when customers raise the same problem often) + open or held requisitions + SME requests + consultancy since " + SINCE.slice(0, 7) + ".",
      "Holders score 70% or more; one step away means 50 to 70%, usually through an adjacent skill.",
    ],
    highlight: { nodeIds: critical.map((r) => r.skillId), edgeIds: [], danger: thin.map((r) => r.skillId) },
  };
}

// ---------------------------------------------------------------- dependency
function dependency(m: Model): Built {
  const risks = concentrationRisks();
  const detail = risks.map((r) => ({ r, w: whatIf(r.people.map((p) => p.id)) }));
  const top = detail[0];
  const ki = top ? all<{ id: string; title: string; reuse_count: number; author_id: string }>(
    `SELECT id, title, reuse_count, author_id FROM knowledge_items WHERE system_id = ? AND author_id IN (${top.r.people.map(() => "?").join(",")}) ORDER BY reuse_count DESC`,
    top.r.systemId, ...top.r.people.map((p) => p.id)) : [];
  const retiring = top ? top.r.people.filter((p) => p.retirementRisk) : [];
  return {
    headline: top
      ? `${top.r.name}: ${top.r.people.length} people hold ${pct(top.r.share)} of the expertise${retiring.length ? `, ${retiring.map((p) => p.name).join(" and ")} retires within 2 years` : ""}, and ${top.w.customers.length} customer accounts depend on it.`
      : "No critical system depends on three people or fewer.",
    metrics: [
      { label: "Systems at risk", value: String(risks.length), tone: "risk" },
      { label: "Highest concentration", value: top ? pct(top.r.share) : "0%", tone: "risk" },
      { label: "Customers exposed", value: String(new Set(detail.flatMap((d) => d.w.customers.map((c) => c.id))).size), tone: "rev" },
    ],
    table: {
      columns: [{ label: "System" }, { label: "Held by top 3", numeric: true }, { label: "People" }, { label: "Downstream systems", numeric: true }, { label: "Customers exposed", numeric: true }],
      rows: detail.map(({ r, w }) => ({
        cells: [r.name, pct(r.share), r.people.map((p) => `${p.name}${p.retirementRisk ? " (retiring)" : ""}`).join(", "), String(Math.max(0, w.systems.length - 1)), String(w.customers.length)],
        focusId: r.systemId,
      })),
    },
    actions: [
      ...(ki.length ? [{ label: "Turn their know-how into a curriculum", detail: `${ki.length} runbooks on ${top!.r.name} (reused ${sum(ki.map((k) => k.reuse_count))} times), led by "${ki[0].title}": pair two engineers with the authors this quarter.` }] : []),
      { label: "Run the what-if", detail: "Open Dependency Risk and remove these people to see the full blast radius." },
    ],
    assumptions: [
      "Concentration = share of a critical or high-criticality system's incident work handled by its top three resolvers (60% or more is flagged).",
      "Customers exposed = customers of projects that use the system or a system that depends on it.",
    ],
    highlight: {
      nodeIds: detail.flatMap(({ r, w }) => [r.systemId, ...r.people.map((p) => p.id), ...w.customers.map((c) => c.id)]),
      edgeIds: [], danger: detail.flatMap(({ r }) => [r.systemId, ...r.people.map((p) => p.id)]),
    },
  };
}

// ---------------------------------------------------------------- revenue
function revenue(m: Model): Built {
  const signals = revenueSignals(m);
  const spare = spareCapacity(m, 2);
  const total = sum(signals.map((s) => s.o.revenue_potential_amt));
  const expected = sum(signals.map((s) => s.o.revenue_potential_amt * s.o.win_probability));
  const top = signals[0];
  return {
    headline: top
      ? `${money(total)} of customer demand can be served with capability we already have. Start with ${top.o.title}: asked for ${top.demand} times and fully covered by people from ${top.teams.length} different teams.`
      : "No repeated customer demand is fully covered by internal capability yet.",
    metrics: [
      { label: "Revenue potential", value: money(total), tone: "rev" },
      { label: "Expected (x win probability)", value: money(expected), tone: "rev" },
      { label: "Spare capacity next quarter", value: `${spare.length} teams`, tone: "prod" },
    ],
    table: {
      columns: [{ label: "Offer" }, { label: "Times asked", numeric: true }, { label: "Internal coverage", numeric: true }, { label: "Teams combined", numeric: true }, { label: "Revenue potential", numeric: true }],
      rows: signals.map((s) => ({ cells: [s.o.title, String(s.demand), pct(s.coverage), String(s.teams.length), money(s.o.revenue_potential_amt)], focusId: s.o.id })),
    },
    actions: [
      ...(top ? [{ label: "Build the offer team", detail: `${staffed(top.o.id).team.map((c) => (visible(m, c.personId) ? c.name : "a colleague with a private profile")).join(", ")}.`, query: top.o.demo_query ?? top.o.title }] : []),
      ...spare.map((c) => ({ label: c.title, detail: c.detail, query: c.action.query })),
    ],
    assumptions: [
      "Times asked = customer cases on the same problem plus open opportunities for it.",
      "Covered = every role scores 70% or more with someone inside.",
      "Spare capacity = department and site teams averaging 30% or more availability.",
    ],
    highlight: { nodeIds: signals.flatMap((s) => [s.o.id, ...staffed(s.o.id).team.map((c) => c.personId)]), edgeIds: [], danger: [] },
  };
}

// ---------------------------------------------------------------- value
const quarterOf = (d: string) => `${d.slice(0, 4)} Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;

function value(_m: Model, today = new Date().toISOString().slice(0, 10)): Built {
  const s = impactSummary();
  const q = new Map<string, { n: number; c: number; p: number; r: number; v: number }>();
  for (const r of s.records) {
    const k = quarterOf(r.date);
    const e = q.get(k) ?? { n: 0, c: 0, p: 0, r: 0, v: 0 };
    e.n++; e.c += r.cost_avoided_amt; e.p += r.productivity_amt; e.r += r.recruitment_amt; e.v += r.revenue_amt;
    q.set(k, e);
  }
  const total = (e: { c: number; p: number; r: number; v: number }) => e.c + e.p + e.r + e.v;
  const quarters = [...q.keys()].sort();
  const current = quarterOf(today);
  const shown = q.has(current) ? current : quarters[quarters.length - 1];
  const prevIdx = quarters.indexOf(shown) - 1;
  const cur = q.get(shown)!;
  const prev = prevIdx >= 0 ? q.get(quarters[prevIdx]) : undefined;
  const ytd = sum([...q.entries()].filter(([k]) => k.startsWith(today.slice(0, 4))).map(([, e]) => total(e)));
  const change = prev && total(prev) ? total(cur) / total(prev) - 1 : 0;
  return {
    headline: `${shown}${shown === current ? " so far" : ""}: ${money(total(cur))} from ${cur.n} capability activation${cur.n === 1 ? "" : "s"}${prev ? ` (${change >= 0 ? "up" : "down"} ${pct(Math.abs(change))} on the quarter before)` : ""}. ${money(ytd)} this year, ${money(s.totals.total)} since ${quarters[0]}.`,
    metrics: [
      { label: shown === current ? `${shown} so far` : `Latest quarter (${shown})`, value: money(total(cur)), tone: "rev" },
      { label: `${today.slice(0, 4)} to date`, value: money(ytd), tone: "prod" },
      { label: "Since the start", value: money(s.totals.total), tone: "cost" },
    ],
    table: {
      columns: [{ label: "Quarter" }, { label: "Activations", numeric: true }, { label: "Cost avoided", numeric: true }, { label: "Productivity", numeric: true }, { label: "Recruitment", numeric: true }, { label: "Revenue", numeric: true }, { label: "Total", numeric: true }],
      rows: [...quarters].reverse().map((k) => {
        const e = q.get(k)!;
        return { cells: [k, String(e.n), money(e.c), money(e.p), money(e.r), money(e.v), money(total(e))] };
      }),
    },
    actions: [
      { label: "Open the value dashboard", detail: "Every figure traces to an impact record and its formula.", href: "/value" },
      { label: "Decide where it goes next", detail: "See where the evidence says the savings should be reinvested.", query: EXEC_QUESTIONS.invest },
    ],
    assumptions: [
      "Value comes only from recorded impact records: cost avoided, productivity (hours x loaded cost), recruitment avoided and attributed revenue.",
      `"This quarter" is the calendar quarter of today (${today}); when it has no records yet, the latest quarter with records is shown.`,
    ],
    highlight: { nodeIds: s.records.flatMap((r) => (r.opportunity_id ? [r.opportunity_id] : [])), edgeIds: [], danger: [] },
  };
}

// ---------------------------------------------------------------- invest
function invest(m: Model): Built {
  const s = impactSummary();
  const gapRows = capabilityGaps(m);
  const reskillable = gapRows.filter((r) => r.reskill);
  const fut = futureSkills(m).filter((r) => r.pressure >= 1);
  const rev = revenueSignals(m);
  const dup = duplicatedWork(m, 5);
  const spend = externalSpend(m);
  const experts = hiddenExperts(m);
  const smeCount = all<{ n: number }>("SELECT COUNT(*) n FROM sme_requests")[0].n;
  const evidence: Record<string, { why: string; strength: number }> = {
    "AI capability development": { why: `${fut.filter((r) => r.family === "Data & AI").length} AI skills are critical and thin: ${fut.filter((r) => r.family === "Data & AI").slice(0, 3).map((r) => r.skill).join(", ")}`, strength: sum(gapRows.filter((r) => r.skills.some((x) => m.skills.get(skillId(m, x))?.family === "Data & AI")).map((r) => r.worth)) },
    "Employee reskilling": { why: `${reskillable.length} capability gaps closable in ${Math.max(0, ...reskillable.map((r) => r.reskill!.weeks))} weeks or less, for ${money(sum(reskillable.map((r) => r.reskill!.costAmt)))} of training`, strength: sum(reskillable.map((r) => r.worth)) },
    "Innovation projects": { why: `${rev.length} offers fully covered from inside, ${money(sum(rev.map((r) => r.o.revenue_potential_amt)))} revenue potential`, strength: sum(rev.map((r) => r.o.revenue_potential_amt * r.o.win_probability)) },
    "Customer experience": { why: experts.length ? `${experts.length} proven ${experts.length === 1 ? "fixer" : "fixers"} found; routing cases to them recovers ${money(sum(experts.map((e) => e.valueAmt)))} of customer time a year` : "Route customer cases to proven resolvers", strength: sum(experts.map((e) => e.valueAmt)) },
    // social value: no dollars evidence, so it ranks after the financial cases
    "Digital inclusion": { why: `${smeCount} SME partner requests already have an internal expert, including remote regions talent`, strength: 0 },
    "Sustainability programmes": { why: `${money(sum(dup.map((d) => d.valueAmt)))} of duplicated work and ${money(sum(spend.map((x) => x.costAmt)))} of avoidable consultancy to stop repeating`, strength: sum(dup.map((d) => d.valueAmt)) },
  };
  const rows = s.initiatives.map((i) => ({ ...i, ...(evidence[i.name] ?? { why: i.outcome, strength: 0 }) })).sort((a, b) => b.strength - a.strength);
  const allocated = sum(s.initiatives.map((i) => i.allocation_amt));
  return {
    headline: `${money(s.totals.total)} has been unlocked. Fund ${rows[0].name} and ${rows[1].name} first, where the evidence of return is strongest: ${rows[0].why}; ${rows[1].why}.`,
    metrics: [
      { label: "Value unlocked", value: money(s.totals.total), tone: "rev" },
      { label: "Suggested allocation", value: money(allocated), tone: "prod" },
      { label: "Initiatives", value: String(rows.length), tone: "neutral" },
    ],
    table: {
      columns: [{ label: "Priority", numeric: true }, { label: "Initiative" }, { label: "Suggested", numeric: true }, { label: "Why now (evidence)" }],
      rows: rows.map((r, i) => ({ cells: [String(i + 1), r.name, money(r.allocation_amt), r.why] })),
    },
    actions: [
      { label: "See the capability gaps behind this", detail: "Each gap shows who can close it and how fast.", query: EXEC_QUESTIONS.gaps },
      { label: "Open the reinvestment dashboard", detail: "Value sources flowing into these initiatives.", href: "/value" },
    ],
    assumptions: [
      "Suggested allocations come from the reinvestment plan; priority is ranked by the value the evidence points to.",
      "Evidence strength: value of work held back by gaps, expected revenue of covered offers, customer hours recovered, duplicated effort, SME requests matched.",
    ],
    highlight: { nodeIds: [], edgeIds: [], danger: [] },
  };
}

const BUILDERS: Record<ExecIntent, (m: Model) => Built> = { gaps, external, future, dependency, revenue, value, invest };

export const BRIEF_SYSTEM =
  "You brief a general manager in 2 or 3 short sentences, plain words, no hype. Lead with the decision, then the one or two facts " +
  "that justify it, then the next step. Use only the facts given and the exact figures; never invent names, numbers or field names, " +
  "and never join two separate facts into a new claim. " +
  'Return ONLY JSON: {"brief": string}.';

async function brief(question: string, b: Built): Promise<{ text: string; provider: Provider }> {
  const facts = {
    question, decision: b.headline,
    metrics: Object.fromEntries(b.metrics.map((x) => [x.label, x.value])),
    top_rows: b.table.rows.slice(0, 4).map((r) => Object.fromEntries(b.table.columns.map((c, i) => [c.label, r.cells[i]]))),
    next_steps: b.actions.map((a) => `${a.label}: ${a.detail}`),
  };
  try {
    const r = await chatJson<{ brief: string }>("chat", BRIEF_SYSTEM, JSON.stringify(facts), { kind: "exec_brief", maxTokens: 300 });
    const text = r.data.brief?.replace(/\s*[–—]\s*/g, ", ");
    if (text && text.length > 30) return { text, provider: r.provider };
  } catch {
    /* template below */
  }
  return { text: `${b.headline} ${b.actions[0] ? `Next step: ${b.actions[0].label.toLowerCase()}.` : ""}`.trim(), provider: "template" };
}

export async function execAnswer(intent: ExecIntent, query: string, t0 = Date.now(), m: Model = data()): Promise<ExecAnswer> {
  const b = BUILDERS[intent](m);
  const question = EXEC_QUESTIONS[intent];
  const n = await brief(question, b);
  return { kind: "exec", query, intent, question, ...b, narrative: n.text, provider: n.provider, elapsedMs: Date.now() - t0 };
}

/** Synchronous answer without the AI brief (tests, warm-up). */
export function execFacts(intent: ExecIntent, m: Model = data()): Built {
  return BUILDERS[intent](m);
}
