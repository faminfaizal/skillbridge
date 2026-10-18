// Social and environmental value ledger, offline: seed values follow the stated formulas, approvals move the live part,
// rows of removed impact records are ignored, and the statement never carries a figure the facts do not hold.
import { test, after } from "node:test";
import assert from "node:assert/strict";

process.env.LLM_DISABLE_VERTEX = "true";
process.env.LLM_MODE = "cache-first";

const { all, run } = await import("../src/lib/db.ts");
const { data } = await import("../src/lib/engine/data.ts");
const { socialLedger, socialStatement, templateStatement, unsupported } = await import("../src/lib/engine/social.ts");
const { recordSocial, ensureSocialTable } = await import("../src/lib/engine/socialStore.ts");
const { SOCIAL } = await import("../src/lib/engine/assumptions.ts");

const clean = () => { ensureSocialTable(); run("DELETE FROM social_records WHERE ref LIKE 'TEST-%'"); };
after(clean);
const line = (l: ReturnType<typeof socialLedger>, k: string) => l.lines.find((x) => x.key === k)!;

test("seed ledger: deterministic, and every seed figure follows its stated formula", () => {
  clean();
  const a = socialLedger(), b = socialLedger();
  assert.deepEqual(a, b);
  assert.deepEqual(a.lines.map((x) => x.key), ["co2e", "jobs", "volunteer", "remote", "downtime"]);
  const seed = all<{ cost_avoided_amt: number; strategic_value: string; title: string; people_count: number }>("SELECT * FROM impact_records WHERE source = 'seed'");
  const rate = Number(data().finance.consultant_day_rate_amt?.default ?? 4000);
  const trips = seed.filter((r) => r.cost_avoided_amt > 0).reduce((s, r) => s + Math.ceil(r.cost_avoided_amt / rate / SOCIAL.daysPerTrip), 0);
  assert.equal(line(a, "co2e").seed, Math.round((trips * SOCIAL.tripKm * SOCIAL.co2eKgPerKm) / 100) / 10);
  assert.equal(line(a, "co2e").seed, 17.9);
  assert.equal(line(a, "jobs").seed, 9);
  assert.equal(line(a, "remote").seed, 1);
  for (const x of a.lines) {
    assert.ok(x.basis.length > 20, `${x.key} has a basis`);
    assert.equal(Math.round((x.seed + x.live) * 10) / 10, x.value, `${x.key}: seed + live = value`);
  }
  assert.ok(a.assumptions.length >= 3);
  for (const s of [...a.assumptions, ...a.lines.map((x) => x.basis)]) assert.ok(!/[–—]/.test(s), "house style: no dashes");
});

test("approved outcomes move the live part; rows of a removed impact record are ignored", () => {
  clean();
  const before = socialLedger();
  const row = { co2eKg: 0, travelKm: 0, jobsRetained: 0, volunteerHours: 0, downtimeHours: 0, peopleIds: [] as string[], basis: "test" };
  recordSocial({ ...row, ref: "TEST-CRISIS", kind: "crisis", impactId: null, co2eKg: 1250, downtimeHours: 6 });
  recordSocial({ ...row, ref: "TEST-VOL", kind: "volunteer", impactId: null, volunteerHours: 16 });
  recordSocial({ ...row, ref: "TEST-GONE", kind: "redeploy", impactId: "IMP-999", jobsRetained: 4 });
  const after = socialLedger();
  assert.equal(line(after, "co2e").live, 1.3);
  assert.equal(line(after, "co2e").value, Math.round((line(before, "co2e").value + 1.3) * 10) / 10);
  assert.equal(line(after, "downtime").live, 6);
  assert.equal(line(after, "volunteer").live, 16);
  assert.equal(line(after, "jobs").value, line(before, "jobs").value, "redeploy row without its impact record is ignored");
  const remotePerson = all<{ id: string }>("SELECT id FROM people WHERE location_id = 'LOC-CNS' ORDER BY id LIMIT 1")[0].id;
  recordSocial({ ...row, ref: "TEST-REMOTE", kind: "crisis", impactId: null, peopleIds: [remotePerson] });
  assert.equal(line(socialLedger(), "remote").live, line(after, "remote").live + 1);
  clean();
  assert.deepEqual(socialLedger(), before);
});

test("statement: the template is grounded, and invented figures are caught", async () => {
  clean();
  const l = socialLedger();
  const facts = JSON.stringify(l.lines.map((x) => ({ line: x.label, value: `${x.value.toLocaleString("en-US")} ${x.unit}`, from_history: x.seed, from_approvals_in_app: x.live, basis: x.basis, note: x.note })));
  const t = templateStatement(l);
  assert.match(t, /17\.9 t CO2e/);
  assert.deepEqual(unsupported(t, facts), []);
  assert.ok(unsupported("We avoided 42 tonnes and saved $3M.", facts).length >= 2);
  const s = await socialStatement(l);
  assert.equal(s.grounded, true);
  assert.ok(s.text.length > 30);
  assert.ok(!/[–—]/.test(s.text));
});
