// Redeploy, don't retrench: when AI takes over contact-centre work, find each exposed person's nearest internal
// destination (open opportunity roles, including the AI rollout's own, and open requisitions) and the smallest
// reskilling path, with severance and hiring avoided. Deterministic; approval records value but never moves anyone.
import { all, get } from "../db.ts";
import { dataVersion } from "../cacheVersion.ts";
import { money } from "../format.ts";
import type { Model } from "./data.ts";
import type { ExecBuilt } from "./exec.ts";
import type { LearningStep, RoleRequirement } from "../types.ts";
import { exposureRule, exposureText, type ExposureRule } from "./assumptions.ts";
import { openOpportunities } from "./portfolio.ts";
import { scorePerson } from "./match.ts";
import { hireCost, learningPlan } from "./reskill.ts";
import { activate } from "./impact.ts";
import { recordSocial } from "./socialStore.ts";
import { ensureAgentTables, finishRun, propose, startRun } from "../agents/store.ts";

export interface Destination { key: string; kind: "opportunity" | "requisition"; refId: string; title: string; role: RoleRequirement }

export interface RedeployRow {
  personId: string; name: string; visible: boolean; title: string; location: string;
  destination: Destination | null;
  mode: "ready" | "reskill" | "none";
  score: number;          // match score for the destination role today
  readiness: number;
  weeks: number;
  costAmt: number;        // reskilling cost
  path: LearningStep[];
  severanceAvoided: number;
  hiringAvoided: number;
  hireBasis: string;
}

export interface RedeployPlan {
  opportunityId: string;
  rows: RedeployRow[];
  totals: { exposed: number; preserved: number; readyNow: number; reskilled: number; severanceAvoided: number; hiringAvoided: number; reskillCost: number; net: number };
  assumptions: string[];
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const PRIVATE = "1 colleague (private)";

/** People whose work the AI rollout takes over (EXPOSURE rule). */
export function exposedPeople(m: Model, e: ExposureRule = exposureRule(m)): string[] {
  const title = new RegExp(e.titlePattern, "i");
  return [...m.people.values()]
    .filter((p) => !e.excludeLevels.includes(p.level) && p.department_id !== null && e.departments.includes(p.department_id) && title.test(p.title))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((p) => p.id);
}

export function destinations(m: Model): Destination[] {
  const out: Destination[] = [];
  for (const o of openOpportunities()) {
    for (const r of o.roles) out.push({ key: `${o.id}:${r.role}`, kind: "opportunity", refId: o.id, title: o.title, role: r });
  }
  for (const q of all<{ id: string; title: string; skill_id: string }>("SELECT id, title, skill_id FROM requisitions WHERE status = 'open' ORDER BY id")) {
    if (!m.skills.has(q.skill_id)) continue;
    out.push({ key: q.id, kind: "requisition", refId: q.id, title: `Open requisition ${q.id}`, role: { role: q.title, must: [q.skill_id], nice: [] } });
  }
  return out;
}

export function severanceAvoided(m: Model, personId: string, e: ExposureRule = exposureRule(m), year = new Date().getUTCFullYear()): number {
  const p = m.people.get(personId)!;
  const years = Math.max(0, year - (p.hire_year || year));
  const weeks = Math.min(e.severanceMaxWeeks, Math.max(e.severanceMinWeeks, years * e.severanceWeeksPerYear));
  return Math.round(weeks * p.loaded_rate_amt * e.hoursPerWeek);
}

let cached: { key: string; plan: RedeployPlan } | null = null;

export function redeployPlan(m: Model): RedeployPlan {
  const e = exposureRule(m);
  const exposed = exposedPeople(m, e);
  const dest = destinations(m);
  const key = `${dataVersion()}|${JSON.stringify(e)}|${exposed.join(",")}|${dest.map((d) => d.key).join(",")}`;
  if (cached?.key === key) return cached.plan;
  const threshold = Number(m.finance.role_fill_threshold ?? 0.7);
  type Pair = { pid: string; d: Destination; ready: boolean; score: number; readiness: number; weeks: number; costAmt: number; path: LearningStep[] };
  const pairs: Pair[] = [];
  for (const pid of exposed) {
    for (const d of dest) {
      const score = scorePerson(pid, d.role, m).score;
      if (score >= threshold) { pairs.push({ pid, d, ready: true, score, readiness: score, weeks: 0, costAmt: 0, path: [] }); continue; }
      const plan = learningPlan(m, pid, d.role);
      // within reach = the smallest path lifts readiness to the role-fill threshold inside the window
      if (plan.projected < threshold || plan.weeks > e.maxReskillWeeks) continue;
      pairs.push({ pid, d, ready: false, score, readiness: plan.readiness, weeks: plan.weeks, costAmt: plan.costAmt, path: plan.path });
    }
  }
  // greedy: ready now first (best score), then the closest reskilling paths (readiness, then fewest weeks); one slot per role
  pairs.sort((a, b) => Number(b.ready) - Number(a.ready) || (a.ready ? b.score - a.score : b.readiness - a.readiness || a.weeks - b.weeks)
    || a.pid.localeCompare(b.pid) || a.d.key.localeCompare(b.d.key));
  const taken = new Map<string, Pair>();
  const slots = new Set<string>();
  for (const x of pairs) {
    if (taken.has(x.pid) || slots.has(x.d.key)) continue;
    taken.set(x.pid, x);
    slots.add(x.d.key);
  }
  const rows: RedeployRow[] = exposed.map((pid) => {
    const p = m.people.get(pid)!;
    const x = taken.get(pid);
    const base = { personId: pid, name: p.name, visible: p.consent_visibility === 1, title: p.title, location: m.locations.get(p.location_id) ?? p.location_id };
    if (!x) return { ...base, destination: null, mode: "none", score: 0, readiness: 0, weeks: 0, costAmt: 0, path: [], severanceAvoided: 0, hiringAvoided: 0, hireBasis: "" };
    const hire = hireCost(m, x.d.role.must);
    return { ...base, destination: x.d, mode: x.ready ? "ready" : "reskill", score: x.score, readiness: x.readiness, weeks: x.weeks, costAmt: x.costAmt, path: x.path,
      severanceAvoided: severanceAvoided(m, pid, e), hiringAvoided: hire.money, hireBasis: hire.basis };
  });
  const placed = rows.filter((r) => r.destination);
  const totals = {
    exposed: rows.length, preserved: placed.length,
    readyNow: placed.filter((r) => r.mode === "ready").length, reskilled: placed.filter((r) => r.mode === "reskill").length,
    severanceAvoided: sum(placed.map((r) => r.severanceAvoided)), hiringAvoided: sum(placed.map((r) => r.hiringAvoided)), reskillCost: sum(placed.map((r) => r.costAmt)), net: 0,
  };
  totals.net = totals.severanceAvoided + totals.hiringAvoided - totals.reskillCost;
  const plan = { opportunityId: e.opportunityId, rows, totals, assumptions: exposureText(e) };
  cached = { key, plan };
  return plan;
}

const label = (r: RedeployRow) => (r.visible ? r.name : PRIVATE);
const destLabel = (d: Destination) => (d.kind === "opportunity" ? `${d.role.role}, ${d.title}` : `${d.role.role} (${d.refId})`);

export function redeployBuilt(m: Model): ExecBuilt {
  const plan = redeployPlan(m);
  const w = exposureRule(m).maxReskillWeeks;
  const t = plan.totals;
  const own = plan.rows.filter((r) => r.destination?.refId === plan.opportunityId);
  const rollout = openOpportunities().find((o) => o.id === plan.opportunityId);
  const sorted = [...plan.rows].sort((a, b) => Number(!a.destination) - Number(!b.destination) || Number(b.mode === "ready") - Number(a.mode === "ready") || a.weeks - b.weeks || a.personId.localeCompare(b.personId));
  const when = t.readyNow ? `(${t.readyNow} ready now, ${t.reskilled} within ${w} weeks)` : `within ${w} weeks`;
  return {
    headline: !t.exposed ? "No contact-centre roles are exposed by the AI customer-service rollout under the current rule."
      : `The AI customer-service rollout exposes ${t.exposed} contact-centre roles. ${t.preserved} of those people can move to open internal roles ${when}, ` +
        `keeping ${money(t.severanceAvoided + t.hiringAvoided)} of severance and hiring cost in the business.${t.exposed > t.preserved ? ` The other ${t.exposed - t.preserved} join a redeployment pool for the next roles.` : ""}`,
    metrics: [
      { label: "Jobs preserved", value: `${t.preserved} of ${t.exposed}`, tone: "prod" },
      { label: "Severance and hiring avoided", value: money(t.severanceAvoided + t.hiringAvoided), tone: "cost" },
      { label: "Reskilling cost", value: money(t.reskillCost), tone: "neutral" },
    ],
    table: {
      columns: [{ label: "Person" }, { label: "Today" }, { label: "Destination" }, { label: "Path" }, { label: "Weeks", numeric: true }, { label: "Severance avoided", numeric: true }],
      rows: sorted.map((r) => ({
        cells: [label(r), r.visible ? `${r.title}, ${r.location}` : "Contact centre",
          r.destination ? destLabel(r.destination) : `No open role within ${w} weeks yet`,
          r.mode === "ready" ? `Ready now (${Math.round(r.score * 100)}% match)`
            : r.mode === "reskill" ? (r.path.length ? `${r.path.map((s) => s.name).join(", ")} (${r.costAmt ? money(r.costAmt) : "no fees"})` : "Skills in place; shadow the role first")
            : "Redeployment pool; matched as roles open",
          String(r.weeks), r.severanceAvoided ? money(r.severanceAvoided) : "None"],
        focusId: r.visible ? r.personId : undefined,
      })),
    },
    actions: [
      { label: "Approve the redeployment plan", detail: `Sent to the HR Director in the People Growth inbox: ${t.preserved} moves, ${money(t.reskillCost)} of reskilling, ${money(t.net)} net value.` },
      ...(own.length && rollout ? [{ label: "Let the people the AI displaces run the AI", detail: `${own.length} move into the rollout's own roles: ${own.map((r) => r.destination!.role.role).join(", ")}.`, query: rollout.demo_query ?? rollout.title }] : []),
    ],
    assumptions: plan.assumptions,
    highlight: {
      nodeIds: [...plan.rows.filter((r) => r.visible).map((r) => r.personId), ...new Set(plan.rows.flatMap((r) => (r.destination?.kind === "opportunity" ? [r.destination.refId] : [])))],
      edgeIds: [], danger: plan.rows.filter((r) => r.visible && !r.destination).map((r) => r.personId),
    },
  };
}

const DEDUPE = (oppId: string) => `redeploy:${oppId}`;

/** Called after the redeploy answer is built: proposes the plan to the People Growth inbox (once). */
export function proposeRedeploy(m: Model): boolean {
  ensureAgentTables();
  const plan = redeployPlan(m);
  const key = DEDUPE(plan.opportunityId);
  if (!plan.totals.preserved || get("SELECT 1 x FROM agent_inbox WHERE dedupe_key = ?", key)) return false;
  const t = plan.totals;
  const placed = plan.rows.filter((r) => r.destination);
  const runId = startRun("people", "Executive question: redeploy");
  const ok = propose({
    agent: "people", runId, kind: "redeploy", approver: "HR Director", dedupeKey: key, provider: "rules",
    title: `Redeploy ${t.preserved} contact-centre colleagues instead of retrenching`,
    detail: `AI customer service exposes ${t.exposed} roles. ${t.readyNow} people are ready for open roles now and ${t.reskilled} can be ready within ${exposureRule(m).maxReskillWeeks} weeks, ` +
      `for ${money(t.reskillCost)} of reskilling: ${money(t.severanceAvoided)} severance and ${money(t.hiringAvoided)} hiring avoided.`,
    evidence: placed.slice(0, 6).map((r) => `${label(r)}: ${destLabel(r.destination!)} (${r.mode === "ready" ? "ready now" : `${r.weeks} weeks`})`),
    valueAmt: t.net,
    nodeIds: placed.filter((r) => r.visible).map((r) => r.personId),
    action: { type: "redeploy", opportunityId: plan.opportunityId, personIds: placed.map((r) => r.personId), exposed: t.exposed, preserved: t.preserved,
      severanceAvoided: t.severanceAvoided, hiringAvoided: t.hiringAvoided, reskillCost: t.reskillCost, net: t.net },
  });
  finishRun(runId, "done", [{ tool: "Redeployment plan", detail: `${t.preserved} of ${t.exposed} placed`, ms: 0 }], `Proposed redeploying ${t.preserved} people.`, "rules", placed.map((r) => r.personId));
  return ok;
}

/** Approval of a "redeploy" proposal (agents/actions.ts): records the value and the jobs kept; never changes assignments. */
export function approveRedeploy(a: Record<string, any>, inboxId: number): { outcome: string; changed: boolean } {
  const ids: string[] = Array.isArray(a.personIds) ? a.personIds.map(String) : [];
  if (!ids.length) return { outcome: "Approved; nobody to redeploy.", changed: false };
  const sev = Number(a.severanceAvoided ?? 0), hire = Number(a.hiringAvoided ?? 0), cost = Number(a.reskillCost ?? 0);
  const rec = activate(null, "Redeployment: contact centre to AI customer-service roles", ids,
    { costAvoided: sev, productivity: 0, revenuePotential: 0, recruitmentAvoided: hire, assumptions: [], estimated: true }, "Jobs retained", "agent");
  recordSocial({ ref: `REDEPLOY-${inboxId}`, kind: "redeploy", impactId: rec.id, co2eKg: 0, travelKm: 0, jobsRetained: ids.length, volunteerHours: 0, downtimeHours: 0, peopleIds: ids,
    basis: `Approved redeployment plan for ${a.opportunityId ?? "the AI rollout"}: ${ids.length} people kept in work instead of retrenched.` });
  return { outcome: `Impact record ${rec.id}: ${ids.length} jobs retained; ${money(sev)} severance and ${money(hire)} hiring avoided, ${money(cost)} of reskilling to fund.`, changed: false };
}
