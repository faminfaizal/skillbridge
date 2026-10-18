// Incident response team, offline: the sample report is read by the rules, staffed by fit, proximity and availability
// with consent respected, beats the skills-only baseline on travel, and an approval lands in impact and social records.
import { test, after } from "node:test";
import assert from "node:assert/strict";

process.env.LLM_DISABLE_VERTEX = "true";

const { all, get } = await import("../src/lib/db.ts");
const { data } = await import("../src/lib/engine/data.ts");
const { parseSitrep } = await import("../src/lib/engine/intake.ts");
const { respond, latestCrisis, resetCrisis, SAMPLE_SITREP } = await import("../src/lib/engine/crisis.ts");
const { socialRows } = await import("../src/lib/engine/socialStore.ts");
const { decide } = await import("../src/lib/agents/inbox.ts");
const { resetAgents } = await import("../src/lib/agents/simulate.ts");

const state: { inboxId: number | null; crisisId: string } = { inboxId: null, crisisId: "" };

after(async () => {
  await resetAgents();
  assert.equal(get<{ n: number }>("SELECT COUNT(*) n FROM crisis_events")!.n, 0, "no crisis rows after reset");
  assert.equal(get<{ n: number }>("SELECT COUNT(*) n FROM impact_records WHERE title LIKE 'Incident response:%'")!.n, 0);
  assert.equal(socialRows().length, 0);
});

test("the sample report is read offline: Katherine, P1, and the four requested roles", async () => {
  const s = await parseSitrep({ text: SAMPLE_SITREP });
  assert.equal(s.place?.name, "Katherine");
  assert.equal(s.severity, "P1");
  assert.equal(s.customersReported, 1200);
  assert.ok(s.roles.length <= 4);
  const skills = new Set(s.roles.flatMap((r) => r.must));
  for (const id of ["SK-fibre-splicing", "SK-fibre-testing-otdr", "SK-field-service-coordination", "SK-lorawan"]) assert.ok(skills.has(id), `${id} requested`);
});

test("photo only with Gemini offline falls back to the sample text, never blank", async () => {
  const s = await parseSitrep({ file: { mimeType: "image/png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }, fallbackText: SAMPLE_SITREP });
  assert.equal(s.provider, "rules");
  assert.equal(s.read, "photo");
  assert.equal(s.place?.name, "Katherine");
  assert.ok(s.summary.length > 20);
});

test("the team is local, consenting, not C level, and travels less than the skills-only baseline", async () => {
  await resetAgents();
  const m = data();
  const plan = await respond({ text: SAMPLE_SITREP });
  state.inboxId = plan.inboxId;
  state.crisisId = plan.id;
  assert.match(plan.id, /^SIM-CRX-\d+$/);
  assert.ok(plan.teamIds.includes("P-066"), "Joseph Mendoza (Darwin) is on the team");
  assert.ok(plan.teamIds.filter((id) => m.people.get(id)!.location_id === "LOC-DRW").length >= 2, "Darwin people on the team");
  assert.equal(new Set(plan.teamIds).size, plan.teamIds.length, "nobody twice");
  assert.ok(plan.teamIds.length <= 8 && plan.roles.length <= 4);
  for (const id of plan.teamIds) {
    const p = m.people.get(id)!;
    assert.equal(p.consent_visibility, 1, `${id} consents`);
    assert.notEqual(p.level, "C");
    assert.ok(p.availability_pct >= 10);
  }
  for (const b of plan.baseline) assert.equal(m.people.get(b.personId)!.consent_visibility, 1, "baseline uses the same consent rules");
  assert.ok(plan.totals.travelKm < plan.totals.baselineTravelKm, "less travel than the baseline");
  assert.ok(plan.totals.etaHours <= plan.totals.baselineEtaHours);
  assert.ok(plan.privateCount >= 0);
  assert.ok(plan.inboxId, "a proposal is in the inbox");
  const inbox = get<{ agent: string; kind: string; approver: string; title: string }>("SELECT agent, kind, approver, title FROM agent_inbox WHERE id = ?", plan.inboxId!)!;
  assert.deepEqual([inbox.agent, inbox.kind, inbox.approver, inbox.title], ["sentinel", "mobilise", "Head of Field Ops Regional", "Mobilise incident team: Katherine"]);
  const run = all<{ steps: string }>("SELECT steps FROM agent_runs WHERE agent = 'sentinel' AND trigger = 'Situation report'");
  assert.ok(run.length && JSON.parse(run[0].steps).some((s: { tool: string }) => s.tool === "Consent check"));
  assert.equal(latestCrisis()?.id, plan.id);
});

test("approving the proposal records business continuity value and a social row", () => {
  const r = decide(state.inboxId!, "approve");
  assert.equal(r.status, "approved");
  const rec = get<{ strategic_value: string; source: string; people_count: number }>("SELECT strategic_value, source, people_count FROM impact_records WHERE title = 'Incident response: Katherine'")!;
  assert.equal(rec.strategic_value, "Business continuity");
  assert.equal(rec.source, "agent");
  const social = socialRows().find((x) => x.ref === state.crisisId)!;
  assert.equal(social.kind, "crisis");
  assert.ok(social.impactId && social.travelKm > 0 && social.co2eKg > 0);
  assert.equal(latestCrisis()?.status, "mobilised");
});

test("resetCrisis leaves nothing", () => {
  assert.ok(resetCrisis() >= 1);
  assert.equal(latestCrisis(), null);
  assert.equal(get<{ n: number }>("SELECT COUNT(*) n FROM crisis_events")!.n, 0);
});
