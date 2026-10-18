// Inclusion lens (opportunity equity), offline: one item per location, shares that add up, remote regions flagged,
// under-represented first, nobody who opted out named, and fast enough for every agent tick.
import { test } from "node:test";
import assert from "node:assert/strict";
import { data } from "../src/lib/engine/data.ts";
import { inclusionItems, inclusionStats } from "../src/lib/engine/inclusion.ts";
import { signals } from "../src/lib/engine/signals.ts";
import { all } from "../src/lib/db.ts";

test("inclusion: 7 locations, shares sum to about 1, remote regions flagged, most under-represented first", () => {
  const m = data();
  const ghosts = signals("ghosts").items;
  const rows = inclusionStats(m, ghosts);
  assert.equal(rows.length, 7);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum(rows.map((r) => r.headShare)) - 1) <= 0.03, "headcount shares");
  assert.ok(Math.abs(sum(rows.map((r) => r.proposedShare)) - 1) <= 0.03, "opportunity shares");
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].ratio <= rows[i].ratio, "sorted by ratio");
  const items = inclusionItems(m, ghosts);
  assert.equal(items.length, 7);
  for (const loc of ["LOC-DRW", "LOC-CNS"]) assert.match(items.find((x) => x.id === `INC-${loc}`)!.subtitle, /Remote region/);
  assert.match(items.find((x) => x.id === "INC-LOC-SIN")!.subtitle, /^Office/);
  for (const it of items) {
    assert.match(it.metric, /^\d+\.\dx$/);
    assert.ok(it.facts.length >= 3);
    assert.ok(!/[–—]/.test(it.facts.join(" ")), "house style: no dashes");
  }
});

test("inclusion: no opted-out names, and the lens is quick", () => {
  const m = data();
  const optedOut = new Set(all<{ id: string; name: string }>("SELECT id FROM people WHERE consent_visibility = 0").map((r) => r.id));
  const ghosts = signals("ghosts").items;
  inclusionItems(m, ghosts);
  const t0 = Date.now();
  const items = inclusionItems(m, ghosts);
  assert.ok(Date.now() - t0 < 300, `took ${Date.now() - t0} ms`);
  for (const it of items) {
    for (const p of it.people) assert.ok(!optedOut.has(p.id), p.name);
    for (const id of it.nodeIds) assert.ok(!optedOut.has(id), id);
    if (m.people.has(it.focusId)) assert.ok(!optedOut.has(it.focusId));
  }
  const names = [...optedOut].map((id) => m.people.get(id)!.name);
  for (const it of items) for (const f of it.facts) for (const n of names) assert.ok(!f.includes(n), `${n} in ${it.title}`);
});
