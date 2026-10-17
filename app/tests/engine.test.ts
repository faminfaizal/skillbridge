// Engine acceptance tests: every scored story in data/seed/story_manifest.json. Needs `npm run precompute` first.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { data } from "../src/lib/engine/data.ts";
import { scorePerson } from "../src/lib/engine/match.ts";
import { formTeam } from "../src/lib/engine/team.ts";
import { opportunityRoles } from "../src/lib/engine/requirements.ts";
import { valueForOpportunity, type OpportunityRow } from "../src/lib/engine/value.ts";
import { hiddenTalent } from "../src/lib/engine/hidden.ts";
import { concentrationRisks, whatIf } from "../src/lib/engine/whatif.ts";
import { all } from "../src/lib/db.ts";

const manifest = Object.fromEntries(
  JSON.parse(fs.readFileSync("../data/seed/story_manifest.json", "utf-8")).map((x: { anchor: string; expected: any }) => [x.anchor, x.expected]),
);
const opp = (id: string) => all<OpportunityRow>("SELECT * FROM opportunities WHERE id = ?", id)[0];

test("A1: Hafiz is found for test automation through inferred skills (~87%)", () => {
  const m = data();
  const e = manifest.A1;
  const declared = [...(m.declared.get(e.person_id)?.keys() ?? [])].map((s) => m.skills.get(s)!.name);
  for (const s of e.no_declared_skills) assert.ok(!declared.includes(s), `${s} must not be declared`);
  const c = scorePerson(e.person_id, opportunityRoles(e.opportunity)[0]);
  assert.ok(Math.abs(c.score * 100 - e.score_target) <= e.score_tolerance, `score ${c.score}`);
  assert.equal(c.hidden, true);
  assert.ok(c.evidence.length >= e.evidence_min, "evidence listed");
});

test("A5: customer analytics team = the planted 6 incl. Hafiz, 1 MLOps gap, 2 reskill candidates", () => {
  const e = manifest.A5;
  const t = formTeam(opportunityRoles(e.opportunity));
  assert.deepEqual(new Set(t.team.map((c) => c.personId)), new Set(e.team));
  assert.deepEqual(t.team.filter((c) => c.hidden).map((c) => c.personId), e.hidden);
  assert.equal(t.gaps.length, 1);
  assert.deepEqual(t.gaps[0].skills, e.gap_skills);
  assert.deepEqual(t.gaps[0].reskill.map((r) => r.personId), e.reskill);
  const v = valueForOpportunity(opp(e.opportunity));
  assert.equal(v.costAvoided, e.cost_avoided_amt);
  assert.equal(v.productivity, e.productivity_amt);
  assert.equal(v.revenuePotential, e.revenue_potential_amt);
});

test("A6: AI customer-service coverage ~82% with one gap", () => {
  const e = manifest.A6;
  const t = formTeam(opportunityRoles(e.opportunity));
  assert.ok(Math.abs(t.coverage - e.coverage) <= e.tolerance, `coverage ${t.coverage}`);
  assert.equal(t.gaps.length, 1);
  assert.ok(t.gaps[0].skills.includes(e.gap_skill));
});

test("A7: Lim is ~75% ready, path = 2 short courses + 1 assignment, contrasted with the 6-month certificate", () => {
  const e = manifest.A7;
  const g = formTeam(opportunityRoles("OPP-001")).gaps[0];
  const lim = g.reskill.find((r) => r.personId === e.person_id)!;
  assert.ok(lim, "Lim offered");
  assert.ok(Math.abs(lim.readiness - e.readiness) <= e.tolerance, `readiness ${lim.readiness}`);
  assert.deepEqual(lim.path.map((p) => p.id), e.path);
  assert.equal(lim.contrast?.id, e.contrast);
});

test("A9: spare Lisbon data engineering capacity is picked for the telemetry platform", () => {
  const m = data();
  const t = formTeam(opportunityRoles(manifest.A9.opportunity));
  const de = t.team.find((c) => c.role === "Data Engineer")!;
  assert.ok(de, "data engineer found");
  const p = m.people.get(de.personId)!;
  assert.equal(p.department_id, manifest.A9.department);
  assert.equal(p.location_id, manifest.A9.location);
});

test("A11: the smart campus offer is covered by the three planted holders", () => {
  const t = formTeam(opportunityRoles(manifest.A11.opportunity));
  assert.equal(t.gaps.length, 0);
  for (const h of manifest.A11.holders) assert.ok(t.team.some((c) => c.personId === h), `${h} in team`);
});

test("A13: VPN latency goes to a core engineer who solved it before", () => {
  const t = formTeam(opportunityRoles(manifest.A13.opportunity));
  assert.ok(manifest.A13.experts.includes(t.team[0].personId));
  assert.equal(t.team[0].solvedSimilar, true);
});

test("A2 + A17: Priya tops Hidden Talent; opted-out people never appear", () => {
  const list = hiddenTalent(20);
  assert.equal(list[0].personId, manifest.A2.person_id);
  assert.equal(list[0].projects, manifest.A2.projects);
  assert.equal(list[0].trend, "rising");
  assert.ok(list[0].criticalKnowledgeAreas >= manifest.A2.critical_knowledge_areas);
  assert.ok(!list.some((p) => p.personId === manifest.A17.opted_out_star));
});

test("A3: RatePro is 78% dependent on three people; what-if shows the blast radius", () => {
  const r = concentrationRisks().find((x) => x.systemId === manifest.A3.system_id)!;
  assert.ok(Math.abs(r.share - manifest.A3.share) <= manifest.A3.tolerance);
  assert.deepEqual(new Set(r.people.map((p) => p.id)), new Set(manifest.A3.people));
  const w = whatIf(manifest.A3.people);
  assert.equal(w.systems[0].id, manifest.A3.system_id);
  assert.ok(w.customers.length > 0);
});

test("A15: seed impact records sum to $1.50M with the exact breakdown", () => {
  const rows = all<{ c: number; p: number; r: number; v: number }>(
    "SELECT SUM(cost_avoided_amt) c, SUM(productivity_amt) p, SUM(recruitment_amt) r, SUM(revenue_amt) v FROM impact_records WHERE source = 'seed'")[0];
  const e = manifest.A15;
  assert.deepEqual([rows.c, rows.p, rows.r, rows.v], [e.cost_avoided_amt, e.productivity_amt, e.recruitment_amt, e.revenue_amt]);
});
