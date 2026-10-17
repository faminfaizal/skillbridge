// AI agents end to end, offline: a simulated record fires the database trigger, the runner wakes the Connectivity
// Agent and the downstream agents, a human approves, and the value lands in an impact record. Reset leaves no trace.
import { test, after } from "node:test";
import assert from "node:assert/strict";

process.env.LLM_DISABLE_VERTEX = "true";
process.env.LLM_MODE = "cache-first";

const { all, get } = await import("../src/lib/db.ts");
const { ensureRunner, tick, agentsView } = await import("../src/lib/agents/runner.ts");
const { simulate, resetAgents } = await import("../src/lib/agents/simulate.ts");
const { decide } = await import("../src/lib/agents/inbox.ts");

const impactTotal = () => get<{ t: number }>("SELECT SUM(cost_avoided_amt + productivity_amt + recruitment_amt + revenue_amt) t FROM impact_records")!.t;
const baseline = { impact: 0, edges: 0 };

after(async () => {
  await resetAgents();
  const g = (await import("../src/lib/graphBuild.ts")).readGraph()!;
  assert.equal(g.edges.length, baseline.edges, "graph back to its original edges after reset");
  assert.equal(impactTotal(), baseline.impact, "impact back to the seed total after reset");
  assert.equal(get<{ n: number }>("SELECT COUNT(*) n FROM incidents WHERE id LIKE 'SIM-%'")!.n, 0);
});

test("a database insert is logged by the trigger and picked up by the Connectivity Agent", async () => {
  ensureRunner();
  await resetAgents();
  baseline.impact = impactTotal();
  baseline.edges = (await import("../src/lib/graphBuild.ts")).readGraph()!.edges.length;
  simulate("offchart");
  const queued = all<{ kind: string; source: string }>("SELECT kind, source FROM change_events WHERE processed_at IS NULL");
  assert.ok(queued.some((e) => e.kind === "incident_resolved" && e.source === "db-trigger"));
  assert.ok(queued.some((e) => e.kind === "knowledge"));
  const r = await tick(true);
  assert.ok(r.processed >= 3);
  const run = agentsView().runs.find((x) => x.agent === "connectivity")!;
  assert.equal(run.status, "done");
  assert.ok(run.steps.some((s) => s.tool === "Hidden-skill inference" && /Network Management Systems/.test(s.detail)), "new skill inferred from the runbook");
  assert.ok(agentsView().inbox.some((i) => i.agent === "people" && i.kind === "confirm_skill"), "People Growth asks the manager to confirm it");
});

test("a consultancy purchase request becomes a hold proposal; approval records the cost avoided", async () => {
  simulate("purchase");
  await tick(true);
  const p = agentsView().inbox.find((i) => i.agent === "scout" && i.kind === "hold_purchase" && i.status === "pending");
  assert.ok(p, "Opportunity Scout proposed holding the purchase");
  assert.ok(p!.valueAmt > 0);
  const before = impactTotal();
  decide(p!.id, "approve");
  assert.equal(impactTotal(), before + p!.valueAmt);
  assert.throws(() => decide(p!.id, "approve"), /Already approved/);
});

test("a new RFP gets a bid-from-inside proposal; more RatePro incidents wake the Risk Sentinel", async () => {
  simulate("rfp");
  simulate("ratepro");
  await tick(true);
  const v = agentsView();
  assert.ok(v.inbox.some((i) => i.agent === "scout" && i.kind === "bid"), "bid proposal");
  assert.ok(v.inbox.some((i) => i.agent === "sentinel" && i.kind === "transfer_plan" && /RatePro/.test(i.title)), "knowledge-transfer plan for RatePro");
  for (const i of v.inbox) assert.ok(i.detail.length > 30 && !/[–—]/.test(i.detail), `drafted note: ${i.title}`);
});

test("an approved RFP bid is removed by reset (its impact record points at the simulated opportunity)", async () => {
  const bid = agentsView().inbox.find((i) => i.agent === "scout" && i.kind === "bid" && i.status === "pending");
  assert.ok(bid, "bid proposal pending");
  decide(bid!.id, "approve");
  await resetAgents();
  assert.equal(impactTotal(), baseline.impact);
  assert.equal(get<{ n: number }>("SELECT COUNT(*) n FROM opportunities WHERE id LIKE 'SIM-%'")!.n, 0);
});
