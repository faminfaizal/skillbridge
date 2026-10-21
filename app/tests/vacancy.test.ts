// Positions and "Job vacancy to fill", offline: posts come from the seed, matches from the deterministic engine,
// opted-out people and grade C never appear, and a job description is read by keyword rules when Gemini is off.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.LLM_DISABLE_VERTEX = "true";

const { get } = await import("../src/lib/db.ts");
const { data } = await import("../src/lib/engine/data.ts");
const { positionOf, positionById, positionRequirement, searchPositions } = await import("../src/lib/engine/positions.ts");
const { matchVacancy, normaliseVacancy } = await import("../src/lib/engine/vacancy.ts");
const { BadInput } = await import("../src/lib/engine/intake.ts");

const sid = (name: string) => data().skillByName.get(name.toLowerCase())!.id;

test("every person has a post; Priya Nair's post carries required skills and reports to her manager's post", () => {
  const p = positionOf("P-210")!;
  assert.equal(p.id, "POS-210");
  assert.equal(p.title, "Assistant Manager, Billing Operations");
  assert.ok(p.skills.filter((s) => s.must).length >= 2);
  assert.ok(p.responsibilities.length >= 3 && p.competencies.length >= 2);
  const mgr = data().people.get("P-210")!.manager_id!;
  assert.equal(p.reportsTo?.id, `POS-${mgr.slice(2)}`);
  const req = positionRequirement(p);
  assert.deepEqual(req.must.sort(), p.skills.filter((s) => s.must).map((s) => s.skillId).sort());
});

test("an existing post leaves out its holder, opted-out people and grade C", () => {
  const r = matchVacancy({ positionId: "POS-210", title: "", must: [], nice: [] });
  const m = data();
  assert.ok(r.shortlist.length > 0 && r.shortlist.length <= 8);
  for (const c of r.shortlist) {
    assert.notEqual(c.personId, "P-210");
    assert.equal(m.people.get(c.personId)!.consent_visibility, 1);
    assert.notEqual(m.people.get(c.personId)!.level, "C");
  }
  assert.equal(r.vacancy.titleShown, "Assistant Manager, Billing Operations");
});

test("a typed vacancy ranks deterministically and splits ready now at the fill threshold", () => {
  const v = { title: "Network analytics lead", level: "AM", must: [sid("Network Telemetry"), sid("Python"), sid("Data Engineering")], nice: [sid("Machine Learning")] };
  const a = matchVacancy(v);
  const b = matchVacancy(v);
  assert.deepEqual(a.shortlist.map((x) => x.personId), b.shortlist.map((x) => x.personId));
  const t = Number(data().finance.role_fill_threshold ?? 0.7);
  for (const c of a.shortlist) {
    assert.equal(c.readyNow, c.score >= t);
    if (!c.readyNow) assert.ok(c.gaps.length >= 0);
    assert.ok(["lateral", "step up", "stretch", "step down"].includes(c.move));
  }
  for (let i = 1; i < a.shortlist.length; i++) assert.ok(a.shortlist[i - 1].score >= a.shortlist[i].score);
});

test("grade move compares the candidate's grade with the vacancy grade", () => {
  const r = matchVacancy({ title: "Billing lead", level: "AM", must: [sid("Billing Systems"), sid("SQL")], nice: [] });
  const m = data();
  for (const c of r.shortlist) {
    const d = m.people.get(c.personId)!.level_rank - 5; // AM is rank 5
    assert.equal(c.move, d === 0 ? "lateral" : d === 1 ? "step up" : d >= 2 ? "stretch" : "step down");
  }
});

test("normaliseVacancy: nice-only becomes must, duplicates collapse to must, unknown ids drop, empty is refused", () => {
  const ml = sid("Machine Learning");
  const py = sid("Python");
  assert.deepEqual(normaliseVacancy({ title: "x", must: [], nice: [ml] }).must, [ml]);
  const d = normaliseVacancy({ title: "x", must: [py, py], nice: [py, ml, "SK-nope"] });
  assert.deepEqual(d.must, [py]);
  assert.deepEqual(d.nice, [ml]);
  assert.throws(() => normaliseVacancy({ title: "x", must: ["SK-nope"], nice: [] }), BadInput);
});

test("an unknown post is refused", () => {
  assert.throws(() => matchVacancy({ positionId: "POS-999", title: "", must: [], nice: [] }), BadInput);
});

test("post search finds by title, post id and name, but never names an opted-out holder", () => {
  assert.ok(searchPositions("billing").length > 0);
  assert.equal(searchPositions("POS-210")[0]?.id, "POS-210");
  assert.equal(searchPositions("Priya Nair")[0]?.personId, "P-210");
  const hidden = get<{ id: string; name: string }>("SELECT id, name FROM people WHERE consent_visibility = 0 LIMIT 1")!;
  assert.equal(searchPositions(hidden.name).length, 0);
  const post = positionById(`POS-${hidden.id.slice(2)}`)!;
  assert.equal(post.holder, null);
});

const fs = await import("node:fs");
const { readVacancy, rulesVacancy } = await import("../src/lib/engine/jd.ts");
const SAMPLE = "public/samples/position-profile-network-analytics-lead.docx";

test("the sample position profile is never blank with Gemini off: golden cache, else keyword rules", async () => {
  const r = await readVacancy({ filename: "profile.docx", data: fs.readFileSync(SAMPLE) });
  assert.ok(r.provider === "cache" || r.provider === "rules", r.provider);
  assert.equal(r.parsed.title, "Network Analytics Lead");
  for (const n of ["Network Telemetry", "Python", "Machine Learning"]) assert.ok(r.parsed.must.includes(sid(n)), n);
  assert.ok((r.parsed.responsibilities ?? []).length >= 3);
  assert.ok(matchVacancy(r.parsed).shortlist.length > 0);
});

test("keyword rules alone read the sample: title, bullet responsibilities and required skills", async () => {
  const { readText } = await import("../src/lib/me/documents.ts");
  const v = rulesVacancy(await readText(".docx", fs.readFileSync(SAMPLE)));
  assert.equal(v.title, "Network Analytics Lead");
  for (const n of ["Network Telemetry", "Python", "Machine Learning"]) assert.ok(v.must.includes(sid(n)), n);
  assert.ok((v.responsibilities ?? []).length >= 3);
});

test("text with no skill words yields no skills, and matching it is refused", () => {
  const v = rulesVacancy("Position: Office helper\n- Keep the kitchen tidy\n- Water the plants");
  assert.equal(v.must.length, 0);
  assert.throws(() => normaliseVacancy(v), BadInput);
});

test("wrong file types, oversize and empty files are refused", async () => {
  await assert.rejects(readVacancy({ filename: "jd.exe", data: Buffer.from("x") }), BadInput);
  await assert.rejects(readVacancy({ filename: "jd.txt", data: Buffer.alloc(6 * 1024 * 1024, 65) }), BadInput);
  await assert.rejects(readVacancy({ filename: "jd.txt", data: Buffer.alloc(0) }), BadInput);
});
