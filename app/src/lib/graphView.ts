// What to highlight for a given view, shared by the 2D (Sigma) and 3D (Three.js) renderers.
import type { GraphData } from "./types";

export type GraphMode = "explore" | "answer" | "talent" | "risk";

export interface GraphView {
  mode: GraphMode;
  nodeIds: string[];        // highlighted nodes (answer / risk)
  edgeIds: string[];        // highlighted edges by id
  stars: string[];          // hidden talent / hidden capability people (gold)
  danger: string[];         // risk nodes (red)
  focusId: string | null;   // clicked or searched node: its neighbourhood lights up
  panel?: boolean;          // side panel open
  pulse?: string[];         // nodes an agent just added or changed (ripple)
}

export const EMPTY_VIEW: GraphView = { mode: "explore", nodeIds: [], edgeIds: [], stars: [], danger: [], focusId: null };

/** Edge types drawn in the resting view (structure of work). Others appear only when highlighted. */
export const BASE_EDGE_TYPES = new Set(["worked_on", "uses", "maintains", "depends_on", "part_of", "member_of"]);
const NOISY = new Set(["collaborates", "member_of"]);

export interface Adjacency {
  byNode: Map<string, { edgeId: string; other: string; type: string }[]>;
  edges: Map<string, { source: string; target: string; type: string; evidence: string }>;
}

export function buildAdjacency(data: GraphData): Adjacency {
  const byNode = new Map<string, { edgeId: string; other: string; type: string }[]>();
  const edges = new Map<string, { source: string; target: string; type: string; evidence: string }>();
  for (const e of data.edges) {
    edges.set(e.id, { source: e.source, target: e.target, type: e.type, evidence: e.evidence });
    if (!byNode.has(e.source)) byNode.set(e.source, []);
    if (!byNode.has(e.target)) byNode.set(e.target, []);
    byNode.get(e.source)!.push({ edgeId: e.id, other: e.target, type: e.type });
    byNode.get(e.target)!.push({ edgeId: e.id, other: e.source, type: e.type });
  }
  return { byNode, edges };
}

export function deriveHighlight(adj: Adjacency, view: GraphView): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set(view.nodeIds.filter((id) => adj.byNode.has(id)));
  const edges = new Set(view.edgeIds.filter((id) => adj.edges.has(id)));
  if (view.mode === "talent") return { nodes: new Set(), edges: new Set() };
  if (view.focusId && adj.byNode.has(view.focusId)) {
    nodes.add(view.focusId);
    for (const n of adj.byNode.get(view.focusId)!) {
      if (NOISY.has(n.type)) continue;
      edges.add(n.edgeId);
      nodes.add(n.other);
    }
  }
  // connect highlighted nodes with any meaningful edge between them
  if (nodes.size && nodes.size < 400) {
    for (const id of nodes) {
      for (const n of adj.byNode.get(id) ?? []) if (nodes.has(n.other) && !NOISY.has(n.type)) edges.add(n.edgeId);
    }
  }
  return { nodes, edges };
}
