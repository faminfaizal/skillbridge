// Concierge agent, offline: routing, the rule-based planner (used when no model can call tools), the grounding check
// and privacy. Live Gemini function calling is covered by the warm-up script against the server.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

process.env.LLM_DISABLE_VERTEX = "true";
process.env.LLM_MODE = "cache-first";

const { ask } = await import("../src/lib/engine/ask.ts");
const { conciergeRule, ungrounded } = await import("../src/lib/agents/concierge.ts");
const { TOOLS } = await import("../src/lib/agents/conciergeTools.ts");
const { all } = await import("../src/lib/db.ts");
const { EXEC_QUESTIONS } = await import("../src/lib/questions.ts");

const manifest = Object.fromEntries(
  JSON.parse(fs.readFileSync("../data/seed/story_manifest.json", "utf-8")).map((x: { anchor: string; expected: any }) => [x.anchor, x.expected]),
);

test("routing: Concierge questions go to the Concierge; demo staffing and executive questions keep their paths", async () => {
  for (const q of ["Who is rising fast, and is anything waiting for my approval?", "Tell me about Hafiz Rahman", "What happens if Priya Nair leaves?", "What did the agents find today?"])
    assert.ok(conciergeRule(q), q);
  const demo = all<{ demo_query: string }>("SELECT demo_query FROM opportunities WHERE demo_query IS NOT NULL").map((r) => r.demo_query);
  for (const q of demo) assert.equal((await ask(q)).kind, "team", q);
  assert.equal((await ask(EXEC_QUESTIONS.gaps)).kind, "exec");
});

test("offline, the planner calls the right tools and answers from their results only", async () => {
  const r = await ask("Who is rising fast, and is anything waiting for my approval?");
  assert.equal(r.kind, "concierge");
  if (r.kind !== "concierge") return;
  assert.equal(r.mode, "planned");
  const tools = r.steps.map((s) => s.tool);
  assert.ok(tools.includes("people_signal") && tools.includes("agent_inbox"), tools.join(","));
  assert.ok(r.grounded);
  assert.ok(r.refs.some((x) => x.id === manifest.A2.person_id), "Priya linked");
  assert.ok(r.steps.some((s) => s.tool === "grounding check"));
});

test("what-if by name resolves the person and reports the blast radius", async () => {
  const r = await ask("What happens if Priya Nair leaves?");
  assert.equal(r.kind, "concierge");
  if (r.kind !== "concierge") return;
  assert.ok(r.steps.some((s) => s.tool === "what_if" && /systems? hit/.test(s.result)));
  assert.ok(r.highlight.nodeIds.includes(manifest.A3.system_id));
});

test("grounding: a figure the tools never returned is caught; equivalent USD formats are accepted", () => {
  assert.deepEqual(ungrounded("Saves $170k.", "hold saves $168k"), ["$170k"]);
  assert.deepEqual(ungrounded("Saves $168,000 (81%).", "$168k ... 81% of incidents"), []);
  assert.deepEqual(ungrounded("Rose to 92%.", "81% of incidents"), ["92%"]);
});

test("privacy: people who opted out cannot be found or profiled by the Concierge", async () => {
  const star = manifest.A17.opted_out_star as string;
  const name = all<{ name: string }>("SELECT name FROM people WHERE id = ?", star)[0].name;
  const found = await TOOLS.find_people.run({ query: name });
  assert.ok(!found.refs.some((x) => x.id === star));
  const prof = await TOOLS.get_person.run({ person: star });
  assert.match(JSON.stringify(prof.facts), /private profile/);
});
