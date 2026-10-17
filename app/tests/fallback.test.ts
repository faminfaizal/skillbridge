// Fallback chain: with both providers disabled, cached answers are served and the narrative falls back to a template.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.LLM_DISABLE_VERTEX = "true";

const { chatJson, cacheKey } = await import("../src/lib/llm.ts");
const { run } = await import("../src/lib/db.ts");
const { narrative } = await import("../src/lib/engine/explain.ts");

test("cached answer is served when both providers are down", async () => {
  const key = cacheKey("chat", "test-system", "test-user");
  run("INSERT OR REPLACE INTO llm_cache (key, model, provider, response, created_at) VALUES (?, 'test', 'vertex', ?, 'now')", key, JSON.stringify({ ok: 1 }));
  const r = await chatJson<{ ok: number }>("chat", "test-system", "test-user");
  assert.equal(r.provider, "cache");
  assert.equal(r.data.ok, 1);
  run("DELETE FROM llm_cache WHERE key = ?", key);
});

test("uncached request fails cleanly when both providers are down", async () => {
  await assert.rejects(() => chatJson("chat", "never-cached", String(Date.now())));
});

test("narrative falls back to the template with the engine's numbers", async () => {
  const gap = { role: "MLOps Engineer", skills: ["MLOps"], bestScore: 0.5, reskill: [] };
  const r = await narrative("Unique test request " + Date.now(), [], [gap], {
    costAvoided: 120000, productivity: 45000, revenuePotential: 300000, recruitmentAvoided: 0, assumptions: [], estimated: false,
  });
  assert.equal(r.provider, "template");
  assert.match(r.text, /\$120k/);
});

test("executive questions are answered offline, team requests still form teams", async () => {
  const { ask } = await import("../src/lib/engine/ask.ts");
  const e = await ask("Where are we over-dependent on individuals?");
  assert.equal(e.kind, "exec");
  if (e.kind === "exec") {
    assert.equal(e.intent, "dependency");
    assert.ok(["cache", "template"].includes(e.provider));
    assert.ok(e.narrative.length > 20);
  }
  const t = await ask("Can we offer smart campus video analytics without hiring?");
  assert.equal(t.kind, "team");
});

test("a request with no recognisable skills asks the user to name them", async () => {
  const r = await narrative("??", [], [], { costAvoided: 0, productivity: 0, revenuePotential: 0, recruitmentAvoided: 0, assumptions: [], estimated: true });
  assert.equal(r.provider, "template");
  assert.match(r.text, /Try naming/);
});
