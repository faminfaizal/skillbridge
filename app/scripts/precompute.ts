// Precompute AI and graph artefacts so the demo opens instantly and identically.
//   1. Hidden-skill inference: LLM proposes, evidence check confirms (cached; reruns are instant)
//   2. Embeddings (Gemini) for skills, opportunities, problem classes
//   3. graph.json: nodes + edges, ForceAtlas2 layout, Louvain communities, betweenness
// Usage (from app/): npm run precompute [-- --skip-llm] [-- --skip-infer] [-- --skip-embed]
// After this, the Connectivity Agent keeps graph.json current incrementally as data changes.
import { all, run, getDb } from "../src/lib/db.ts";
import { embed } from "../src/lib/llm.ts";
import { data, resetData, type Model } from "../src/lib/engine/data.ts";
import { inferPerson } from "../src/lib/engine/inferRun.ts";
import { buildGraph, GRAPH_FILE, writeGraph } from "../src/lib/graphBuild.ts";

const args = new Set(process.argv.slice(2));

// ------------------------------------------------------------------ 1. inference
async function inferSkills(m: Model) {
  run("DELETE FROM inferred_skills");
  const people = [...m.people.keys()];
  let llmOk = 0, total = 0, done = 0;
  const pool = 4;
  for (let i = 0; i < people.length; i += pool) {
    const batch = await Promise.all(people.slice(i, i + pool).map((id) => inferPerson(m, id, !args.has("--skip-llm"))));
    for (const r of batch) {
      total += r.skills.length;
      if (r.skills.length) { done++; if (r.provider !== "rules") llmOk++; }
    }
    process.stdout.write(`\r  inference ${Math.min(i + pool, people.length)}/${people.length} people`);
  }
  console.log(`\n  inferred ${total} skills for ${done} people (LLM explained ${llmOk})`);
}

// ------------------------------------------------------------------ 2. embeddings
async function embeddings() {
  const items: { type: string; id: string; text: string }[] = [
    ...all<{ id: string; name: string; family: string }>("SELECT id, name, family FROM skills").map((s) => ({ type: "skill", id: s.id, text: `${s.name} (${s.family})` })),
    ...all<{ id: string; title: string; demo_query: string | null }>("SELECT id, title, demo_query FROM opportunities").map((o) => ({ type: "opportunity", id: o.id, text: `${o.title}. ${o.demo_query ?? ""}` })),
    ...all<{ id: string; name: string }>("SELECT id, name FROM problem_classes").map((p) => ({ type: "problem", id: p.id, text: p.name })),
  ];
  try {
    const vecs = await embed(items.map((i) => i.text));
    const model = process.env.LLM_EMBED_MODEL ?? "embed";
    for (let i = 0; i < items.length; i++) {
      run("INSERT OR REPLACE INTO embeddings (ref_type, ref_id, model, dims, vector) VALUES (?, ?, ?, ?, ?)",
        items[i].type, items[i].id, model, vecs[i].length, JSON.stringify(vecs[i].map((x) => Math.round(x * 1e5) / 1e5)));
    }
    console.log(`  embedded ${items.length} items (${vecs[0].length} dims)`);
  } catch (e) {
    console.log(`  embeddings skipped: ${(e as Error).message}`);
  }
}

async function main() {
  getDb();
  const t0 = Date.now();
  console.log("SkillBridge precompute");
  if (!args.has("--skip-infer")) await inferSkills(data());
  resetData();
  if (!args.has("--skip-embed")) await embeddings();
  const graph = buildGraph(data());
  writeGraph(graph);
  console.log(`  graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${graph.meta.communities} communities -> ${GRAPH_FILE()}`);
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => { console.error(e); process.exit(1); });
