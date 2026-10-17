// Opportunity Discovery (PRD 8.6): a scan of the whole capability graph that turns patterns into actionable cards.
// Every detector is a rule over records, so each card can name its evidence. No LLM involved.
import { all } from "../db.ts";
import { money, pct } from "../format.ts";
import { data, type Model } from "./data.ts";
import { dataVersion } from "../cacheVersion.ts";
import { capability, rankForRole, readiness } from "./match.ts";
import { reskillCandidates } from "./reskill.ts";
import { askFor, openOpportunities, staffed, type OpenOpportunity } from "./portfolio.ts";
import { concentrationRisks, whatIf } from "./whatif.ts";
import type { DiscoveryCard, DiscoveryResult, DiscoveryType, RoleRequirement } from "../types.ts";

/** Look-back window for spend and collaboration: two years before the data's "today". */
export const SINCE = "2024-10-01";
const ORDER: DiscoveryType[] = ["revenue", "external_spend", "capacity", "reskill", "duplicate", "hidden_expert", "collaboration", "risk", "sme"];
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round1k = (x: number) => Math.round(x / 1000) * 1000;
const blended = (m: Model) => Number(m.finance.blended_rate_amt ?? 100);
const visible = (m: Model, id: string) => m.people.get(id)?.consent_visibility === 1;
/** People who opted out of visibility are never named on a card (PRD 12). */
const nameOf = (m: Model, id: string) => (visible(m, id) ? m.people.get(id)!.name : "a colleague with a private profile");

function names(table: "problem_classes" | "divisions" | "organisations" | "locations" | "skills"): Map<string, string> {
  return new Map(all<{ id: string; name: string }>(`SELECT id, name FROM ${table}`).map((r) => [r.id, r.name]));
}

// ---------------------------------------------------------------- hidden expert (A8)
interface CaseRow { id: string; problem_class_id: string; resolver_id: string; mttr_hours: number; opened: string; org_id: string }

export function hiddenExperts(m: Model = data()): DiscoveryCard[] {
  const cases = all<CaseRow>("SELECT id, problem_class_id, resolver_id, mttr_hours, opened, org_id FROM customer_cases WHERE resolver_id IS NOT NULL");
  const dates = cases.map((c) => c.opened).sort();
  const years = Math.max(0.5, (Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / (365 * 86_400_000));
  const smes = new Set(all<{ person_id: string }>("SELECT person_id FROM system_roles WHERE role = 'sme'").map((r) => r.person_id));
  const seen = new Set(all<{ person_id: string }>("SELECT DISTINCT person_id FROM visibility_signals").map((r) => r.person_id));
  const pcName = names("problem_classes");
  const byPc = new Map<string, CaseRow[]>();
  for (const c of cases) byPc.set(c.problem_class_id, [...(byPc.get(c.problem_class_id) ?? []), c]);
  const cards: DiscoveryCard[] = [];
  for (const [pc, rows] of byPc) {
    const byPerson = new Map<string, CaseRow[]>();
    for (const c of rows) byPerson.set(c.resolver_id, [...(byPerson.get(c.resolver_id) ?? []), c]);
    for (const [pid, mine] of byPerson) {
      const peers = rows.filter((c) => c.resolver_id !== pid);
      if (mine.length < 3 || peers.length < 3 || !visible(m, pid) || smes.has(pid) || seen.has(pid)) continue;
      const myMttr = mean(mine.map((c) => c.mttr_hours));
      const peerMttr = mean(peers.map((c) => c.mttr_hours));
      if (myMttr > peerMttr * 0.35) continue;
      const p = m.people.get(pid)!;
      const perYear = rows.length / years;
      const value = round1k(perYear * (peerMttr - myMttr) * blended(m));
      cards.push({
        id: `hidden_expert:${pid}:${pc}`, type: "hidden_expert",
        title: `Hidden expert: ${p.name}`,
        detail: `Solved ${mine.length} "${pcName.get(pc)}" cases in ${myMttr.toFixed(1)} h on average against ${Math.round(peerMttr)} h for everyone else, but is not recognised as an expert.`,
        evidence: [
          `${p.title}, ${m.locations.get(p.location_id)}`,
          ...mine.map((c) => `${c.id}: resolved in ${c.mttr_hours} h (${c.opened.slice(0, 7)})`),
          `No SME role and no visibility signals on record`,
        ],
        metric: `${Math.round((1 - myMttr / peerMttr) * 100)}% faster`, valueAmt: value,
        valueLabel: `customer hours recovered a year if these cases route to ${p.name.split(" ")[0]} (${Math.round(perYear)} cases x ${Math.round(peerMttr - myMttr)} h x $${blended(m)})`,
        people: [{ id: pid, name: p.name }], nodeIds: [pid, pc],
        action: { label: `Dive into ${p.name.split(" ")[0]}'s work`, focusId: pid },
      });
    }
  }
  return cards.sort((a, b) => b.valueAmt - a.valueAmt);
}

// ---------------------------------------------------------------- spare capacity (A9)
export function spareCapacity(m: Model = data(), limit = 3): DiscoveryCard[] {
  const groups = new Map<string, string[]>();
  for (const p of m.people.values()) {
    if (p.level === "C" || !p.department_id) continue;
    const k = `${p.department_id}|${p.location_id}`;
    groups.set(k, [...(groups.get(k) ?? []), p.id]);
  }
  const out: (DiscoveryCard & { rank: number })[] = [];
  for (const [k, ids] of groups) {
    const avail = mean(ids.map((id) => m.people.get(id)!.availability_pct));
    if (ids.length < 3 || avail < 30) continue;
    // the capacity is free next quarter, so the soonest opportunity the group can staff wins
    let best: { o: OpenOpportunity; role: RoleRequirement; fit: string[] } | null = null;
    for (const o of openOpportunities()) {
      for (const role of o.roles) {
        const fit = ids.filter((id) => readiness(m, id, role.must) >= 0.7);
        const better = !best || o.deadline < best.o.deadline || (o.deadline === best.o.deadline && fit.length > best.fit.length);
        if (fit.length >= 2 && better) best = { o, role, fit };
      }
    }
    if (!best) continue;
    const [dep, loc] = k.split("|");
    const fte = ids.reduce((a, id) => a + m.people.get(id)!.availability_pct, 0) / 100;
    const hours = Math.round(fte * 63 * 8);
    out.push({
      id: `capacity:${k}`, type: "capacity", rank: fte * best.fit.length,
      title: `Spare capacity: ${m.departments.get(dep)}, ${m.locations.get(loc)}`,
      detail: `${ids.length} people with about ${fte.toFixed(1)} FTE free next quarter (${hours.toLocaleString()} hours). ${best.fit.length} of them already fit "${best.role.role}" on ${best.o.title}.`,
      evidence: [
        `Average availability ${Math.round(avail)}%`,
        ...best.fit.slice(0, 4).map((id) => `${nameOf(m, id)}, ${m.people.get(id)!.title}: ${m.people.get(id)!.availability_pct}% available`),
        `Role needs ${best.role.must.map((s) => m.skills.get(s)?.name).join(", ")}`,
      ],
      metric: `${Math.round(avail)}% free`,
      valueAmt: Math.max(0, best.o.external_quote_amt - best.o.internal_cost_amt),
      valueLabel: `external cost avoided if ${best.o.title} is staffed from this capacity`,
      people: best.fit.filter((id) => visible(m, id)).map((id) => ({ id, name: m.people.get(id)!.name })),
      nodeIds: [dep, best.o.id, ...ids],
      action: { label: "Staff it from inside", query: askFor(best.o) },
    });
  }
  return out.sort((a, b) => b.rank - a.rank).slice(0, limit).map(({ rank: _r, ...c }) => c);
}

// ---------------------------------------------------------------- collaboration gap (A10)
export function collaborationGaps(m: Model = data(), limit = 2): DiscoveryCard[] {
  const divName = names("divisions");
  const deptDiv = new Map(all<{ id: string; division_id: string }>("SELECT id, division_id FROM departments").map((d) => [d.id, d.division_id]));
  const recent = new Set(all<{ id: string }>("SELECT id FROM projects WHERE end_date >= ?", SINCE).map((r) => r.id));
  const proj = new Map<string, { depts: Set<string>; divs: Set<string> }>();
  for (const list of m.assignments.values()) {
    for (const a of list) {
      if (!recent.has(a.project_id)) continue;
      const p = m.people.get(a.person_id)!;
      const e = proj.get(a.project_id) ?? { depts: new Set(), divs: new Set() };
      if (p.department_id) e.depts.add(p.department_id);
      e.divs.add(p.division_id);
      proj.set(a.project_id, e);
    }
  }
  const shared = (dept: string, div: string) => [...proj.values()].filter((e) => e.depts.has(dept) && e.divs.has(div)).length;
  const found = new Map<string, { dept: string; div: string; opps: OpenOpportunity[]; pairs: string[]; people: Set<string> }>();
  for (const o of openOpportunities()) {
    const team = staffed(o.id).team;
    const seenHere = new Set<string>();
    for (const a of team) {
      for (const b of team) {
        const pa = m.people.get(a.personId)!, pb = m.people.get(b.personId)!;
        if (!pa.department_id || pa.division_id === pb.division_id) continue;
        const key = `${pa.department_id}|${pb.division_id}`;
        if (seenHere.has(key) || deptDiv.get(pa.department_id) === pb.division_id || shared(pa.department_id, pb.division_id) > 0) continue;
        seenHere.add(key);
        const f = found.get(key) ?? { dept: pa.department_id, div: pb.division_id, opps: [], pairs: [], people: new Set<string>() };
        f.opps.push(o);
        f.pairs.push(`${o.title}: ${nameOf(m, pa.id)} (${a.role}) with ${nameOf(m, pb.id)} (${b.role})`);
        f.people.add(pa.id).add(pb.id);
        found.set(key, f);
      }
    }
  }
  // strongest gap: needed together by the most opportunities, then by the value those opportunities carry
  const worth = (o: OpenOpportunity) => o.revenue_potential_amt * o.win_probability + Math.max(0, o.external_quote_amt - o.internal_cost_amt);
  return [...found.values()]
    .sort((a, b) => b.opps.length - a.opps.length || b.opps.reduce((s, o) => s + worth(o), 0) - a.opps.reduce((s, o) => s + worth(o), 0))
    .slice(0, limit)
    .map((f) => ({
      id: `collaboration:${f.dept}:${f.div}`, type: "collaboration" as const,
      title: `Collaboration gap: ${m.departments.get(f.dept)} and ${divName.get(f.div)}`,
      detail: `${f.opps.length} open ${f.opps.length === 1 ? "opportunity needs" : "opportunities need"} both teams together, yet they have not shared a single project since ${SINCE.slice(0, 7)}.`,
      evidence: f.pairs.slice(0, 4),
      metric: "0 shared projects", valueAmt: 0, valueLabel: "complementary capability, not yet connected",
      people: [...f.people].filter((id) => visible(m, id)).map((id) => ({ id, name: m.people.get(id)!.name })),
      nodeIds: [f.dept, f.div, ...f.people, ...f.opps.map((o) => o.id)],
      action: { label: "Form the joint team", query: askFor(f.opps[0]) },
    }));
}

// ---------------------------------------------------------------- revenue signal (A11)
export interface RevenueSignal { o: OpenOpportunity; demand: number; teams: string[]; coverage: number }

export function revenueSignals(m: Model = data()): RevenueSignal[] {
  const casesByPc = new Map(all<{ pc: string; n: number }>("SELECT problem_class_id pc, COUNT(*) n FROM customer_cases GROUP BY problem_class_id").map((r) => [r.pc, r.n]));
  const opps = openOpportunities();
  const best = new Map<string, RevenueSignal>();
  for (const o of opps) {
    if (!o.org_id || o.revenue_potential_amt <= 0 || !o.problem_class_id) continue;
    const t = staffed(o.id);
    const demand = (casesByPc.get(o.problem_class_id) ?? 0) + opps.filter((x) => x.problem_class_id === o.problem_class_id).length;
    const teams = [...new Set(t.team.map((c) => c.department))];
    if (demand < 3 || t.coverage < 0.99) continue;
    const cur = best.get(o.problem_class_id);
    if (!cur || o.revenue_potential_amt > cur.o.revenue_potential_amt) best.set(o.problem_class_id, { o, demand, teams, coverage: t.coverage });
  }
  return [...best.values()].sort((a, b) => b.o.revenue_potential_amt * b.o.win_probability - a.o.revenue_potential_amt * a.o.win_probability);
}

function revenueCards(m: Model): DiscoveryCard[] {
  return revenueSignals(m).map(({ o, demand, teams }) => {
    const team = staffed(o.id).team;
    const skills = [...new Set(o.roles.flatMap((r) => r.must).map((s) => m.skills.get(s)?.name))];
    return {
      id: `revenue:${o.id}`, type: "revenue" as const,
      title: `Revenue: ${o.title}`,
      detail: `Customers asked for this ${demand} times. ${skills.slice(0, 4).join(", ")} already exist in ${teams.length} different teams and together cover 100% of the offer.`,
      evidence: team.map((c) => `${c.role}: ${nameOf(m, c.personId)}, ${c.department} (${pct(c.score)} match)`),
      metric: money(o.revenue_potential_amt), valueAmt: o.revenue_potential_amt,
      valueLabel: `revenue potential (win probability ${pct(o.win_probability)})`,
      people: team.filter((c) => visible(m, c.personId)).map((c) => ({ id: c.personId, name: c.name })),
      nodeIds: [o.id, ...team.map((c) => c.personId), ...(o.org_id ? [o.org_id] : [])],
      action: { label: "Build the offer team", query: askFor(o) },
    };
  });
}

// ---------------------------------------------------------------- paying externals for internal skills (A4)
export interface SpendFinding {
  id: string; skillId: string; skill: string; vendor: string; vendorId: string; costAmt: number; days: number; start: string; project: string;
  holders: { id: string; name: string; allocation: number }[];
}

export function externalSpend(m: Model = data()): SpendFinding[] {
  const rows = all<{ id: string; skill_id: string; vendor_org_id: string; cost_amt: number; days: number; start_date: string; project_id: string | null }>(
    "SELECT id, skill_id, vendor_org_id, cost_amt, days, start_date, project_id FROM external_engagements WHERE start_date >= ? ORDER BY cost_amt DESC", SINCE);
  const org = names("organisations");
  const out: SpendFinding[] = [];
  for (const e of rows) {
    const holders = [];
    for (const p of m.people.values()) {
      if (p.level === "C" || capability(m, p.id, e.skill_id).value < 0.8) continue;
      const allocation = (m.assignments.get(p.id) ?? []).filter((a) => a.start_date <= e.start_date && e.start_date <= a.end_date)
        .reduce((s, a) => s + a.allocation_pct, 0);
      if (allocation < 50) holders.push({ id: p.id, name: p.name, allocation });
    }
    if (holders.length < 2) continue;
    out.push({ id: e.id, skillId: e.skill_id, skill: m.skills.get(e.skill_id)?.name ?? e.skill_id, vendor: org.get(e.vendor_org_id) ?? e.vendor_org_id,
      vendorId: e.vendor_org_id, costAmt: e.cost_amt, days: e.days, start: e.start_date,
      project: e.project_id ? m.projects.get(e.project_id)?.name ?? e.project_id : "", holders: holders.sort((a, b) => a.allocation - b.allocation) });
  }
  return out;
}

function spendCards(m: Model, limit = 3): DiscoveryCard[] {
  return externalSpend(m).slice(0, limit).map((f) => ({
    id: `external_spend:${f.id}`, type: "external_spend" as const,
    title: `Paid externally for ${f.skill} we already had`,
    detail: `${f.vendor} was paid ${money(f.costAmt)} for ${f.days} days of ${f.skill} (${f.start.slice(0, 7)}) while ${f.holders.length} internal ${f.skill} experts were less than 50% allocated.`,
    evidence: [f.project && `Project: ${f.project}`, ...f.holders.slice(0, 4).map((h) => `${nameOf(m, h.id)}: ${h.allocation}% allocated at the time`)].filter(Boolean) as string[],
    metric: money(f.costAmt), valueAmt: f.costAmt, valueLabel: "avoidable external spend next time",
    people: f.holders.filter((h) => visible(m, h.id)).slice(0, 4).map((h) => ({ id: h.id, name: h.name })),
    nodeIds: [f.skillId, f.vendorId, ...f.holders.map((h) => h.id)],
    action: { label: "Ask SkillBridge before buying", query: `Who can deliver ${f.skill} work from inside?` },
  }));
}

// ---------------------------------------------------------------- duplicated work (A12)
export function duplicatedWork(m: Model = data(), limit = 2): DiscoveryCard[] {
  const projects = all<{ id: string; name: string; division_id: string; problem_class_id: string | null; start_date: string; status: string; external_spend_amt: number }>(
    "SELECT id, name, division_id, problem_class_id, start_date, status, external_spend_amt FROM projects WHERE problem_class_id IS NOT NULL AND status <> 'planned'");
  const members = new Map<string, Set<string>>();
  const manDays = new Map<string, number>();
  for (const list of m.assignments.values()) for (const a of list) {
    members.set(a.project_id, (members.get(a.project_id) ?? new Set()).add(a.person_id));
    manDays.set(a.project_id, (manDays.get(a.project_id) ?? 0) + a.man_days);
  }
  const ki = all<{ id: string; title: string; kind: string; project_id: string | null }>("SELECT id, title, kind, project_id FROM knowledge_items WHERE project_id IS NOT NULL");
  const divName = names("divisions");
  const out: (DiscoveryCard & { rank: number })[] = [];
  for (let i = 0; i < projects.length; i++) {
    for (let j = i + 1; j < projects.length; j++) {
      const a = projects[i], b = projects[j];
      if (a.problem_class_id !== b.problem_class_id || a.division_id === b.division_id) continue;
      if (Math.abs(Date.parse(a.start_date) - Date.parse(b.start_date)) > 365 * 86_400_000) continue;
      const sa = m.projectSkills.get(a.id) ?? new Set(), sb = m.projectSkills.get(b.id) ?? new Set();
      const common = [...sa].filter((s) => sb.has(s));
      const ma = members.get(a.id) ?? new Set(), mb = members.get(b.id) ?? new Set();
      if (common.length < 2 || [...ma].some((p) => mb.has(p))) continue;
      // the same kind of artefact built on both sides is the strongest sign of duplicated work
      const kiA = ki.filter((k) => k.project_id === a.id), kiB = ki.filter((k) => k.project_id === b.id);
      const twins = kiA.flatMap((x) => kiB.filter((y) => y.kind === x.kind && (x.kind === "model" || x.kind === "code repo")).map((y) => [x, y] as const));
      const effort = Math.min(manDays.get(a.id) ?? 0, manDays.get(b.id) ?? 0);
      const value = round1k(effort * 8 * blended(m));
      const [first, second] = a.start_date <= b.start_date ? [a, b] : [b, a];
      out.push({
        id: `duplicate:${a.id}:${b.id}`, type: "duplicate", rank: (twins.length ? 1e9 : 0) + value,
        title: `Duplicated work: ${common.map((s) => m.skills.get(s)?.name).slice(0, 2).join(" + ")} built twice`,
        detail: `"${first.name}" (${divName.get(first.division_id)}) and "${second.name}" (${divName.get(second.division_id)}) solved the same problem within a year with no one in common.`,
        evidence: [
          ...twins.slice(0, 2).map(([x, y]) => `${x.id} "${x.title}" and ${y.id} "${y.title}"`),
          `${effort} person-days on the smaller of the two`,
          ...(second.external_spend_amt ? [`${second.name} also paid ${money(second.external_spend_amt)} to external consultants`] : []),
        ],
        metric: money(value), valueAmt: value, valueLabel: `duplicated effort (${effort} person-days x 8 h x $${blended(m)})`,
        people: [...ma, ...mb].filter((id) => visible(m, id)).slice(0, 6).map((id) => ({ id, name: m.people.get(id)!.name })),
        nodeIds: [a.id, b.id, ...twins.flat().map((k) => k.id), ...ma, ...mb],
        action: { label: "See both projects", focusId: second.id },
      });
    }
  }
  return out.sort((a, b) => b.rank - a.rank).slice(0, limit).map(({ rank: _r, ...c }) => c);
}

// ---------------------------------------------------------------- reskill instead of hiring (A7)
function reskillCards(m: Model, limit = 3): DiscoveryCard[] {
  const reqs = all<{ id: string; title: string; skill_id: string; est_cost_amt: number }>("SELECT id, title, skill_id, est_cost_amt FROM requisitions WHERE status = 'open' ORDER BY id");
  const cards: DiscoveryCard[] = [];
  for (const r of reqs) {
    // use the richest open role that needs this skill, so readiness reflects the real job
    const roles = openOpportunities().flatMap((o) => o.roles.map((role) => ({ o, role }))).filter((x) => x.role.must.includes(r.skill_id));
    const pick = roles.sort((a, b) => b.role.must.length + b.role.nice.length - (a.role.must.length + a.role.nice.length))[0];
    const role: RoleRequirement = pick?.role ?? { role: r.title, must: [r.skill_id], nice: [] };
    const top = rankForRole(role, new Set(), m).find((c) => visible(m, c.personId));
    if (top && top.score >= Number(m.finance.role_fill_threshold ?? 0.7) && top.availabilityPct >= 30) {
      cards.push({
        id: `reskill:${r.id}`, type: "reskill", title: `Hire avoidable: ${r.title}`,
        detail: `${top.name} (${top.title}, ${top.department}) already matches ${pct(top.score)} and is ${top.availabilityPct}% available. Move internally instead of opening ${r.id}.`,
        evidence: top.capabilities.map((c) => `${c.skill}: ${pct(c.value)} (${c.source})`),
        metric: money(r.est_cost_amt), valueAmt: r.est_cost_amt, valueLabel: `recruitment cost of ${r.id} avoided`,
        people: [{ id: top.personId, name: top.name }], nodeIds: [top.personId, r.skill_id],
        action: { label: `See ${top.name.split(" ")[0]}`, focusId: top.personId },
      });
      continue;
    }
    const plan = reskillCandidates(m, role, new Set(), 3).find((p) => visible(m, p.personId) && p.path.length);
    if (!plan) continue;
    cards.push({
      id: `reskill:${r.id}`, type: "reskill", title: `Reskill instead of hiring: ${r.title}`,
      detail: `${plan.name} is ${pct(plan.readiness)} ready. ${plan.path.length} step${plan.path.length === 1 ? "" : "s"} over ${plan.weeks} weeks (${plan.costAmt ? money(plan.costAmt) : "no course fees"}) instead of a ${money(r.est_cost_amt)} hire${plan.contrast ? ` or a ${plan.contrast.weeks}-week certificate` : ""}.`,
      evidence: plan.path.map((s) => `${s.name}: ${s.weeks} weeks, $${s.costAmt.toLocaleString()}`),
      metric: `${plan.weeks} weeks`, valueAmt: Math.max(0, r.est_cost_amt - plan.costAmt),
      valueLabel: `recruitment cost of ${r.id} avoided, minus training`,
      people: [{ id: plan.personId, name: plan.name }], nodeIds: [plan.personId, r.skill_id],
      action: { label: `See ${plan.name.split(" ")[0]}'s path`, focusId: plan.personId },
    });
  }
  return cards.sort((a, b) => b.valueAmt - a.valueAmt).slice(0, limit);
}

// ---------------------------------------------------------------- dependency risk (A3)
function riskCards(m: Model): DiscoveryCard[] {
  return concentrationRisks().slice(0, 2).map((r) => {
    const w = whatIf(r.people.map((p) => p.id));
    const retiring = r.people.filter((p) => p.retirementRisk).length;
    return {
      id: `risk:${r.systemId}`, type: "risk" as const,
      title: `Key-person risk: ${r.name}`,
      detail: `${pct(r.share)} of ${r.name} incident work sits with ${r.people.length} people${retiring ? `; ${retiring} retires within 2 years` : ""}. If they leave, ${w.customers.length} customer accounts feel it.`,
      evidence: [...r.people.map((p) => `${p.name}: joined ${p.hireYear}${p.retirementRisk ? ", retirement within 2 years" : ""}`),
        ...w.systems.slice(1, 3).map((s) => `Downstream: ${s.name}`)],
      metric: pct(r.share), valueAmt: 0, valueLabel: "concentration risk",
      people: r.people.map((p) => ({ id: p.id, name: p.name })),
      nodeIds: [r.systemId, ...r.people.map((p) => p.id), ...w.customers.map((c) => c.id)],
      action: { label: "Open the what-if", focusId: r.systemId },
    };
  });
}

// ---------------------------------------------------------------- SME support (A18)
function smeCard(m: Model): DiscoveryCard[] {
  const reqs = all<{ id: string; org_id: string; skill_id: string; description: string; org: string; loc: string | null; east: number | null }>(
    `SELECT r.id, r.org_id, r.skill_id, r.description, o.name org, l.name loc, l.remote_region east FROM sme_requests r
     JOIN organisations o ON o.id = r.org_id LEFT JOIN locations l ON l.id = o.location_id ORDER BY r.id`);
  const east = new Set(all<{ id: string }>("SELECT id FROM locations WHERE remote_region = 1").map((r) => r.id));
  const matches = reqs.map((r) => {
    // best visible holder; prefer someone on the same side of the South China Sea
    const best = [...m.people.values()]
      .filter((p) => p.level !== "C" && p.consent_visibility === 1)
      .map((p) => ({ p, v: capability(m, p.id, r.skill_id).value, near: east.has(p.location_id) === !!r.east }))
      .filter((x) => x.v >= 0.6)
      .sort((a, b) => b.v - a.v || Number(b.near) - Number(a.near) || b.p.availability_pct - a.p.availability_pct)[0];
    return { r, best };
  }).filter((x) => x.best);
  if (!matches.length) return [];
  const regional = matches.filter((x) => x.r.east && east.has(x.best!.p.location_id));
  return [{
    id: "sme:requests", type: "sme",
    title: `SME support: ${matches.length} partner requests can be served from inside`,
    detail: `Small businesses asked for help; each request already has an internal expert${regional.length ? `, including ${regional.map((x) => x.best!.p.name).join(", ")} in remote regions` : ""}.`,
    evidence: matches.map(({ r, best }) => `${r.org} (${r.loc}): ${r.description} -> ${best!.p.name}, ${m.locations.get(best!.p.location_id)}`),
    metric: `${matches.length} matched`, valueAmt: 0, valueLabel: "social value: capability shared beyond the company",
    people: matches.map(({ best }) => ({ id: best!.p.id, name: best!.p.name })),
    nodeIds: [...matches.map((x) => x.r.org_id), ...matches.map((x) => x.best!.p.id)],
    action: regional.length
      ? { label: `See ${regional[0].best!.p.name.split(" ")[0]}'s profile`, focusId: regional[0].best!.p.id }
      : { label: `See ${matches[0].best!.p.name.split(" ")[0]}'s profile`, focusId: matches[0].best!.p.id },
  }];
}

// ---------------------------------------------------------------- scan
let last: DiscoveryResult | null = null;
let lastVersion = -1;

export function resetDiscovery(): void {
  last = null;
}

export function discover(m: Model = data()): DiscoveryResult {
  if (last && lastVersion === dataVersion()) return last;
  lastVersion = dataVersion();
  const cards = [
    ...revenueCards(m), ...spendCards(m), ...spareCapacity(m), ...reskillCards(m), ...duplicatedWork(m),
    ...hiddenExperts(m).slice(0, 3), ...collaborationGaps(m), ...riskCards(m), ...smeCard(m),
  ].sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));
  last = { generatedAt: new Date().toISOString(), cards, totalValueAmt: cards.reduce((a, c) => a + c.valueAmt, 0) };
  return last;
}
