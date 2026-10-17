// Challenge Team: the team match score, AI's next best, and choosing a named person. Offline and deterministic.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.LLM_DISABLE_VERTEX = "true";
process.env.LLM_MODE = "cache-first";

const { data } = await import("../src/lib/engine/data.ts");
const { exactOpportunity, parseRequest } = await import("../src/lib/engine/requirements.ts");
const { formTeam } = await import("../src/lib/engine/team.ts");
const { evaluateTeam, nextBest, searchForRole, teamFit } = await import("../src/lib/engine/teamFit.ts");

const m = data();
const Q = "We need to deliver an AI-powered customer analytics project.";
const parsed = await parseRequest(Q, m, exactOpportunity(Q) ?? undefined);
const roles = parsed.roles;
const proposed = formTeam(roles, m);
const ids = roles.map((r) => proposed.team.find((c) => c.role === r.role)?.personId ?? null);
const gap = ids.findIndex((x) => !x);
const byName = (n: string) => [...m.people.values()].find((p) => p.name === n)!.id;

test("A5 proposal: one score from four weighted parts, the MLOps gap and the first-time team are flagged", () => {
  const e = evaluateTeam(roles, ids, true, m);
  const f = e.fit;
  const w = f.weights;
  const expected = w.roleFit * f.parts.roleFit + w.coverage * f.parts.coverage + w.complementarity * f.parts.complementarity + w.availability * f.parts.availability;
  assert.ok(Math.abs(f.score - expected) < 0.011, "score is the weighted sum of its parts");
  assert.ok(f.score >= 0.7 && f.score <= 0.9, `team match ${f.score}`);
  assert.equal(e.slots.filter(Boolean).length, 6);
  assert.ok(gap >= 0 && /MLOps/.test(roles[gap].role));
  assert.ok(f.warnings.some((x) => /MLOps is not covered/.test(x.text)));
  assert.ok(f.notes.some((n) => /First-time team/.test(n)));
  assert.equal(e.value, null, "value stays the opportunity's");
  for (const c of e.slots.filter(Boolean)) assert.ok(f.brings[c!.personId].length > 0, `${c!.name} brings a skill`);
});

test("AI next best never repeats someone on the team or already passed over", () => {
  const onTeam = ids.filter((x): x is string => !!x);
  const first = nextBest(roles[0], onTeam, m)!;
  assert.ok(first && !onTeam.includes(first.personId));
  const second = nextBest(roles[0], [...onTeam, first.personId], m)!;
  assert.notEqual(second.personId, first.personId);
  assert.ok(second.score <= first.score);
});

test("swapping in a weaker person lowers the score; filling the gap raises it", () => {
  const base = evaluateTeam(roles, ids, true, m).fit.score;
  const swapped = [...ids];
  swapped[0] = nextBest(roles[0], ids.filter((x): x is string => !!x), m)!.personId;
  assert.ok(evaluateTeam(roles, swapped, true, m).fit.score < base);
  const filled = [...ids];
  filled[gap] = byName("Lim Wei Ling");
  const f = evaluateTeam(roles, filled, true, m).fit;
  assert.ok(f.score > base, "Lim in the MLOps role raises the team match");
  assert.ok(f.warnings.some((x) => x.personId === filled[gap] && /below the 70% fill threshold/.test(x.text)), "and asks for reskilling");
});

test("a manager can name anyone: search scores people for the role and skips the team", () => {
  const onTeam = ids.filter((x): x is string => !!x);
  const r = searchForRole(roles[gap], "lim", onTeam, m);
  assert.ok(r.length > 0 && r.every((c) => /lim/i.test(c.name) && !onTeam.includes(c.personId)));
  assert.ok(r.some((c) => c.name === "Lim Wei Ling"));
  for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].score >= r[i].score);
  assert.deepEqual(searchForRole(roles[gap], "l", onTeam, m), [], "needs two letters");
});

test("free-text requests re-estimate value for the new team; an empty team scores low", () => {
  assert.ok(evaluateTeam(roles, ids, false, m).value!.costAvoided >= 0);
  const empty = teamFit(roles, roles.map(() => null), m);
  assert.equal(empty.score, 0);
  assert.equal(empty.warnings.filter((x) => /No one in this role/.test(x.text)).length, roles.length);
});

test("extras: adding a person to a filled role never lowers role fit and pools that role's free time", () => {
  const base = evaluateTeam(roles, ids, true, m);
  const onTeam = ids.filter((x): x is string => !!x);
  const helper = nextBest(roles[0], onTeam, m)!;
  const e = evaluateTeam(roles, ids, true, m, [{ slot: 0, personId: helper.personId }]);
  assert.equal(e.extras.length, 1);
  assert.equal(e.extras[0].slot, 0);
  assert.ok(e.fit.parts.roleFit >= base.fit.parts.roleFit, "the strongest person in each role still counts");
  assert.ok(e.fit.parts.availability >= base.fit.parts.availability, "two people pool their free time");
  assert.equal(e.value, null, "value stays the opportunity's");
  assert.ok(e.slots.every((c, i) => c?.personId === base.slots[i]?.personId), "role slots are untouched");
});

test("extras: no one twice, unknown people and roles dropped, at most six", () => {
  const dup = evaluateTeam(roles, ids, true, m, [{ slot: 0, personId: ids[1]! }, { slot: 99, personId: byName("Lim Wei Ling") }, { slot: 0, personId: "P-NOPE" }]);
  assert.equal(dup.extras.length, 0);
  const onTeam = ids.filter((x): x is string => !!x);
  const pool = [...m.people.keys()].filter((p) => !onTeam.includes(p)).slice(0, 8).map((personId) => ({ slot: 1, personId }));
  assert.equal(evaluateTeam(roles, ids, true, m, pool).extras.length, 6);
});

test("extras: filling the MLOps gap with an extra counts the role as filled; a passenger is flagged", () => {
  const lim = byName("Lim Wei Ling");
  const e = evaluateTeam(roles, ids, true, m, [{ slot: gap, personId: lim }]);
  assert.equal(e.coverage, 1, "every role now has someone");
  assert.ok(e.fit.score > evaluateTeam(roles, ids, true, m).fit.score);
  // someone who brings nothing the team lacks is called out, not hidden
  const onTeam = ids.filter((x): x is string => !!x);
  const weak = searchForRole(roles[0], "an", onTeam, m, 50).at(-1)!;
  const p = evaluateTeam(roles, ids, true, m, [{ slot: 0, personId: weak.personId }]);
  assert.equal(p.fit.brings[weak.personId].length, 0, `${weak.name} (${weak.title}) brings nothing new`);
  assert.ok(p.fit.warnings.some((x) => x.personId === weak.personId && /adds no skill/.test(x.text)));
});
