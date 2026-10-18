// People Signals: six lenses on the collaboration and work graph. Recognition and risk, never performance scoring:
// only people who opted in to visibility are listed, and every item names the records behind it.
//   bridges     Collaboration bridges: people who are the only link between teams
//   bottlenecks Overloaded connectors: too much work and knowledge passes through one person
//   rising      Rising stars: contribution trajectory increasing
//   islands     Knowledge islands: expertise held inside one team while others need it
//   forgotten   Experts to re-engage: strong track record, activity has faded
//   ghosts      Off-chart contributors: significant work outside their formal projects and team
import Graph from "graphology";
import { inclusionItems } from "./inclusion.ts";
import betweenness from "graphology-metrics/centrality/betweenness.js";
import { all } from "../db.ts";
import { data, type Model } from "./data.ts";
import { capability } from "./match.ts";
import { dataVersion } from "../cacheVersion.ts";
import { openOpportunities } from "./portfolio.ts";
import type { SignalItem, SignalKind, SignalResult } from "../types.ts";

/** The data's "now": events run to the end of Sep 2026. */
export const NOW = "2026-10-01";
// months from Jan 2025 to the latest month with activity (at least Sep 2026), so new records count as they arrive
function monthRange(last: string): string[] {
  const out: string[] = [];
  for (let i = 0; ; i++) {
    const m = new Date(Date.UTC(2025, i, 1)).toISOString().slice(0, 7);
    out.push(m);
    if (m >= last) return out;
  }
}
const pct = (x: number) => `${Math.round(x * 100)}%`;
const plural = (n: number, s: string, p = `${s}s`) => `${n} ${n === 1 ? s : p}`;

interface Ctx {
  m: Model;
  visible: (id: string) => boolean;
  dept: (id: string) => string;
  deptName: (dep: string) => string;
  divName: Map<string, string>;
  collab: Map<string, Set<string>>;           // person -> co-assigned people
  btw: Record<string, number>;                // betweenness on the collaboration graph (normalised)
  btwRank: Map<string, number>;               // 1 = highest
  monthly: Map<string, number[]>;             // person -> events per month, Jan 2025 onwards
  months: string[];
  quarters: string[];
  lateMonths: number;                         // length of 2026 so far, in months, up to the latest record
}

let ctx: Ctx | null = null;
const cache = new Map<SignalKind, SignalResult>();
let version = -1;

export function resetSignals(): void {
  ctx = null;
  cache.clear();
}

function fresh() {
  if (version !== dataVersion()) { resetSignals(); version = dataVersion(); }
}

function context(): Ctx {
  fresh();
  if (ctx) return ctx;
  const m = data();
  const byProject = new Map<string, Set<string>>();
  for (const list of m.assignments.values()) for (const a of list) byProject.set(a.project_id, (byProject.get(a.project_id) ?? new Set()).add(a.person_id));
  const collab = new Map<string, Set<string>>();
  const g = new Graph({ type: "undirected" });
  for (const p of m.people.values()) if (p.level !== "C") g.addNode(p.id);
  for (const members of byProject.values()) {
    const ms = [...members].filter((id) => g.hasNode(id));
    for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) {
      collab.set(ms[i], (collab.get(ms[i]) ?? new Set()).add(ms[j]));
      collab.set(ms[j], (collab.get(ms[j]) ?? new Set()).add(ms[i]));
      if (!g.hasEdge(ms[i], ms[j])) g.addEdge(ms[i], ms[j]);
    }
  }
  const btw = betweenness(g, { normalized: true }) as Record<string, number>;
  const btwRank = new Map(Object.entries(btw).sort((a, b) => b[1] - a[1]).map(([id], i) => [id, i + 1]));
  const lastDay = all<{ d: string | null }>("SELECT MAX(date) d FROM events")[0]?.d ?? "2026-09-30";
  const last = lastDay.slice(0, 7);
  const lateMonths = Math.max(9, (Date.parse(lastDay) - Date.parse("2026-01-01")) / (30.44 * 86_400_000));
  const months = monthRange(last > "2026-09" ? last : "2026-09");
  const quarters = [...new Set(months.map((mo) => `${mo.slice(0, 4)} Q${Math.floor((Number(mo.slice(5, 7)) - 1) / 3) + 1}`))];
  const monthly = new Map<string, number[]>();
  for (const r of all<{ person_id: string; mo: string; n: number }>("SELECT person_id, substr(date, 1, 7) mo, COUNT(*) n FROM events GROUP BY person_id, mo")) {
    const arr = monthly.get(r.person_id) ?? new Array(months.length).fill(0);
    const i = months.indexOf(r.mo);
    if (i >= 0) arr[i] = r.n;
    monthly.set(r.person_id, arr);
  }
  ctx = {
    m, collab, btw, btwRank, monthly, months, quarters, lateMonths,
    visible: (id) => m.people.get(id)?.consent_visibility === 1,
    dept: (id) => m.people.get(id)?.department_id ?? "",
    deptName: (d) => m.departments.get(d) ?? "Leadership",
    divName: new Map(all<{ id: string; name: string }>("SELECT id, name FROM divisions").map((r) => [r.id, r.name])),
  };
  return ctx;
}

const quarterly = (c: Ctx, months: number[]) => c.quarters.map((_, q) => months.slice(q * 3, q * 3 + 3).reduce((a, b) => a + b, 0));
/** Monthly activity rate in 2025 (12 months) and in 2026 so far. */
function rates(c: Ctx, id: string) {
  const mo = c.monthly.get(id) ?? new Array(c.months.length).fill(0);
  const early = mo.slice(0, 12).reduce((a, b) => a + b, 0), late = mo.slice(12).reduce((a, b) => a + b, 0);
  return { early, late, earlyRate: early / 12, lateRate: late / c.lateMonths, quarters: quarterly(c, mo) };
}
const person = (c: Ctx, id: string) => c.m.people.get(id)!;
const who = (c: Ctx, id: string) => { const p = person(c, id); return `${p.title} · ${c.deptName(p.department_id ?? "")}, ${c.m.locations.get(p.location_id)}`; };
const eligible = (c: Ctx) => [...c.m.people.values()].filter((p) => p.level !== "C" && p.consent_visibility === 1);

// ---------------------------------------------------------------- bridges
function bridges(c: Ctx): SignalItem[] {
  // every department pair linked by co-assignment, and who carries each link
  const pairPeople = new Map<string, Set<string>>();
  const pairEdges = new Map<string, number>();
  for (const [a, others] of c.collab) for (const b of others) {
    if (a > b) continue;
    const da = c.dept(a), db = c.dept(b);
    if (!da || !db || da === db) continue;
    const k = da < db ? `${da}|${db}` : `${db}|${da}`;
    pairPeople.set(k, (pairPeople.get(k) ?? new Set()).add(a).add(b));
    pairEdges.set(k, (pairEdges.get(k) ?? 0) + 1);
  }
  // a person is the sole bridge of a pair when every link between the two teams runs through them
  const sole = new Map<string, string[]>();
  for (const [k, ppl] of pairPeople) {
    const [da, db] = k.split("|");
    for (const id of ppl) {
      const mine = c.dept(id);
      const otherSide = mine === da ? db : da;
      const theirs = [...(c.collab.get(id) ?? [])].filter((x) => c.dept(x) === otherSide).length;
      if (theirs === pairEdges.get(k)) sole.set(id, [...(sole.get(id) ?? []), otherSide]);
    }
  }
  return eligible(c)
    .map((p) => ({ p, only: sole.get(p.id) ?? [], b: c.btw[p.id] ?? 0 }))
    .filter((x) => x.only.length >= 2 || (c.btwRank.get(x.p.id) ?? 999) <= 5)
    .sort((a, b) => b.only.length - a.only.length || b.b - a.b)
    .slice(0, 8)
    .map(({ p, only, b }) => {
      const depts = new Set([...(c.collab.get(p.id) ?? [])].map((x) => c.dept(x)).filter((d) => d && d !== p.department_id));
      const divs = new Set([...(c.collab.get(p.id) ?? [])].map((x) => person(c, x).division_id).filter((d) => d !== p.division_id));
      return {
        id: p.id, title: p.name, subtitle: who(c, p.id),
        metric: plural(only.length, "team link"), metricLabel: "only connection",
        facts: [
          ...(only.length ? [`Only person linking ${c.deptName(p.department_id ?? "")} with ${only.length} other team${only.length === 1 ? "" : "s"}: ${only.slice(0, 4).map((d) => c.deptName(d)).join(", ")}${only.length > 4 ? ` and ${only.length - 4} more` : ""}`] : []),
          `Works with people in ${plural(depts.size, "other department")} across ${plural(divs.size, "other division")}`,
          `Collaboration path rank ${c.btwRank.get(p.id)} of ${c.btwRank.size} (how often colleagues are connected through them)`,
        ],
        people: [{ id: p.id, name: p.name }], focusId: p.id,
        nodeIds: [p.id, ...only, ...[...(c.collab.get(p.id) ?? [])].filter((x) => only.includes(c.dept(x)))],
        score: b,
      };
    });
}

// ---------------------------------------------------------------- bottlenecks
function bottlenecks(c: Ctx): SignalItem[] {
  const roles = all<{ system_id: string; person_id: string; role: string; name: string; criticality: string }>(
    "SELECT r.system_id, r.person_id, r.role, s.name, s.criticality FROM system_roles r JOIN systems s ON s.id = r.system_id");
  const credits = all<{ system_id: string; person_id: string }>(
    "SELECT i.system_id, r.person_id FROM incident_resolvers r JOIN incidents i ON i.id = r.incident_id WHERE i.opened >= '2025-10-01'");
  const perSystem = new Map<string, number>();
  for (const x of credits) perSystem.set(x.system_id, (perSystem.get(x.system_id) ?? 0) + 1);
  const sysName = new Map(all<{ id: string; name: string; criticality: string }>("SELECT id, name, criticality FROM systems").map((s) => [s.id, s]));
  const topDecile = Math.ceil(c.btwRank.size * 0.05);
  return eligible(c).map((p) => {
    const active = (c.m.assignments.get(p.id) ?? []).filter((a) => a.start_date <= NOW && a.end_date >= NOW);
    const alloc = active.reduce((s, a) => s + a.allocation_pct, 0);
    const mine = new Map<string, number>();
    for (const x of credits.filter((x) => x.person_id === p.id)) mine.set(x.system_id, (mine.get(x.system_id) ?? 0) + 1);
    const heavy = [...mine.entries()].filter(([s, n]) => perSystem.get(s)! >= 3 && n / perSystem.get(s)! >= 0.4 && ["critical", "high"].includes(sysName.get(s)!.criticality));
    const sysRoles = roles.filter((r) => r.person_id === p.id);
    const central = (c.btwRank.get(p.id) ?? 999) <= topDecile;
    const signals = [
      alloc > 100 && `${alloc}% allocated across ${plural(active.length, "active project")}`,
      active.length >= 3 && alloc <= 100 && `${plural(active.length, "active project")} at once`,
      heavy.length > 0 && `Handles ${heavy.map(([s, n]) => `${pct(n / perSystem.get(s)!)} of ${sysName.get(s)!.name} incidents`).join(", ")} (last 12 months)`,
      sysRoles.length >= 3 && `Owner, maintainer or SME for ${plural(sysRoles.length, "system")}`,
      central && `Top ${pct(topDecile / c.btwRank.size)} for collaboration paths running through them`,
    ].filter(Boolean) as string[];
    return { p, alloc, active, heavy, sysRoles, signals };
  })
    .filter((x) => x.signals.length >= 2)
    .sort((a, b) => b.signals.length - a.signals.length || b.alloc - a.alloc)
    .slice(0, 8)
    .map(({ p, alloc, active, heavy, sysRoles, signals }) => ({
      id: p.id, title: p.name, subtitle: who(c, p.id),
      metric: alloc > 100 ? `${alloc}%` : plural(signals.length, "flag"), metricLabel: alloc > 100 ? "allocated now" : "load flags",
      facts: [...signals, `Suggested: share the load, pair a deputy on ${heavy[0] ? sysName.get(heavy[0][0])!.name : active[0] ? c.m.projects.get(active[0].project_id)?.name : "their main system"}`],
      people: [{ id: p.id, name: p.name }], focusId: p.id,
      nodeIds: [p.id, ...active.map((a) => a.project_id), ...sysRoles.map((r) => r.system_id), ...heavy.map(([s]) => s)],
      score: signals.length,
    }));
}

// ---------------------------------------------------------------- rising stars
function rising(c: Ctx): SignalItem[] {
  const rec26 = new Map(all<{ to_id: string; n: number }>("SELECT to_id, COUNT(*) n FROM peer_recognition WHERE date >= '2026-01-01' GROUP BY to_id").map((r) => [r.to_id, r.n]));
  const ki26 = new Map(all<{ author_id: string; n: number }>("SELECT author_id, COUNT(*) n FROM knowledge_items WHERE created >= '2026-01-01' GROUP BY author_id").map((r) => [r.author_id, r.n]));
  return eligible(c)
    .filter((p) => !["GM", "SM"].includes(p.level))
    .map((p) => ({ p, r: rates(c, p.id) }))
    .filter(({ r }) => r.late >= 8 && r.lateRate >= Math.max(0.5, r.earlyRate) * 1.5)
    .sort((a, b) => (b.r.lateRate - b.r.earlyRate) - (a.r.lateRate - a.r.earlyRate))
    .slice(0, 8)
    .map(({ p, r }) => {
      const growth = r.earlyRate ? r.lateRate / r.earlyRate - 1 : 1;
      return {
        id: p.id, title: p.name, subtitle: who(c, p.id),
        // show the rates, not a percentage: small 2025 bases make percentages look absurd
        metric: `${r.earlyRate.toFixed(1)} to ${r.lateRate.toFixed(1)}`, metricLabel: "contributions a month, 2025 to 2026",
        facts: [
          `${r.lateRate.toFixed(1)} contributions a month in 2026, up from ${r.earlyRate.toFixed(1)} in 2025`,
          ...(rec26.get(p.id) ? [`${plural(rec26.get(p.id)!, "peer recognition")} this year`] : []),
          ...(ki26.get(p.id) ? [`${plural(ki26.get(p.id)!, "knowledge item")} published this year`] : []),
          `Since ${p.hire_year}; ${p.availability_pct}% available for stretch work`,
        ],
        spark: r.quarters, sparkLabels: c.quarters, people: [{ id: p.id, name: p.name }], focusId: p.id,
        nodeIds: [p.id, ...(c.m.assignments.get(p.id) ?? []).filter((a) => a.end_date >= "2026-01-01").map((a) => a.project_id)],
        score: growth,
      };
    });
}

// ---------------------------------------------------------------- knowledge islands
function islands(c: Ctx): SignalItem[] {
  const projSkill = all<{ skill_id: string; division_id: string; name: string }>(
    "SELECT ps.skill_id, p.division_id, p.name FROM project_skills ps JOIN projects p ON p.id = ps.project_id WHERE p.end_date >= '2025-01-01'");
  const ext = all<{ skill_id: string; cost_amt: number }>("SELECT skill_id, cost_amt FROM external_engagements WHERE start_date >= '2024-10-01'");
  const opps = openOpportunities();
  const people = [...c.m.people.values()].filter((p) => p.level !== "C");
  const out: SignalItem[] = [];
  for (const s of c.m.skills.values()) {
    const experts = people.filter((p) => capability(c.m, p.id, s.id).value >= 0.8 && capability(c.m, p.id, s.id).source !== "adjacent");
    if (experts.length < 2) continue;
    const depts = new Set(experts.map((p) => p.department_id));
    if (depts.size !== 1) continue;
    const dep = experts[0].department_id ?? "";
    const div = experts[0].division_id;
    // demand from outside the island: other divisions' projects, open roles, consultancy
    const outsideProjects = projSkill.filter((r) => r.skill_id === s.id && r.division_id !== div);
    const roles = opps.flatMap((o) => o.roles.filter((r) => r.must.includes(s.id)).map((r) => `${r.role} on ${o.title}`));
    const spend = ext.filter((e) => e.skill_id === s.id);
    const demand = outsideProjects.length + roles.length + spend.length;
    if (!demand) continue;
    // isolation: share of the experts' collaborators who sit in the same team
    const colls = experts.flatMap((p) => [...(c.collab.get(p.id) ?? [])]);
    const inside = colls.length ? colls.filter((x) => c.dept(x) === dep).length / colls.length : 1;
    out.push({
      id: s.id, title: s.name, subtitle: `Held only in ${c.deptName(dep)} (${c.divName.get(div)})`,
      metric: `${experts.length} experts`, metricLabel: "all in one team",
      facts: [
        `${pct(inside)} of these experts' collaborators are in their own team`,
        ...(outsideProjects.length ? [`${plural(outsideProjects.length, "project")} in other divisions used it: ${[...new Set(outsideProjects.map((r) => r.name))].slice(0, 2).join("; ")}`] : []),
        ...(roles.length ? [`Needed by ${roles.slice(0, 2).join("; ")}`] : []),
        ...(spend.length ? [`Bought from consultants ${plural(spend.length, "time")} since Oct 2024`] : []),
        `Suggested: open a cross-team clinic or rotation so the skill travels`,
      ],
      people: experts.filter((p) => p.consent_visibility === 1).map((p) => ({ id: p.id, name: p.name })),
      focusId: s.id, nodeIds: [s.id, dep, ...experts.map((p) => p.id)],
      score: demand * (0.5 + inside),
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 8);
}

// ---------------------------------------------------------------- forgotten experts
function forgotten(c: Ctx): SignalItem[] {
  const reuse = new Map(all<{ author_id: string; s: number; n: number }>("SELECT author_id, SUM(reuse_count) s, COUNT(*) n FROM knowledge_items GROUP BY author_id").map((r) => [r.author_id, r]));
  const inc25 = new Map(all<{ person_id: string; n: number }>(
    "SELECT r.person_id, COUNT(*) n FROM incident_resolvers r JOIN incidents i ON i.id = r.incident_id WHERE i.opened < '2026-01-01' GROUP BY r.person_id").map((r) => [r.person_id, r.n]));
  return eligible(c).map((p) => {
    const r = rates(c, p.id);
    const k = reuse.get(p.id);
    const masters = [...(c.m.declared.get(p.id)?.values() ?? [])].filter((d) => d.level === 5);
    const track = (k?.s ?? 0) + (inc25.get(p.id) ?? 0) * 2 + masters.length * 3 + r.early;
    const active = (c.m.assignments.get(p.id) ?? []).filter((a) => a.end_date >= NOW).length;
    return { p, r, k, masters, track, active };
  })
    .filter(({ r, track, active, k }) => track >= 20 && (k?.s ?? 0) >= 5 && r.early >= 8 && r.lateRate <= r.earlyRate * 0.4 && active === 0)
    .sort((a, b) => b.track - a.track)
    .slice(0, 8)
    .map(({ p, r, k, masters }) => ({
      id: p.id, title: p.name, subtitle: who(c, p.id),
      metric: `${r.earlyRate.toFixed(1)} to ${r.lateRate.toFixed(1)}`, metricLabel: "contributions a month, 2025 to 2026",
      facts: [
        ...(k ? [`Wrote ${plural(k.n, "knowledge item")} reused ${k.s} times`] : []),
        ...(masters.length ? [`Expert (5/5) in ${masters.map((d) => c.m.skills.get(d.skill_id)?.name).slice(0, 3).join(", ")}`] : []),
        `${r.early} contributions in 2025, ${r.late} so far in 2026; no active project`,
        `${p.availability_pct}% available. Suggested: invite back as reviewer or mentor on open work`,
      ],
      spark: r.quarters, sparkLabels: c.quarters, people: [{ id: p.id, name: p.name }], focusId: p.id,
      // their past work, so the graph shows what the organisation is no longer drawing on
      nodeIds: [p.id, ...all<{ id: string }>("SELECT id FROM knowledge_items WHERE author_id = ?", p.id).map((x) => x.id),
        ...(c.m.assignments.get(p.id) ?? []).map((a) => a.project_id),
        ...all<{ id: string }>("SELECT DISTINCT i.system_id id FROM incidents i JOIN incident_resolvers r ON r.incident_id = i.id WHERE r.person_id = ?", p.id).map((x) => x.id)],
      score: r.early,
    }));
}

// ---------------------------------------------------------------- off-chart contributors (organisational ghosts)
function ghosts(c: Ctx): SignalItem[] {
  const usesSystem = new Map<string, Set<string>>(); // project -> systems
  for (const r of all<{ project_id: string; system_id: string }>("SELECT project_id, system_id FROM project_systems")) usesSystem.set(r.project_id, (usesSystem.get(r.project_id) ?? new Set()).add(r.system_id));
  const roles = new Set(all<{ person_id: string; system_id: string }>("SELECT person_id, system_id FROM system_roles").map((r) => `${r.person_id}|${r.system_id}`));
  const inc = all<{ person_id: string; system_id: string; id: string; name: string }>(
    "SELECT r.person_id, i.system_id, i.id, s.name FROM incident_resolvers r JOIN incidents i ON i.id = r.incident_id JOIN systems s ON s.id = i.system_id");
  const recs = all<{ to_id: string; project_id: string | null }>("SELECT to_id, project_id FROM peer_recognition WHERE project_id IS NOT NULL");
  const kis = all<{ author_id: string; project_id: string | null; reuse_count: number; title: string }>("SELECT author_id, project_id, reuse_count, title FROM knowledge_items WHERE project_id IS NOT NULL");
  return eligible(c).map((p) => {
    const myProjects = new Set((c.m.assignments.get(p.id) ?? []).map((a) => a.project_id));
    const mySystems = new Set([...myProjects].flatMap((pr) => [...(usesSystem.get(pr) ?? [])]));
    const offInc = inc.filter((x) => x.person_id === p.id && !mySystems.has(x.system_id) && !roles.has(`${p.id}|${x.system_id}`));
    const offRec = recs.filter((x) => x.to_id === p.id && !myProjects.has(x.project_id!));
    const offKi = kis.filter((x) => x.author_id === p.id && !myProjects.has(x.project_id!));
    const onWork = myProjects.size + inc.filter((x) => x.person_id === p.id).length - offInc.length;
    const off = offInc.length + offRec.length + offKi.length * 2;
    return { p, offInc, offRec, offKi, off, share: off / Math.max(1, off + onWork) };
  })
    .filter((x) => x.off >= 6 && x.share >= 0.6)
    .sort((a, b) => b.off - a.off)
    .slice(0, 8)
    .map(({ p, offInc, offRec, offKi, share }) => {
      const otherProjects = [...new Set([...offRec.map((x) => x.project_id!), ...offKi.map((x) => x.project_id!)])];
      return {
        id: p.id, title: p.name, subtitle: who(c, p.id),
        metric: pct(share), metricLabel: "of their visible work is off-chart",
        facts: [
          `On ${plural((c.m.assignments.get(p.id) ?? []).length, "project roster")}`,
          ...(offInc.length ? [`Resolved ${plural(offInc.length, "incident")} on systems they have no role or project on: ${[...new Set(offInc.map((x) => x.name))].slice(0, 3).join(", ")}`] : []),
          ...(offKi.length ? [`Wrote ${plural(offKi.length, "knowledge item")} for other teams' projects, reused ${offKi.reduce((s, x) => s + x.reuse_count, 0)} times`] : []),
          ...(offRec.length ? [`${plural(offRec.length, "recognition")} from people on projects they are not listed on`] : []),
          `Suggested: put this work on the record (roster, SME role) so it counts`,
        ],
        people: [{ id: p.id, name: p.name }], focusId: p.id,
        nodeIds: [p.id, ...offInc.map((x) => x.system_id), ...offInc.map((x) => x.id), ...otherProjects],
        score: share,
      };
    });
}

const META: Record<SignalKind, Omit<SignalResult, "kind" | "items" | "generatedAt"> & { run: (c: Ctx) => SignalItem[] }> = {
  bridges: {
    title: "Collaboration bridges", question: "Who connects teams that would otherwise not be connected?", run: bridges,
    description: "People who are the only working link between two teams, or who sit on more collaboration paths than almost anyone. Losing them disconnects parts of the organisation.",
    method: ["Collaboration = shared project roster.", "Only link: every collaboration between two departments runs through this person.", "Path rank: betweenness centrality on the collaboration graph."],
  },
  bottlenecks: {
    title: "Overloaded connectors", question: "Who has too much work flowing through them?", run: bottlenecks,
    description: "People through whom too many projects, systems and incidents pass. Shown so the load can be shared, not to judge the person.",
    method: ["Flags: over 100% allocated now; 3+ active projects; 40%+ of a critical or high system's incidents in the last 12 months; 3+ system roles; top 5% of collaboration paths.", "Listed when two or more flags apply."],
  },
  rising: {
    title: "Rising stars", question: "Whose contribution is growing fastest?", run: rising,
    description: "Employees whose contribution trajectory is increasing: more delivery, fixes, knowledge and peer recognition in 2026 than in 2025.",
    method: ["Contribution events: projects joined and delivered, cases and incidents resolved, knowledge published, recognition received.", "Monthly rate in 2026 so far at least 1.5 times the 2025 rate, with 8+ events in 2026. Senior managers excluded."],
  },
  islands: {
    title: "Knowledge islands", question: "Where is expertise trapped inside one team?", run: islands,
    description: "Skills whose experts all sit in one team while other divisions need them: projects elsewhere, open roles, or money spent on consultants.",
    method: ["Expert = 80%+ capability, declared or evidence-backed (not adjacent).", "Island = 2+ experts, all in one department, with demand outside its division.", "Isolation = share of the experts' collaborators inside their own team."],
  },
  forgotten: {
    title: "Experts to re-engage", question: "Which proven experts have dropped out of the work?", run: forgotten,
    description: "People with a significant track record (reused knowledge, incidents fixed, deep skills) whose activity has faded and who are on no active project.",
    method: ["Track record = knowledge reuse + 2 x incidents fixed before 2026 + 3 x skills at 5/5 + 2025 contributions (20+ required).", "Faded = 2026 monthly activity at or below 40% of 2025, no active project."],
  },
  inclusion: {
    title: "Opportunity equity", question: "Does opportunity reach people outside headquarters?", run: (c) => inclusionItems(c.m, ghosts(c)),
    description: "Each location's share of the people proposed for open work against its share of the workforce. Under-represented locations come first, with remote regions, off-chart contributors and the closest near-miss for an open role made visible.",
    method: ["Headcount share excludes the executive team.", "Opportunity share counts people proposed for open opportunities, including reskilling picks.",
      "Ratio = opportunity share / headcount share; below 1.0x means the location gets less than its share.", "Near-miss: the consenting person there, not yet proposed, with the highest match below the fill threshold for an open role."],
  },
  ghosts: {
    title: "Off-chart contributors", question: "Who does important work outside their formal role?", run: ghosts,
    description: "People contributing significantly to work they are not formally assigned to: incidents on systems they have no role on, knowledge for other teams' projects, recognition from teams they are not listed in.",
    method: ["Off-chart work = incidents on systems outside their projects and roles + recognition from other projects + 2 x knowledge for other projects.", "Listed when off-chart work is 6+ and at least 60% of their visible work."],
  },
};

export const SIGNAL_KINDS = Object.keys(META) as SignalKind[];

export function signals(kind: SignalKind): SignalResult {
  fresh();
  if (!cache.has(kind)) {
    const { run, ...meta } = META[kind];
    cache.set(kind, { kind, ...meta, items: run(context()), generatedAt: new Date().toISOString() });
  }
  return cache.get(kind)!;
}
