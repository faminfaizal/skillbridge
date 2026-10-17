// Capability graph builder, shared by the precompute script (full layout) and the Connectivity Agent (incremental:
// existing nodes keep their positions, new nodes are placed beside their neighbours, so the picture never jumps).
import fs from "node:fs";
import path from "node:path";
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import louvain from "graphology-communities-louvain";
import betweenness from "graphology-metrics/centrality/betweenness.js";
import { all } from "./db.ts";
import type { Model } from "./engine/data.ts";
import type { GraphData, GraphEdge, GraphNode } from "./types.ts";

export const GRAPH_FILE = () => path.resolve(process.cwd(), "../data/graph.json");

export function readGraph(): GraphData | null {
  try {
    return JSON.parse(fs.readFileSync(GRAPH_FILE(), "utf-8")) as GraphData;
  } catch {
    return null;
  }
}

export function writeGraph(g: GraphData): void {
  const file = GRAPH_FILE();
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(g));
  fs.renameSync(`${file}.tmp`, file);
}

function rng(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

/** pinned: positions from the previous graph; when given, no force layout runs (incremental update). */
export function buildGraph(m: Model, opts: { pinned?: Map<string, { x: number; y: number }> } = {}): GraphData {
  const g = new Graph({ multi: false, type: "undirected" });
  const nodes = new Map<string, Omit<GraphNode, "x" | "y" | "community">>();
  const edges: GraphEdge[] = [];
  const addNode = (n: Omit<GraphNode, "x" | "y" | "community">) => { if (!nodes.has(n.id)) nodes.set(n.id, n); };
  const addEdge = (type: string, source: string, target: string, weight = 1, evidence: "verified" | "inferred" = "verified", refs: string[] = [], id?: string) => {
    if (!nodes.has(source) || !nodes.has(target) || source === target) return;
    edges.push({ id: id ?? `${type}:${source}:${target}`, source, target, type, weight, evidence, sourceRecordIds: refs });
  };

  for (const d of all<{ id: string; name: string }>("SELECT id, name FROM divisions")) addNode({ id: d.id, type: "division", label: d.name, size: 10, attrs: {} });
  for (const d of all<{ id: string; name: string; division_id: string }>("SELECT * FROM departments")) addNode({ id: d.id, type: "department", label: d.name, size: 6, attrs: { division: d.division_id } });
  const inferredBy = new Map<string, number>();
  for (const r of all<{ person_id: string; n: number }>("SELECT person_id, COUNT(*) n FROM inferred_skills GROUP BY person_id")) inferredBy.set(r.person_id, r.n);
  for (const p of m.people.values()) {
    const projects = new Set((m.assignments.get(p.id) ?? []).map((a) => a.project_id)).size;
    addNode({ id: p.id, type: "person", label: p.name, size: 3 + Math.min(6, projects * 1.2) + (9 - p.level_rank) * 0.4,
      attrs: { title: p.title, level: p.level, department: p.department_id, division: p.division_id, location: m.locations.get(p.location_id) ?? "",
        consent: p.consent_visibility === 1, inferredSkills: inferredBy.get(p.id) ?? 0, retirementRisk: p.retirement_risk === 1, projects } });
  }
  for (const s of m.skills.values()) addNode({ id: s.id, type: "skill", label: s.name, size: 2.5, attrs: { family: s.family, emerging: s.emerging === 1 } });
  for (const p of m.projects.values()) addNode({ id: p.id, type: "project", label: p.name, size: 5, attrs: { status: p.status, division: p.division_id } });
  for (const s of all<{ id: string; name: string; criticality: string; kind: string }>("SELECT * FROM systems"))
    addNode({ id: s.id, type: "system", label: s.name, size: s.criticality === "critical" ? 8 : 6, attrs: { criticality: s.criticality, kind: s.kind } });
  for (const o of all<{ id: string; name: string; kind: string; sector: string }>("SELECT * FROM organisations"))
    addNode({ id: o.id, type: "org", label: o.name, size: 4.5, attrs: { kind: o.kind, sector: o.sector } });
  for (const pc of all<{ id: string; name: string }>("SELECT id, name FROM problem_classes")) addNode({ id: pc.id, type: "problem", label: pc.name, size: 3, attrs: {} });
  for (const o of all<{ id: string; title: string; kind: string }>("SELECT id, title, kind FROM opportunities"))
    addNode({ id: o.id, type: "opportunity", label: o.title, size: 7, attrs: { kind: o.kind } });
  for (const i of all<{ id: string; code: string; system_id: string; severity: string }>("SELECT * FROM incidents"))
    addNode({ id: i.id, type: "incident", label: i.code, size: 2.5, attrs: { severity: i.severity } });
  for (const k of all<{ id: string; title: string; reuse_count: number }>("SELECT id, title, reuse_count FROM knowledge_items"))
    addNode({ id: k.id, type: "knowledge", label: k.title, size: 2 + Math.min(4, k.reuse_count * 0.5), attrs: { reuse: k.reuse_count } });

  for (const d of all<{ id: string; division_id: string }>("SELECT id, division_id FROM departments")) addEdge("part_of", d.id, d.division_id, 2);
  for (const p of m.people.values()) {
    if (p.department_id) addEdge("member_of", p.id, p.department_id, 0.6);
    else addEdge("member_of", p.id, p.division_id, 0.6);
  }
  for (const list of m.assignments.values()) for (const a of list) addEdge("worked_on", a.person_id, a.project_id, a.allocation_pct / 30, "verified", [a.id]);
  for (const r of all<{ project_id: string; system_id: string }>("SELECT * FROM project_systems")) addEdge("uses", r.project_id, r.system_id, 1);
  for (const p of all<{ id: string; customer_id: string | null; problem_class_id: string | null }>("SELECT id, customer_id, problem_class_id FROM projects")) {
    if (p.customer_id) addEdge("serves", p.id, p.customer_id, 1);
    if (p.problem_class_id) addEdge("solves", p.id, p.problem_class_id, 0.5);
  }
  for (const r of all<{ system_id: string; person_id: string; role: string }>("SELECT * FROM system_roles")) addEdge("maintains", r.person_id, r.system_id, 1, "verified", [`${r.system_id}:${r.role}`]);
  for (const r of all<{ incident_id: string; person_id: string }>("SELECT * FROM incident_resolvers")) addEdge("resolved", r.person_id, r.incident_id, 1, "verified", [r.incident_id]);
  for (const i of all<{ id: string; system_id: string }>("SELECT id, system_id FROM incidents")) addEdge("on_system", i.id, i.system_id, 1);
  for (const k of all<{ id: string; author_id: string; project_id: string | null; system_id: string | null }>("SELECT id, author_id, project_id, system_id FROM knowledge_items")) {
    addEdge("authored", k.author_id, k.id, 1, "verified", [k.id]);
    if (k.project_id) addEdge("about", k.id, k.project_id, 0.5);
    else if (k.system_id) addEdge("about", k.id, k.system_id, 0.5);
  }
  for (const d of all<{ system_id: string; depends_on_id: string }>("SELECT * FROM system_deps")) addEdge("depends_on", d.system_id, d.depends_on_id, 1.5);
  for (const s of all<{ id: string; vendor_org_id: string | null }>("SELECT id, vendor_org_id FROM systems")) if (s.vendor_org_id) addEdge("supplies", s.vendor_org_id, s.id, 0.8);
  for (const o of all<{ id: string; org_id: string | null }>("SELECT id, org_id FROM opportunities")) if (o.org_id) addEdge("for_customer", o.id, o.org_id, 1);
  for (const r of all<{ opportunity_id: string; skill_id: string }>("SELECT r.opportunity_id, s.skill_id FROM opportunity_role_skills s JOIN opportunity_roles r ON r.id = s.role_id WHERE s.must = 1"))
    addEdge("requires", r.opportunity_id, r.skill_id, 1, "verified", [], `req:${r.opportunity_id}:${r.skill_id}`);
  for (const [pid, skills] of m.declared) for (const s of skills.values()) addEdge("has_skill", pid, s.skill_id, s.level / 5, "verified", [], `has:${pid}:${s.skill_id}`);
  for (const r of all<{ person_id: string; skill_id: string; confidence: number; evidence_ids: string }>("SELECT * FROM inferred_skills"))
    addEdge("inferred_skill", r.person_id, r.skill_id, r.confidence, "inferred", r.evidence_ids.split(","), `inf:${r.person_id}:${r.skill_id}`);
  for (const c of all<{ id: string; resolver_id: string | null; problem_class_id: string; org_id: string }>("SELECT id, resolver_id, problem_class_id, org_id FROM customer_cases")) {
    if (c.resolver_id) addEdge("solved_case", c.resolver_id, c.problem_class_id, 0.3, "verified", [c.id], `case:${c.id}`);
    addEdge("raised", c.org_id, c.problem_class_id, 0.3, "verified", [c.id], `raised:${c.id}`);
  }
  // collaboration: people who shared a project
  const byProject = new Map<string, string[]>();
  for (const list of m.assignments.values()) for (const a of list) { if (!byProject.has(a.project_id)) byProject.set(a.project_id, []); byProject.get(a.project_id)!.push(a.person_id); }
  const collab = new Map<string, { n: number; refs: string[] }>();
  for (const [proj, ms] of byProject) {
    const uniq = [...new Set(ms)].sort();
    for (let i = 0; i < uniq.length; i++) for (let j = i + 1; j < uniq.length; j++) {
      const k = `${uniq[i]}|${uniq[j]}`;
      const c = collab.get(k) ?? { n: 0, refs: [] };
      c.n++; c.refs.push(proj); collab.set(k, c);
    }
  }
  for (const [k, c] of collab) { const [a, b] = k.split("|"); addEdge("collaborates", a, b, c.n, "verified", c.refs, `col:${a}:${b}`); }

  // merge solved_case duplicates (same person, same problem)
  const merged = new Map<string, GraphEdge>();
  for (const e of edges) {
    const key = e.type === "solved_case" ? `solved:${e.source}:${e.target}` : e.type === "raised" ? `raised:${e.source}:${e.target}` : e.id;
    const prev = merged.get(key);
    if (prev) { prev.weight += e.weight; prev.sourceRecordIds.push(...e.sourceRecordIds); }
    else merged.set(key, { ...e, id: key });
  }
  const finalEdges = [...merged.values()];
  const rand = rng(2026);

  if (opts.pinned) placeIncremental(g, nodes, finalEdges, opts.pinned, rand);
  else layoutFull(g, nodes, finalEdges, rand);

  // --- communities on the collaboration + work graph (people and projects)
  const cg = new Graph({ type: "undirected" });
  for (const n of nodes.values()) if (n.type === "person" || n.type === "project") cg.addNode(n.id);
  for (const e of finalEdges) if ((e.type === "worked_on" || e.type === "collaborates") && !cg.hasEdge(e.source, e.target)) cg.addEdge(e.source, e.target, { weight: e.weight });
  const comm = louvain(cg, { rng: rng(7), getEdgeWeight: "weight" });
  const pg = new Graph({ type: "undirected" });
  for (const n of nodes.values()) if (n.type === "person") pg.addNode(n.id);
  for (const e of finalEdges) if (e.type === "collaborates" && !pg.hasEdge(e.source, e.target)) pg.addEdge(e.source, e.target);
  const btw = betweenness(pg, { normalized: true });

  const out: GraphNode[] = [...nodes.values()].map((n) => ({
    ...n,
    x: Math.round(g.getNodeAttribute(n.id, "x") * 10) / 10,
    y: Math.round(g.getNodeAttribute(n.id, "y") * 10) / 10,
    community: comm[n.id] ?? -1,
    attrs: n.type === "person" ? { ...n.attrs, betweenness: Math.round((btw[n.id] ?? 0) * 1000) / 1000 } : n.attrs,
  }));
  return { nodes: out, edges: finalEdges, meta: { generatedAt: new Date().toISOString(), communities: new Set(Object.values(comm)).size } };
}

type NodeMap = Map<string, Omit<GraphNode, "x" | "y" | "community">>;

/** Incremental: keep every known position; place new nodes at the centroid of known neighbours. */
function placeIncremental(g: Graph, nodes: NodeMap, edges: GraphEdge[], pinned: Map<string, { x: number; y: number }>, rand: () => number) {
  const nb = new Map<string, string[]>();
  for (const e of edges) {
    nb.set(e.source, [...(nb.get(e.source) ?? []), e.target]);
    nb.set(e.target, [...(nb.get(e.target) ?? []), e.source]);
  }
  const pts = [...pinned.values()];
  const cx = pts.reduce((a, p) => a + p.x, 0) / Math.max(1, pts.length), cy = pts.reduce((a, p) => a + p.y, 0) / Math.max(1, pts.length);
  const fresh: string[] = [];
  for (const n of nodes.values()) {
    const p = pinned.get(n.id);
    if (p) g.addNode(n.id, { x: p.x, y: p.y, size: n.size });
    else { g.addNode(n.id, { x: cx, y: cy, size: n.size }); fresh.push(n.id); }
  }
  // two passes so a new node linked only to another new node still lands near the right place
  for (let pass = 0; pass < 2; pass++) {
    for (const id of fresh) {
      const known = (nb.get(id) ?? []).filter((x) => pinned.has(x) || (pass === 1 && fresh.includes(x) && x !== id));
      if (!known.length) continue;
      g.setNodeAttribute(id, "x", known.reduce((a, x) => a + g.getNodeAttribute(x, "x"), 0) / known.length + (rand() - 0.5) * 24);
      g.setNodeAttribute(id, "y", known.reduce((a, x) => a + g.getNodeAttribute(x, "y"), 0) / known.length + (rand() - 0.5) * 24);
    }
  }
}

function layoutFull(g: Graph, nodes: NodeMap, finalEdges: GraphEdge[], rand: () => number) {
  // --- layout on the "work graph" (no skill / collaboration / case edges), then place skills by their holders
  const LAYOUT = new Set(["part_of", "member_of", "worked_on", "uses", "serves", "maintains", "resolved", "on_system", "authored", "about", "depends_on", "supplies", "for_customer", "solves", "raised", "solved_case"]);
  const divisions = [...nodes.values()].filter((n) => n.type === "division").map((n) => n.id);
  const angle = new Map(divisions.map((d, i) => [d, (i / divisions.length) * Math.PI * 2]));
  for (const n of nodes.values()) {
    const div = String(n.attrs.division ?? "");
    const a = angle.get(div) ?? angle.get(n.id) ?? rand() * Math.PI * 2;
    const r = n.type === "division" ? 300 : 120 + rand() * 260;
    g.addNode(n.id, { x: Math.cos(a) * r + (rand() - 0.5) * 80, y: Math.sin(a) * r + (rand() - 0.5) * 80, size: n.size });
  }
  for (const e of finalEdges) if (LAYOUT.has(e.type) && !g.hasEdge(e.source, e.target)) g.addEdge(e.source, e.target, { weight: e.weight });
  forceAtlas2.assign(g, { iterations: 600, settings: { ...forceAtlas2.inferSettings(g), gravity: 1.2, scalingRatio: 8, barnesHutOptimize: true, strongGravityMode: false, edgeWeightInfluence: 0.6 } });

  // nodes the layout could not place (no work links): put them next to their neighbours, else near the centre
  const anyNeighbours = new Map<string, string[]>();
  for (const e of finalEdges) {
    if (!anyNeighbours.has(e.source)) anyNeighbours.set(e.source, []);
    if (!anyNeighbours.has(e.target)) anyNeighbours.set(e.target, []);
    anyNeighbours.get(e.source)!.push(e.target);
    anyNeighbours.get(e.target)!.push(e.source);
  }
  const placed = (id: string) => g.degree(id) > 0;
  const xsAll = g.mapNodes((id, a) => (placed(id) ? a.x : 0)).filter((x) => x !== 0);
  const ysAll = g.mapNodes((id, a) => (placed(id) ? a.y : 0)).filter((y) => y !== 0);
  const cxAll = xsAll.reduce((a, b) => a + b, 0) / xsAll.length, cyAll = ysAll.reduce((a, b) => a + b, 0) / ysAll.length;
  const spread = (Math.max(...xsAll) - Math.min(...xsAll)) / 2;
  for (const n of nodes.values()) {
    if (placed(n.id) || n.type === "skill" || n.type === "opportunity") continue;
    const ns = (anyNeighbours.get(n.id) ?? []).filter(placed);
    if (ns.length) {
      g.setNodeAttribute(n.id, "x", ns.reduce((a, x) => a + g.getNodeAttribute(x, "x"), 0) / ns.length + (rand() - 0.5) * 30);
      g.setNodeAttribute(n.id, "y", ns.reduce((a, x) => a + g.getNodeAttribute(x, "y"), 0) / ns.length + (rand() - 0.5) * 30);
    } else {
      const a = rand() * Math.PI * 2, r = spread * (0.6 + rand() * 0.35);
      g.setNodeAttribute(n.id, "x", cxAll + Math.cos(a) * r);
      g.setNodeAttribute(n.id, "y", cyAll + Math.sin(a) * r);
    }
  }

  // skills and opportunities: place at the centroid of their neighbours (jittered)
  const neighbours = new Map<string, string[]>();
  for (const e of finalEdges) {
    if (e.type === "has_skill" || e.type === "inferred_skill") { if (!neighbours.has(e.target)) neighbours.set(e.target, []); neighbours.get(e.target)!.push(e.source); }
  }
  for (const n of nodes.values()) {
    if (n.type !== "skill" && n.type !== "opportunity" && g.degree(n.id) > 0) continue;
    const ns = n.type === "opportunity"
      ? finalEdges.filter((e) => e.source === n.id && e.type === "requires").flatMap((e) => neighbours.get(e.target) ?? [])
      : neighbours.get(n.id) ?? [];
    if (ns.length) {
      const xs = ns.map((x) => g.getNodeAttribute(x, "x")), ys = ns.map((x) => g.getNodeAttribute(x, "y"));
      g.setNodeAttribute(n.id, "x", xs.reduce((a, b) => a + b, 0) / xs.length + (rand() - 0.5) * 40);
      g.setNodeAttribute(n.id, "y", ys.reduce((a, b) => a + b, 0) / ys.length + (rand() - 0.5) * 40);
    }
  }

  // final pass: anything still outside the main cluster (vendors, partners, skills nobody holds) moves inside it
  const core = [...nodes.values()].filter((n) => n.type === "person").map((n) => ({ x: g.getNodeAttribute(n.id, "x"), y: g.getNodeAttribute(n.id, "y") }));
  const mx = core.reduce((a, p) => a + p.x, 0) / core.length, my = core.reduce((a, p) => a + p.y, 0) / core.length;
  const radius = Math.max(...core.map((p) => Math.hypot(p.x - mx, p.y - my)));
  for (const n of nodes.values()) {
    const x = g.getNodeAttribute(n.id, "x"), y = g.getNodeAttribute(n.id, "y");
    if (Math.hypot(x - mx, y - my) > radius * 1.02) {
      const a = rand() * Math.PI * 2, r = radius * (0.25 + rand() * 0.55);
      g.setNodeAttribute(n.id, "x", mx + Math.cos(a) * r);
      g.setNodeAttribute(n.id, "y", my + Math.sin(a) * r);
    }
  }
}
