// Reskilling Intelligence, Opportunity Discovery and Executive Intelligence against the planted stories.
// Needs `npm run precompute` first (inferred skills). No network: these paths never call an LLM.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { data } from "../src/lib/engine/data.ts";
import { opportunityRoles } from "../src/lib/engine/requirements.ts";
import { learningPlan } from "../src/lib/engine/reskill.ts";
import { growthPaths } from "../src/lib/engine/growth.ts";
import { collaborationGaps, discover, duplicatedWork, externalSpend, hiddenExperts, revenueSignals, SINCE, spareCapacity } from "../src/lib/engine/discover.ts";
import { EXEC_QUESTIONS, execFacts, futureSkills, ruleIntent } from "../src/lib/engine/exec.ts";
import { all } from "../src/lib/db.ts";
import type { ExecIntent } from "../src/lib/types.ts";

const manifest = Object.fromEntries(
  JSON.parse(fs.readFileSync("../data/seed/story_manifest.json", "utf-8")).map((x: { anchor: string; expected: any }) => [x.anchor, x.expected]),
);

// ---------------------------------------------------------------- Reskilling Intelligence
test("A7: Lim's smallest path is 9 weeks and $4,700, against a 26-week certificate, and avoids the MLOps hire", () => {
  const m = data();
  const role = opportunityRoles("OPP-001").find((r) => r.role === "MLOps Engineer")!;
  const plan = learningPlan(m, manifest.A7.person_id, role);
  assert.deepEqual(plan.path.map((s) => s.id), manifest.A7.path);
  assert.equal(plan.weeks, 9);
  assert.equal(plan.costAmt, 4700);
  assert.equal(plan.contrast?.id, manifest.A7.contrast);
  assert.ok(plan.contrast!.weeks > plan.weeks * 2, "path is much shorter than the certificate");
  assert.ok(plan.projected > plan.readiness, "path raises readiness");
  for (const s of plan.skills) assert.ok(s.after >= s.now);
  const req = all<{ est_cost_amt: number }>("SELECT est_cost_amt FROM requisitions WHERE skill_id = 'SK-mlops' AND status = 'open'")[0];
  assert.equal(plan.valueAmt, req.est_cost_amt - plan.costAmt);
});

test("Growth paths: Lim sees the MLOps role she is nearly ready for, Hafiz sees the roles he can take now", () => {
  const lim = growthPaths(manifest.A7.person_id);
  assert.ok(lim.nearlyReady.some((x) => x.opportunityId === "OPP-001" && x.role === "MLOps Engineer" && x.weeks === 9));
  const hafiz = growthPaths(manifest.A1.person_id);
  assert.ok(hafiz.readyNow.some((x) => x.opportunityId === manifest.A1.opportunity));
});

// ---------------------------------------------------------------- Opportunity Discovery
test("A4: the Kubernetes and churn-model consultancy is flagged while the planted internal experts were free", () => {
  const found = externalSpend();
  for (const id of manifest.A4.engagements) assert.ok(found.some((f) => f.id === id), `${id} flagged`);
  const holders = new Set(found.flatMap((f) => f.holders.map((h) => h.id)));
  for (const p of manifest.A4.internal_people) assert.ok(holders.has(p), `${p} listed as idle expert`);
  assert.ok(found.every((f) => f.start >= SINCE && f.holders.every((h) => h.allocation < 50)));
});

test("A8: Joseph is the hidden expert for fibre fault localisation", () => {
  const top = hiddenExperts()[0];
  assert.equal(top.people[0].id, manifest.A8.person_id);
  assert.match(top.detail, new RegExp(manifest.A8.problem));
});

test("A9: Lisbon data engineering spare capacity is pointed at the telemetry platform", () => {
  const card = spareCapacity().find((c) => c.id === `capacity:${manifest.A9.department}|${manifest.A9.location}`);
  assert.ok(card, "Lisbon data engineering card");
  assert.ok(card!.nodeIds.includes(manifest.A9.opportunity));
});

test("A10: collaboration gaps only claim department and division pairs with no shared project in the window", () => {
  const cards = collaborationGaps();
  assert.ok(cards.length > 0);
  const recent = new Set(all<{ id: string }>("SELECT id FROM projects WHERE end_date >= ?", SINCE).map((r) => r.id));
  const asg = all<{ project_id: string; department_id: string | null; division_id: string }>(
    "SELECT a.project_id, p.department_id, p.division_id FROM assignments a JOIN people p ON p.id = a.person_id");
  for (const c of cards) {
    const [, dept, div] = c.id.split(":");
    const shared = [...recent].filter((pid) => asg.some((a) => a.project_id === pid && a.department_id === dept) && asg.some((a) => a.project_id === pid && a.division_id === div));
    assert.equal(shared.length, 0, `${dept} x ${div}`);
  }
  // the planted pair (Enterprise Solutions x AI & Data Lab) holds in the data too
  const ent = [...recent].filter((pid) => asg.some((a) => a.project_id === pid && a.department_id === manifest.A10.department) && asg.some((a) => a.project_id === pid && a.division_id === manifest.A10.division));
  assert.equal(ent.length, manifest.A10.shared_projects);
});

test("A11: smart campus video analytics is the top revenue signal, asked 7 times and fully covered", () => {
  const top = revenueSignals()[0];
  assert.equal(top.o.id, manifest.A11.opportunity);
  assert.ok(top.demand >= manifest.A11.demand_signals_min);
  assert.equal(top.coverage, 1);
  assert.ok(top.teams.length >= 3);
});

test("A12: the two churn models are the top duplicated-work finding", () => {
  const top = duplicatedWork()[0];
  for (const k of manifest.A12.knowledge) assert.ok(top.evidence.some((e) => e.includes(k)), `${k} cited`);
  for (const p of manifest.A12.projects) assert.ok(top.nodeIds.includes(p), `${p} highlighted`);
});

test("Discovery board: every story type present, A3 and A18 included, opted-out people never named", () => {
  const r = discover();
  const types = new Set(r.cards.map((c) => c.type));
  for (const t of ["revenue", "external_spend", "capacity", "reskill", "duplicate", "hidden_expert", "collaboration", "risk", "sme"]) assert.ok(types.has(t as any), t);
  assert.ok(r.cards.some((c) => c.type === "risk" && c.id.endsWith(manifest.A3.system_id)));
  assert.ok(r.cards.find((c) => c.type === "sme")!.people.some((p) => p.id === manifest.A18.regional_match));
  assert.ok(r.cards.some((c) => c.type === "reskill" && c.people.some((p) => p.id === manifest.A7.person_id)));
  const m = data();
  for (const c of r.cards.filter((x) => x.type !== "risk")) for (const p of c.people) assert.equal(m.people.get(p.id)!.consent_visibility, 1, `${p.name} on ${c.id}`);
  assert.equal(r.totalValueAmt, r.cards.reduce((a, c) => a + c.valueAmt, 0));
});

// ---------------------------------------------------------------- Executive Intelligence
test("Every PRD executive question routes to its intent; staffing requests do not", () => {
  for (const [intent, q] of Object.entries(EXEC_QUESTIONS)) assert.equal(ruleIntent(q), intent, q);
  const staffing = all<{ demo_query: string }>("SELECT demo_query FROM opportunities WHERE demo_query IS NOT NULL").map((r) => r.demo_query);
  for (const q of staffing) assert.equal(ruleIntent(q), null, q);
});

test("A16: the emerging skills under most pressure include the planted thin AI skills", () => {
  const top = futureSkills().slice(0, 5).map((r) => r.skill);
  const hits = manifest.A16.emerging.filter((s: string) => top.includes(s));
  assert.ok(hits.length >= 3, `top five: ${top.join(", ")}`);
});

test("Executive answers: each has a decision, figures and evidence rows", () => {
  for (const intent of Object.keys(EXEC_QUESTIONS) as ExecIntent[]) {
    const b = execFacts(intent);
    assert.ok(b.headline.length > 30, intent);
    assert.equal(b.metrics.length, 3, intent);
    assert.ok(b.table.rows.length > 0, intent);
    for (const row of b.table.rows) assert.equal(row.cells.length, b.table.columns.length, intent);
    assert.ok(!/[–—]/.test(b.headline), "house style: no dashes");
  }
  assert.match(execFacts("dependency").headline, /78%/);
  assert.match(execFacts("revenue").headline, /Smart campus/);
});
