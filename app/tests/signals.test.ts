// People Signals against the planted stories (A2, A19, A20) and their own claims. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { data } from "../src/lib/engine/data.ts";
import { capability } from "../src/lib/engine/match.ts";
import { SIGNAL_KINDS, signals } from "../src/lib/engine/signals.ts";
import { all } from "../src/lib/db.ts";

const manifest = Object.fromEntries(
  JSON.parse(fs.readFileSync("../data/seed/story_manifest.json", "utf-8")).map((x: { anchor: string; expected: any }) => [x.anchor, x.expected]),
);

test("A19: the network architect is an expert to re-engage", () => {
  const it = signals("forgotten").items.find((x) => x.id === manifest.A19.person_id);
  assert.ok(it, "listed");
  assert.equal(it!.spark!.slice(4).reduce((a, b) => a + b, 0), manifest.A19.events_2026, "no 2026 activity");
  assert.ok(it!.nodeIds.includes(manifest.A19.knowledge[0]), "their reused design is highlighted");
});

test("A20: the field service coordinator is an off-chart contributor", () => {
  const it = signals("ghosts").items.find((x) => x.id === manifest.A20.person_id);
  assert.ok(it, "listed");
  assert.match(it!.facts[0], /On 0 project rosters/);
});

test("A2: Priya shows up as a bridge, a rising star and an overloaded connector", () => {
  for (const k of ["bridges", "rising", "bottlenecks"] as const) {
    assert.ok(signals(k).items.some((x) => x.id === manifest.A2.person_id), k);
  }
});

test("Knowledge islands: every expert sits in the one named team, and outside demand is cited", () => {
  const m = data();
  for (const it of signals("islands").items) {
    const experts = [...m.people.values()].filter((p) => p.level !== "C" && capability(m, p.id, it.id).value >= 0.8 && capability(m, p.id, it.id).source !== "adjacent");
    assert.equal(new Set(experts.map((p) => p.department_id)).size, 1, it.title);
    assert.ok(it.facts.some((f) => /projects? in other divisions|Needed by|consultants/.test(f)), `${it.title} cites demand`);
  }
});

test("Overloaded connectors: each person carries at least two load flags", () => {
  for (const it of signals("bottlenecks").items) assert.ok(it.facts.length - 1 >= 2, it.title);
});

test("Every lens returns items, and no lens names someone who opted out", () => {
  const optedOut = new Set(all<{ id: string }>("SELECT id FROM people WHERE consent_visibility = 0").map((r) => r.id));
  for (const k of SIGNAL_KINDS) {
    const r = signals(k);
    assert.ok(r.items.length > 0, `${k} has items`);
    for (const it of r.items) for (const p of it.people) assert.ok(!optedOut.has(p.id), `${k}: ${p.name}`);
  }
});
