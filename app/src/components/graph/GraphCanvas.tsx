"use client";
// 2D view: Sigma.js (WebGL) with type-specific shapes + an overlay canvas for the "living" layer:
// energy particles on work edges, dashed gold lines for AI-inferred skills, pulsing halos for stars and risks.
import { useEffect, useRef } from "react";
import Graph from "graphology";
import Sigma from "sigma";
import { NodeSquareProgram } from "@sigma/node-square";
import { createNodeImageProgram } from "@sigma/node-image";
import type { GraphData } from "../../lib/types";
import { BASE_EDGE_TYPES, buildAdjacency, deriveHighlight, type GraphView } from "../../lib/graphView";
import { nodeColor, program2d, silhouette } from "../../lib/shapes";

export type { GraphView } from "../../lib/graphView";

interface Props {
  data: GraphData;
  view: GraphView;
  hiddenTypes?: string[];   // entity types switched off in the legend
  onNodeClick: (id: string, type: string) => void;
  onStageClick: () => void;
}

const DIM_NODE = "rgba(71, 85, 105, 0.35)";
const STRUCTURE = new Set(["division", "department"]);
const NodeShapeProgram = createNodeImageProgram({ drawingMode: "color", keepWithinCircle: false, padding: 0, size: { mode: "force", value: 128 } });

export default function GraphCanvas({ data, view, hiddenTypes = [], onNodeClick, onStageClick }: Props) {
  const hiddenRef = useRef(new Set(hiddenTypes));
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const viewRef = useRef<GraphView>(view);
  const derivedRef = useRef<{ nodes: Set<string>; edges: Set<string> }>({ nodes: new Set(), edges: new Set() });
  const adjRef = useRef(buildAdjacency(data));
  const clickRef = useRef({ onNodeClick, onStageClick });
  clickRef.current = { onNodeClick, onStageClick };

  useEffect(() => {
    adjRef.current = buildAdjacency(data);
    const g = new Graph({ type: "undirected", multi: true });
    for (const n of data.nodes) {
      g.addNode(n.id, {
        x: n.x, y: n.y, size: n.type === "project" ? n.size * 0.85 : n.size, label: n.label, color: nodeColor(n.type, n.attrs),
        type: program2d(n.type), image: silhouette(n.type), nodeType: n.type, attrs: n.attrs, zIndex: 1,
      });
    }
    for (const e of data.edges) {
      if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue;
      g.addEdgeWithKey(e.id, e.source, e.target, { edgeType: e.type, evidence: e.evidence, weight: e.weight, size: e.type === "worked_on" ? 0.6 : 0.4, color: "rgba(125,170,235,0.10)" });
    }
    graphRef.current = g;
    const renderer = new Sigma(g, containerRef.current!, {
      nodeProgramClasses: { square: NodeSquareProgram, shape: NodeShapeProgram },
      renderEdgeLabels: false,
      labelColor: { color: "#e8eefc" },
      labelFont: '"Segoe UI", system-ui, sans-serif',
      labelSize: 12,
      labelWeight: "600",
      labelRenderedSizeThreshold: 13,
      zIndex: true,
      minCameraRatio: 0.04,
      maxCameraRatio: 1.6,
      defaultDrawNodeHover: (ctx, d, settings) => {
        const label = d.label ?? "";
        ctx.font = `600 ${settings.labelSize}px ${settings.labelFont}`;
        const w = ctx.measureText(label).width + 16;
        ctx.fillStyle = "rgba(15, 23, 41, 0.95)";
        ctx.strokeStyle = "rgba(56, 189, 248, 0.6)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(d.x + d.size + 4, d.y - 12, w, 24, 6);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#e8eefc";
        ctx.fillText(label, d.x + d.size + 12, d.y + 4);
      },
    });
    sigmaRef.current = renderer;

    const off = (id: string) => hiddenRef.current.has(g.getNodeAttribute(id, "nodeType") as string);
    renderer.setSetting("nodeReducer", (node, d) => {
      const v = viewRef.current;
      const der = derivedRef.current;
      const res = { ...d } as Record<string, unknown>;
      const t = d.nodeType as string;
      if (hiddenRef.current.has(t)) { res.hidden = true; return res; }
      const active = der.nodes.size > 0;
      if (STRUCTURE.has(t) && !active) res.label = t === "division" ? d.label : "";
      if (v.mode === "talent") {
        if (v.stars.includes(node)) { res.color = "#fbbf24"; res.size = (d.size as number) * 1.25; res.forceLabel = true; res.zIndex = 3; }
        else { res.color = DIM_NODE; res.label = ""; }
        return res;
      }
      if (active) {
        if (der.nodes.has(node)) {
          res.zIndex = 2;
          res.forceLabel = t === "person" || t === "opportunity" || t === "system" || node === v.focusId;
          if (v.danger.includes(node)) res.color = "#f87171";
          if (v.stars.includes(node)) { res.color = "#fbbf24"; res.size = (d.size as number) * 1.25; }
          if (node === v.focusId) res.size = (d.size as number) * 1.6;
        } else {
          res.color = DIM_NODE;
          res.label = "";
          res.zIndex = 0;
        }
      } else if (t === "skill" || t === "problem" || t === "incident" || t === "knowledge") {
        res.color = "rgba(100, 116, 139, 0.55)";
      }
      return res;
    });
    renderer.setSetting("edgeReducer", (edge, d) => {
      const der = derivedRef.current;
      const res = { ...d } as Record<string, unknown>;
      const type = d.edgeType as string;
      if (off(g.source(edge)) || off(g.target(edge))) { res.hidden = true; return res; }
      if (der.nodes.size > 0) {
        if (der.edges.has(edge)) {
          res.color = d.evidence === "inferred" ? "rgba(0,0,0,0)" : "rgba(147, 197, 253, 0.75)"; // inferred drawn dashed on overlay
          res.size = 1.6;
          res.zIndex = 2;
        } else res.hidden = true;
      } else if (!BASE_EDGE_TYPES.has(type) || viewRef.current.mode === "talent") {
        res.hidden = true;
      }
      return res;
    });

    renderer.on("clickNode", ({ node }) => clickRef.current.onNodeClick(node, g.getNodeAttribute(node, "nodeType")));
    renderer.on("clickStage", () => clickRef.current.onStageClick());
    renderer.on("enterNode", () => { containerRef.current!.style.cursor = "pointer"; });
    renderer.on("leaveNode", () => { containerRef.current!.style.cursor = "default"; });

    // ---- overlay animation
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const canvas = overlayRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    const ambient = g.filterEdges((_e, a) => a.edgeType === "worked_on").filter((_e, i) => i % 3 === 0).map((e, i) => ({ e, off: (i * 0.37) % 1, sp: 0.06 + ((i * 7) % 10) / 120 }));
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const toView = (id: string) => renderer.graphToViewport({ x: g.getNodeAttribute(id, "x"), y: g.getNodeAttribute(id, "y") });
    const nodeR = (id: string) => (renderer.getNodeDisplayData(id)?.size ?? 4);
    function frame(ms: number) {
      const t = ms / 1000;
      const v = viewRef.current;
      const der = derivedRef.current;
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      const active = der.nodes.size > 0;
      const list = active ? [...der.edges].map((e, i) => ({ e, off: (i * 0.29) % 1, sp: 0.35 })) : v.mode === "talent" ? [] : ambient;
      for (const p of list) {
        if (!g.hasEdge(p.e) || off(g.source(p.e)) || off(g.target(p.e))) continue;
        const a = toView(g.source(p.e)), b = toView(g.target(p.e));
        const inferred = g.getEdgeAttribute(p.e, "evidence") === "inferred";
        if (active && inferred) {
          ctx.save();
          ctx.setLineDash([6, 5]);
          ctx.lineDashOffset = reduced ? 0 : -t * 20;
          ctx.strokeStyle = "rgba(251, 191, 36, 0.95)";
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          ctx.restore();
        }
        if (reduced) continue;
        const f = (t * p.sp + p.off) % 1;
        ctx.fillStyle = inferred ? "rgba(251, 191, 36, 0.95)" : active ? "rgba(186, 230, 253, 0.95)" : "rgba(125, 211, 252, 0.45)";
        ctx.beginPath(); ctx.arc(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, active ? 2.4 : 1.4, 0, Math.PI * 2); ctx.fill();
      }
      const ring = (id: string, color: string) => {
        if (!g.hasNode(id) || off(id)) return;
        const c = toView(id);
        const r = nodeR(id) + 6 + (reduced ? 0 : Math.sin(t * 2.4) * 3);
        ctx.strokeStyle = color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.stroke();
      };
      if (v.mode === "talent" || active) for (const s of v.stars) ring(s, "rgba(251, 191, 36, 0.8)");
      for (const d of v.danger) ring(d, "rgba(248, 113, 113, 0.85)");
      if (v.focusId) ring(v.focusId, "rgba(56, 189, 248, 0.9)");
      // agent changes: expanding green ripples
      for (const id of v.pulse ?? []) {
        if (!g.hasNode(id) || off(id)) continue;
        const c = toView(id);
        for (let k = 0; k < 2; k++) {
          const f = reduced ? 0.5 : ((t * 0.8 + k * 0.5) % 1);
          ctx.strokeStyle = `rgba(52, 211, 153, ${0.9 * (1 - f)})`; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(c.x, c.y, nodeR(id) + 4 + f * 22, 0, Math.PI * 2); ctx.stroke();
        }
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.kill();
      sigmaRef.current = null;
    };
  }, [data]);

  // legend switches: redraw only, the camera stays where it is
  useEffect(() => {
    hiddenRef.current = new Set(hiddenTypes);
    sigmaRef.current?.refresh();
  }, [hiddenTypes]);

  useEffect(() => {
    viewRef.current = view;
    const renderer = sigmaRef.current;
    if (!renderer) return;
    const der = deriveHighlight(adjRef.current, view);
    derivedRef.current = der;
    renderer.refresh();

    const target = view.mode === "talent" ? view.stars : view.focusId ? [view.focusId] : [...der.nodes];
    const cam = renderer.getCamera();
    if (!target.length) { cam.animate({ x: 0.5 + (view.panel ? 0.12 : 0), y: 0.5, ratio: view.panel ? 1.15 : 1, angle: 0 }, { duration: 700 }); return; }
    const pts = target.map((id) => renderer.getNodeDisplayData(id)).filter(Boolean) as { x: number; y: number }[];
    if (!pts.length) return;
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const ratio = view.focusId && view.mode !== "talent" ? 0.25 : Math.min(1.1, Math.max(view.mode === "talent" ? 0.45 : 0.2, span * 1.6));
    cam.animate({ x: cx + (view.panel ? ratio * 0.17 : 0), y: cy, ratio }, { duration: 900, easing: "cubicInOut" });
  }, [view]);

  return (
    <div className="graph-stage" aria-label="Capability graph, 2D. Results are listed in the side panel." role="img">
      <div ref={containerRef} className="graph-sigma" />
      <canvas ref={overlayRef} className="graph-overlay" aria-hidden="true" />
    </div>
  );
}
