// Concierge conversation memory, offline: follow-up detection, memory with Firestore unreachable, follow-ups routed to
// the Concierge with history, and standalone questions routed (and prompted) exactly as before.
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

process.env.LLM_DISABLE_VERTEX = "true";
process.env.LLM_MODE = "cache-first";

const { ask } = await import("../src/lib/engine/ask.ts");
const mem = await import("../src/lib/cloud/memory.ts");
const { conciergeMessages, CONCIERGE_SYSTEM } = await import("../src/lib/agents/concierge.ts");
const { all } = await import("../src/lib/db.ts");
const { EXEC_QUESTIONS } = await import("../src/lib/questions.ts");

const turn = (q: string, at = Date.now()) => ({ q, a: `answer to ${q}`, kind: "concierge", tools: ["people_signal"], evidence: "{\"n\": 3}", at });
const manifest = Object.fromEntries(
  JSON.parse(fs.readFileSync("../data/seed/story_manifest.json", "utf-8")).map((x: { anchor: string; expected: any }) => [x.anchor, x.expected]),
);

beforeEach(() => { mem.clearMemory(); mem.useRemote(null); });
after(() => { mem.useRemote(undefined); mem.clearMemory(); });

test("follow-up detection: leans on the last turn and only within 10 minutes", () => {
  const recent = [turn("Who is rising fastest?")];
  for (const q of ["And who is overloaded?", "What about the bridges?", "How about Sales?", "Who else could help?", "Why?", "Tell me more", "same for Asia",
    "Are they available?", "Is her team overloaded?", "Which of those can lead?", "Tell me about that one"])
    assert.ok(mem.isFollowUp(q, recent), q);
  for (const q of ["Who is rising fastest?", "Where are our biggest capability gaps?", "Anderson report", "Brandon review",
    "Build a team for the billing migration so they can start in May"]) assert.ok(!mem.isFollowUp(q, recent), q);
  assert.ok(!mem.isFollowUp("What about them?", []), "no earlier turn");
  assert.ok(!mem.isFollowUp("What about them?", [turn("x", Date.now() - 11 * 60_000)]), "older than 10 minutes");
});

test("memory works with Firestore unreachable: in-process turns survive, unknown sessions answer none within the cap", async () => {
  let saves = 0;
  mem.useRemote({ load: () => new Promise(() => {}), save: async () => { saves++; throw new Error("unreachable"); } });
  for (let i = 0; i < 8; i++) mem.remember("sess-unreachable-1", { ...turn(`q${i}`), a: "x".repeat(900), evidence: "e".repeat(5000) });
  const r = await mem.recall("sess-unreachable-1");
  assert.equal(r.source, "memory");
  assert.equal(r.turns.length, 6, "keeps the last 6 turns");
  assert.equal(r.turns[5].q, "q7");
  assert.equal(r.turns[0].a.length, 600);
  assert.equal(r.turns[0].evidence.length, 3000);
  const t = Date.now();
  const none = await mem.recall("sess-never-seen-1");
  assert.equal(none.source, "none");
  assert.ok(Date.now() - t < 1600, `read capped (${Date.now() - t} ms)`);
  await new Promise((res) => setTimeout(res, 20));
  assert.ok(saves >= 1, "writes were attempted in the background and their failure swallowed");
  assert.equal((await mem.recall("bad id!")).source, "none");
});

test("a session restored from the remote store reports source firestore", async () => {
  mem.useRemote({ load: async () => [turn("Who is rising fastest?")], save: async () => {} });
  const r = await mem.recall("sess-remote-0001");
  assert.equal(r.source, "firestore");
  assert.equal(r.turns.length, 1);
});

test("standalone questions build exactly the messages they did before; follow-ups add the last 3 text pairs", () => {
  const q = "Who is rising fast, and is anything waiting for my approval?";
  assert.deepEqual(conciergeMessages(q), [{ role: "system", content: CONCIERGE_SYSTEM }, { role: "user", content: q }]);
  const h = [turn("q1"), turn("q2"), turn("q3"), turn("q4")];
  const m = conciergeMessages("And them?", h);
  assert.equal(m.length, 8);
  assert.deepEqual(m.slice(1, 3), [{ role: "user", content: "q2" }, { role: "assistant", content: "answer to q2" }]);
  assert.ok(m.every((x) => !x.tool_calls && !x.parts), "text only, no tool parts");
});

test("a follow-up routes to the Concierge with history; standalone questions route as before", async () => {
  const sid = "test-session-0001";
  const first = await ask("Who is rising fast?", { sessionId: sid });
  assert.equal(first.kind, "concierge");
  if (first.kind !== "concierge") return;
  assert.equal(first.memory, undefined, "a first question uses no memory");

  const follow = await ask("Are any of them overloaded?", { sessionId: sid });
  assert.equal(follow.kind, "concierge");
  if (follow.kind !== "concierge") return;
  assert.deepEqual(follow.memory, { turns: 1, source: "memory" });
  assert.ok(follow.steps.some((s) => s.tool === "Conversation memory"));
  const tools = follow.steps.map((s) => s.tool);
  assert.ok(tools.includes("people_signal"), tools.join(","));
  assert.ok(follow.grounded);
  assert.ok(follow.refs.some((x) => x.id === manifest.A2.person_id), "the rising list from the earlier question is used again");

  // standalone: same kind with and without a session, and no memory
  const demo = all<{ demo_query: string }>("SELECT demo_query FROM opportunities WHERE demo_query IS NOT NULL LIMIT 1")[0].demo_query;
  assert.equal((await ask(demo, { sessionId: sid })).kind, "team");
  const exec = await ask(EXEC_QUESTIONS.gaps, { sessionId: sid });
  assert.equal(exec.kind, "exec");
  const plain = await ask("What did the agents find today?", { sessionId: sid });
  assert.equal(plain.kind, "concierge");
  if (plain.kind === "concierge") assert.equal(plain.memory, undefined);
  const r = await mem.recall(sid);
  assert.deepEqual(r.turns.map((t) => t.kind), ["concierge", "concierge", "team", "exec", "concierge"], "every answer kind is remembered");

  // no session id: never a follow-up
  const anon = await ask("Are any of them overloaded?");
  if (anon.kind === "concierge") assert.equal(anon.memory, undefined);
});
