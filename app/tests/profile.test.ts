// My Profile end to end on the real database: every self-service change lands live in the seeded tables, a manager
// confirms it, and reset restores the seed exactly (counts and the edited rows themselves).
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";

process.env.LLM_DISABLE_VERTEX = "true";
process.env.LLM_MODE = "cache-first";

const { all, get } = await import("../src/lib/db.ts");
const { profileBundle } = await import("../src/lib/me/profile.ts");
const { applyAction, decideForTeam, resetProfiles, BadInput } = await import("../src/lib/me/write.ts");
const { uploadDocument, zipEntry, ruleSuggestions } = await import("../src/lib/me/documents.ts");

const ME = "P-075"; // Hafiz Rahman
const BOSS = "P-072"; // Faiz Yusof, his manager

const counts = () => Object.fromEntries(["person_skills", "person_certs", "projects", "project_skills", "assignments", "peer_recognition"]
  .map((t) => [t, get<{ n: number }>(`SELECT COUNT(*) n FROM ${t}`)!.n]));
const personRow = () => get<Record<string, unknown>>("SELECT * FROM people WHERE id = ?", ME);
const skillsOf = (id: string) => all<Record<string, unknown>>("SELECT * FROM person_skills WHERE person_id = ? ORDER BY skill_id", id);
let baseline: Record<string, number>;
let basePerson: Record<string, unknown> | undefined;
let baseSkills: Record<string, unknown>[];

before(() => {
  resetProfiles();
  baseline = counts();
  basePerson = personRow();
  baseSkills = skillsOf(ME);
});

after(() => {
  resetProfiles();
  assert.deepEqual(counts(), baseline, "seed table counts restored");
  assert.deepEqual(personRow(), basePerson, "people row restored");
  assert.deepEqual(skillsOf(ME), baseSkills, "skills restored, including edited levels");
  assert.equal(get<{ n: number }>("SELECT COUNT(*) n FROM profile_trace")!.n, 0);
});

test("the bundle is prefilled from ERA, projects and AI suggestions", () => {
  const b = profileBundle(ME)!;
  assert.equal(b.me.name, "Hafiz Rahman");
  assert.equal(b.me.manager?.id, BOSS);
  assert.ok(b.skills.length >= 5, "declared skills");
  assert.ok(b.projects.system.length >= 1, "projects from the project records");
  assert.ok(b.suggestions.length >= 1, "AI-suggested hidden skills to confirm");
  assert.ok(b.catalog.skills.length > 100 && b.catalog.people.length > 200);
  assert.ok(b.completeness.pct >= 0 && b.completeness.pct <= 100 && b.completeness.next);
  assert.equal(profileBundle(BOSS)!.team?.reports.some((r) => r.id === ME), true, "Faiz manages Hafiz");
});

test("skills: add, edit level, manager confirms, remove", () => {
  const sid = "SK-kubernetes";
  assert.ok(!skillsOf(ME).some((s) => s.skill_id === sid));
  applyAction(ME, "skills", "add", { skillId: sid, level: 2 });
  assert.equal(get<{ source: string }>("SELECT source FROM person_skills WHERE person_id = ? AND skill_id = ?", ME, sid)!.source, "self");
  assert.ok(profileBundle(BOSS)!.team!.skills.some((s) => s.skillId === sid), "pending in the manager's queue");
  decideForTeam(BOSS, "skill", { personId: ME, skillId: sid, decision: "confirm" });
  assert.equal(get<{ source: string }>("SELECT source FROM person_skills WHERE person_id = ? AND skill_id = ?", ME, sid)!.source, "validated");
  const seeded = baseSkills[0].skill_id as string;
  applyAction(ME, "skills", "update", { skillId: seeded, level: 5, wantGrow: true });
  assert.equal(get<{ level: number }>("SELECT level FROM person_skills WHERE person_id = ? AND skill_id = ?", ME, seeded)!.level, 5);
  applyAction(ME, "skills", "remove", { skillId: sid });
  assert.ok(!skillsOf(ME).some((s) => s.skill_id === sid));
  assert.throws(() => applyAction(ME, "skills", "add", { skillId: "SK-nope", level: 3 }), BadInput);
  assert.throws(() => applyAction(ME, "skills", "add", { skillId: seeded, level: 3 }), /already on your profile/);
});

test("projects: a self-reported entry becomes a real project once the manager confirms it", () => {
  assert.throws(() => applyAction(ME, "projects", "add", { name: "X", type: "POC", role: "Lead", start: "2026-13" }), /month you started/);
  applyAction(ME, "projects", "add", { name: "OLT auto-test POC", type: "POC", role: "Builder", start: "2026-02", end: "2026-04",
    effort: "5 to 20 days", contribution: "Wrote Python scripts that test OLT ports", skills: ["SK-python"] });
  const e = profileBundle(ME)!.projects.own[0];
  assert.equal(e.status, "pending");
  assert.ok(skillsOf(ME).some((s) => s.skill_id === "SK-python" && s.source === "self"), "skills used were added as self-declared");
  assert.throws(() => decideForTeam("P-210", "project", { id: e.id, decision: "confirm" }), /direct reports/);
  assert.throws(() => decideForTeam(BOSS, "project", { id: e.id, decision: "decline" }), /Tell them why/);
  decideForTeam(BOSS, "project", { id: e.id, decision: "confirm" });
  const own = profileBundle(ME)!.projects;
  assert.equal(own.own[0].status, "confirmed");
  assert.ok(own.system.some((s) => s.self && s.name === "OLT auto-test POC"), "now listed with the project records");
  assert.ok(get("SELECT 1 FROM assignments WHERE person_id = ? AND project_id LIKE 'SELF-PRJ-%'", ME));
  applyAction(ME, "projects", "remove", { id: e.id });
  assert.ok(!get("SELECT 1 FROM assignments WHERE person_id = ? AND project_id LIKE 'SELF-PRJ-%'", ME));
});

test("people: feedback and go-to nominations become peer recognition", () => {
  const before = get<{ n: number }>("SELECT COUNT(*) n FROM peer_recognition WHERE to_id = 'P-210'")!.n;
  applyAction(ME, "feedback", "give", { toId: "P-210", question: "Who helped your team succeed?", text: "Fixed our billing feed" });
  applyAction(ME, "connections", "add", { otherId: "P-210", kind: "goto", skillId: "SK-python" });
  assert.equal(get<{ n: number }>("SELECT COUNT(*) n FROM peer_recognition WHERE to_id = 'P-210'")!.n, before + 2);
  assert.ok(profileBundle("P-210")!.feedback.received.some((r) => r.text === "Fixed our billing feed"));
  const c = profileBundle(ME)!.connections.own[0];
  applyAction(ME, "connections", "remove", { id: c.id });
  assert.equal(get<{ n: number }>("SELECT COUNT(*) n FROM peer_recognition WHERE to_id = 'P-210'")!.n, before + 1);
});

test("availability and privacy update the person record live", () => {
  applyAction(ME, "availability", "save", { pct: 40, openProjects: true });
  applyAction(ME, "privacy", "consent", { consent: false });
  const p = personRow()!;
  assert.equal(p.availability_pct, 40);
  assert.equal(p.consent_visibility, 0);
  assert.throws(() => applyAction(ME, "availability", "save", { pct: 33 }), /steps of 5/);
});

test("AI suggestion confirmed becomes a profile skill", () => {
  const s = profileBundle(ME)!.suggestions[0];
  applyAction(ME, "suggestions", "decide", { skillId: s.skillId, decision: "confirm", level: 3 });
  assert.equal(get<{ source: string }>("SELECT source FROM person_skills WHERE person_id = ? AND skill_id = ?", ME, s.skillId)!.source, "confirmed");
  assert.ok(!profileBundle(ME)!.suggestions.some((x) => x.skillId === s.skillId));
});

test("constellation: own graph in two rings, profile-only links dashed, opted-out colleagues masked", async () => {
  const { constellation } = await import("../src/lib/me/constellation.ts");
  const c = constellation(ME)!;
  const center = c.nodes.find((n) => n.ring === 0)!;
  assert.equal(center.id, ME);
  const r1 = c.nodes.filter((n) => n.ring === 1);
  assert.ok(r1.some((n) => n.type === "skill") && r1.some((n) => n.type === "project"), "skills and projects on the inner ring");
  assert.ok(r1.some((n) => n.id === BOSS && n.rel), "manager linked from ERA");
  assert.ok(c.nodes.some((n) => n.ring === 2), "outer ring from project links");
  assert.ok(c.edges.every((e) => c.nodes.some((n) => n.id === e.source) && c.nodes.some((n) => n.id === e.target)), "no dangling edges");
  assert.ok(c.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)));
  applyAction(ME, "projects", "add", { name: "Constellation POC", type: "POC", role: "Lead", start: "2026-01" });
  const c2 = constellation(ME)!;
  const pp = c2.nodes.find((n) => n.label === "Constellation POC")!;
  assert.ok(pp.profileOnly && c2.edges.some((e) => e.target === pp.id && e.style === "profile"), "pending entry drawn as profile-only");
  const priv = constellation("P-028")!.nodes.find((n) => n.id === "P-027");
  if (priv) assert.equal(priv.label, "Private colleague", "opted-out colleague is masked");
});

test("documents: DOCX text is read and skills are suggested with a quote", async () => {
  const xml = "<w:document><w:body><w:p><w:r><w:t>Built Kubernetes clusters and wrote Python automation for OLT testing.</w:t></w:r></w:p></w:body></w:document>";
  const zipped = zlib.deflateRawSync(Buffer.from(xml));
  const name = Buffer.from("word/document.xml");
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(zipped.length, 18); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(zipped.length, 20); central.writeUInt16LE(name.length, 28);
  const cdOffset = local.length + name.length + zipped.length;
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(central.length + name.length, 12); eocd.writeUInt32LE(cdOffset, 16);
  const docx = Buffer.concat([local, name, zipped, central, name, eocd]);
  assert.match(zipEntry(docx, "word/document.xml")!.toString(), /Kubernetes clusters/);
  assert.ok(ruleSuggestions("Wrote Python automation").some((s) => s.skillId === "SK-python"));

  const r = await uploadDocument(ME, new File([docx], "cv.docx"), "CV");
  assert.match(r.message, /skill/);
  const doc = profileBundle(ME)!.documents[0];
  const k8s = doc.suggestions.find((s) => s.skillId === "SK-kubernetes")!;
  assert.match(k8s.quote, /Kubernetes/);
  applyAction(ME, "documents", "suggestion", { docId: doc.id, skillId: "SK-kubernetes", decision: "accept", level: 4 });
  assert.equal(get<{ source: string }>("SELECT source FROM person_skills WHERE person_id = ? AND skill_id = 'SK-kubernetes'", ME)!.source, "cv");
  await assert.rejects(uploadDocument(ME, new File(["x"], "cv.exe"), "CV"), /PDF, DOCX or TXT/);
});
