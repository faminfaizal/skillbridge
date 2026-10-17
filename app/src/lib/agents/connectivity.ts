// Connectivity Agent: triggered by the change log. Turns raw records into contribution events, re-infers hidden skills
// for the people involved, updates the graph without moving what is already there, re-scans every lens and publishes
// the diff for the other agents.
import { all, run } from "../db.ts";
import { bumpDataVersion } from "../cacheVersion.ts";
import { data } from "../engine/data.ts";
import { inferPerson } from "../engine/inferRun.ts";
import { buildGraph, readGraph, writeGraph } from "../graphBuild.ts";
import { diff, snapshot, type GraphDiff, type Snapshot } from "./snapshot.ts";
import { finishRun, markProcessed, startRun, today, type ChangeEvent, type Step } from "./store.ts";

const CONTRIBUTION: Record<string, string> = {
  assignment: "joined_project", incident_resolved: "resolved_incident", customer_case: "resolved_case",
  knowledge: "published_knowledge", recognition: "recognised",
};

export interface ConnectivityResult { runId: number; diff: GraphDiff; after: Snapshot; newNodes: string[]; newEdges: number; people: string[] }

async function timed<T>(steps: Step[], tool: string, fn: () => Promise<T> | T, detail: (r: T) => string, ai = false): Promise<T> {
  const t = Date.now();
  const r = await fn();
  steps.push({ tool, detail: detail(r), ms: Date.now() - t, ai });
  return r;
}

export async function runConnectivity(events: ChangeEvent[], before: Snapshot): Promise<ConnectivityResult> {
  const kinds = events.reduce<Record<string, number>>((a, e) => ({ ...a, [e.kind]: (a[e.kind] ?? 0) + 1 }), {});
  const runId = startRun("connectivity", Object.entries(kinds).map(([k, n]) => `${n} ${k.replace(/_/g, " ")}`).join(", "), events.map((e) => e.id));
  const steps: Step[] = [];
  steps.push({ tool: "Read change log", detail: `${events.length} new record${events.length === 1 ? "" : "s"} from database triggers`, ms: 0 });
  let provider = "rules";
  try {
    // 1. raw records -> contribution events (what the people lenses read)
    const people = [...new Set(events.flatMap((e) => (e.person_ids ? e.person_ids.split(",") : [])).filter(Boolean))];
    await timed(steps, "Contribution events", () => {
      let n = 0;
      for (const e of events) {
        const kind = CONTRIBUTION[e.kind];
        if (!kind || !e.person_ids) continue;
        for (const pid of e.person_ids.split(",")) {
          run("INSERT OR IGNORE INTO events (id, person_id, kind, ref_id, date) VALUES (?, ?, ?, ?, ?)", `SIM-EV-${e.id}-${pid}`, pid, kind, e.entity_id, today());
          n++;
        }
      }
      return n;
    }, (n) => `${n} contribution event${n === 1 ? "" : "s"} recorded for ${people.length} ${people.length === 1 ? "person" : "people"}`);

    // 2. hidden skills, only for the people whose records changed
    bumpDataVersion();
    const inferred = await timed(steps, "Hidden-skill inference", async () => {
      const m = data();
      const out: string[] = [];
      for (const pid of people.filter((id) => m.people.has(id))) {
        const before = new Set(all<{ s: string }>("SELECT skill_id s FROM inferred_skills WHERE person_id = ?", pid).map((r) => r.s));
        const r = await inferPerson(m, pid, true);
        if (r.provider !== "rules") provider = r.provider;
        for (const s of r.skills) if (!before.has(s.skillId)) out.push(`${m.people.get(pid)!.name}: ${m.skills.get(s.skillId)?.name}`);
      }
      return out;
    }, (out) => people.length ? `${people.length} ${people.length === 1 ? "person" : "people"} re-read; ${out.length ? `new: ${out.join("; ")}` : "no new skills"}` : "no people affected", true);
    void inferred;

    // 3. graph: rebuild nodes and links from the data, keep every existing position
    bumpDataVersion();
    const g = await timed(steps, "Graph update", () => {
      const prev = readGraph();
      const pinned = new Map((prev?.nodes ?? []).map((n) => [n.id, { x: n.x, y: n.y }]));
      const next = buildGraph(data(), { pinned: pinned.size ? pinned : undefined });
      const prevEdges = new Set((prev?.edges ?? []).map((e) => e.id));
      const newNodes = next.nodes.filter((n) => !pinned.has(n.id)).map((n) => n.id);
      const newEdges = next.edges.filter((e) => !prevEdges.has(e.id));
      writeGraph(next);
      return { newNodes, newEdges, total: next.edges.length };
    }, (r) => `+${r.newNodes.length} node${r.newNodes.length === 1 ? "" : "s"}, +${r.newEdges.length} link${r.newEdges.length === 1 ? "" : "s"} (positions kept)`);

    // 4. every lens re-scanned; the diff is what the other agents react to
    const scan = await timed(steps, "Lens re-scan", () => {
      const after = snapshot();
      return { after, d: diff(before, after) };
    }, ({ d }) => `${d.count} change${d.count === 1 ? "" : "s"} across people signals, risks and opportunities`);

    markProcessed(events.map((e) => e.id));
    const touched = [...new Set([...g.newNodes, ...g.newEdges.flatMap((e) => [e.source, e.target])])];
    const summary = `${events.length} change${events.length === 1 ? "" : "s"}: +${g.newNodes.length} nodes, +${g.newEdges.length} links, ${scan.d.inferred.length} new inferred skill${scan.d.inferred.length === 1 ? "" : "s"}, ${scan.d.count} lens change${scan.d.count === 1 ? "" : "s"}.`;
    finishRun(runId, "done", steps, summary, provider, touched);
    return { runId, diff: scan.d, after: scan.after, newNodes: g.newNodes, newEdges: g.newEdges.length, people };
  } catch (e) {
    finishRun(runId, "failed", steps, `Failed: ${(e as Error).message}`, provider);
    throw e;
  }
}
