// Redeploy, don't retrench, offline: the exposure rule, consent, totals that add up, routing, the executive answer
// shape, and an approval that records value and jobs kept without moving anyone. Reset leaves no trace.
import { test, after } from "node:test";
import assert from "node:assert/strict";

process.env.LLM_DISABLE_VERTEX = "true";
process.env.LLM_MODE = "cache-first";

const { all, get } = await import("../src/lib/db.ts");
const { data } = await import("../src/lib/engine/data.ts");
const { exposedPeople, redeployPlan, proposeRedeploy } = await import("../src/lib/engine/redeploy.ts");
const { EXEC_QUESTIONS, execFacts, ruleIntent } = await import("../src/lib/engine/exec.ts");
const { EXPOSURE } = await import("../src/lib/engine/assumptions.ts");
const { decide } = await import("../src/lib/agents/inbox.ts");
const { resetAgents } = await import("../src/lib/agents/simulate.ts");
const { socialRows } = await import("../src/lib/engine/socialStore.ts");

after(async () => { await resetAgents(); });

test("exposure: contact-centre executives only, no managers or leaders", () => {
  const m = data();
  const ids = exposedPeople(m);
  assert.equal(ids.length, 9);
  for (const id of ids) {
    const p = m.people.get(id)!;
    assert.ok(!EXPOSURE.excludeLevels.includes(p.level), `${p.name} is ${p.level}`);
    assert.equal(p.department_id, "DEP-CC");
  }
});

test("plan: one slot per role, one role per person, totals equal the sums of the rows", () => {
  const p = redeployPlan(data());
  const placed = p.rows.filter((r) => r.destination);
  assert.equal(new Set(placed.map((r) => r.destination!.key)).size, placed.length, "one person per slot");
  assert.equal(new Set(p.rows.map((r) => r.personId)).size, p.rows.length);
  const sum = (f: (r: (typeof p.rows)[number]) => number) => placed.reduce((a, r) => a + f(r), 0);
  assert.equal(p.totals.exposed, p.rows.length);
  assert.equal(p.totals.preserved, placed.length);
  assert.equal(p.totals.readyNow + p.totals.reskilled, placed.length);
  assert.equal(p.totals.severanceAvoided, sum((r) => r.severanceAvoided));
  assert.equal(p.totals.hiringAvoided, sum((r) => r.hiringAvoided));
  assert.equal(p.totals.reskillCost, sum((r) => r.costAmt));
  assert.equal(p.totals.net, p.totals.severanceAvoided + p.totals.hiringAvoided - p.totals.reskillCost);
  assert.ok(p.totals.preserved > 0);
  for (const r of placed) assert.ok(r.mode === "ready" || r.weeks <= EXPOSURE.maxReskillWeeks, r.name);
  assert.ok(placed.some((r) => r.destination!.refId === EXPOSURE.opportunityId), "someone moves into the rollout's own roles");
});

test("answer: executive shape, and only consenting people are named", () => {
  const m = data();
  const b = execFacts("redeploy");
  assert.ok(b.headline.length > 30);
  assert.equal(b.metrics.length, 3);
  assert.ok(b.table.rows.length > 0);
  for (const row of b.table.rows) assert.equal(row.cells.length, b.table.columns.length);
  assert.ok(!/[–—]/.test(b.headline + JSON.stringify(b.table) + b.assumptions.join(" ")), "house style: no dashes");
  const optedOut = [...m.people.values()].filter((p) => p.consent_visibility !== 1);
  const text = JSON.stringify(b);
  for (const p of optedOut) assert.ok(!text.includes(p.name), `${p.name} is private`);
  for (const row of b.table.rows) if (row.focusId) assert.equal(m.people.get(row.focusId)!.consent_visibility, 1);
  for (const id of b.highlight.nodeIds) if (m.people.has(id)) assert.equal(m.people.get(id)!.consent_visibility, 1);
});

test("routing: the redeploy rule takes its own question and nothing else", () => {
  assert.equal(ruleIntent(EXEC_QUESTIONS.redeploy), "redeploy");
  for (const [intent, q] of Object.entries(EXEC_QUESTIONS)) if (intent !== "redeploy") assert.notEqual(ruleIntent(q), "redeploy", q);
  for (const { demo_query } of all<{ demo_query: string }>("SELECT demo_query FROM opportunities WHERE demo_query IS NOT NULL")) assert.notEqual(ruleIntent(demo_query), "redeploy", demo_query);
  for (const q of ["Which jobs are at risk if AI takes over?", "Can we redeploy the contact centre?"]) assert.equal(ruleIntent(q), "redeploy", q);
});

test("approval: one proposal, value and jobs recorded, no assignment changed; reset removes it", async () => {
  await resetAgents();
  const m = data();
  const assignments = get<{ n: number }>("SELECT COUNT(*) n FROM assignments")!.n;
  const total = () => get<{ t: number }>("SELECT SUM(cost_avoided_amt + productivity_amt + recruitment_amt + revenue_amt) t FROM impact_records")!.t;
  const before = total();
  assert.equal(proposeRedeploy(m), true);
  assert.equal(proposeRedeploy(m), false, "deduped");
  const row = get<{ id: number; approver: string; action: string }>("SELECT id, approver, action FROM agent_inbox WHERE dedupe_key = 'redeploy:OPP-002'")!;
  assert.equal(row.approver, "HR Director");
  const plan = redeployPlan(m);
  const r = decide(row.id, "approve");
  assert.match(r.outcome, /jobs retained/);
  assert.equal(total() - before, plan.totals.severanceAvoided + plan.totals.hiringAvoided);
  assert.equal(get<{ n: number }>("SELECT COUNT(*) n FROM assignments")!.n, assignments, "assignments untouched");
  const social = socialRows().filter((x) => x.kind === "redeploy");
  assert.equal(social.length, 1);
  assert.equal(social[0].jobsRetained, plan.totals.preserved);
  await resetAgents();
  assert.equal(total(), before);
  assert.equal(socialRows().length, 0);
});
