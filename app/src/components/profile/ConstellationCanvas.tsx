"use client";
// Sigma renderer for My Constellation: same shapes and colours as the main graph, fixed radial positions,
// an overlay for ring guides and dashed lines (gold = AI-suggested, violet = from your profile, not yet in the graph).
import { useEffect, useRef } from "react";
import Graph from "graphology";
import Sigma from "sigma";
import { NodeSquareProgram } from "@sigma/node-square";
import { createNodeImageProgram } from "@sigma/node-image";
import { Icon } from "../Icon";
import { nodeColor, program2d, silhouette } from "../../lib/shapes";
import type { Constellation } from "../../lib/me/constellation";

// Same values as R1 and R2 in lib/me/constellation.ts (kept here so the client bundle does not import server code)
const R1 = 1.35;
const R2 = 2.25;

const NodeShapeProgram = createNodeImageProgram({ drawingMode: "color", keepWithinCircle: false, padding: 0, size: { mode: "force", value: 128 } });
const DIM = "rgba(71, 85, 105, 0.35)";
const CENTER = "#38bdf8";

interface Props {
  data: Constellation;
  hidden: Set<string>;
  showOuter: boolean;
  selected: string | null;
  onSelect: (id: string | null) => void;
}

export default function ConstellationCanvas({ data, hidden, showOuter, selected, onSelect }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const sigma = useRef<Sigma | null>(null);
  const state = useRef({ hidden, showOuter, selected, hovered: null as string | null });
  state.current = { ...state.current, hidden, showOuter, selected };
  const select = useRef(onSelect);
  select.current = onSelect;

  useEffect(() => {
    const g = new Graph({ type: "undirected", multi: true });
    for (const n of data.nodes) {
      g.addNode(n.id, {
        x: n.x, y: n.y, size: n.size, label: n.label, type: program2d(n.type), image: silhouette(n.type), nodeType: n.type, ring: n.ring,
        color: n.ring === 0 ? CENTER : n.private ? "#64748b" : nodeColor(n.type, {}), profileOnly: n.profileOnly, zIndex: 3 - n.ring,
      });
    }
    for (const e of data.edges) {
      if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue;
      g.addEdgeWithKey(e.id, e.source, e.target, { style: e.style, size: e.style === "solid" ? 1 : 1.4,
        color: e.style === "solid" ? "rgba(147, 197, 253, 0.32)" : "rgba(0, 0, 0, 0)" });
    }
    const neighbours = (id: string) => new Set([id, ...g.neighbors(id)]);
    const visible = (id: string) => {
      const s = state.current;
      return !s.hidden.has(g.getNodeAttribute(id, "nodeType")) && (s.showOuter || g.getNodeAttribute(id, "ring") < 2) || g.getNodeAttribute(id, "ring") === 0;
    };

    const r = new Sigma(g, box.current!, {
      nodeProgramClasses: { square: NodeSquareProgram, shape: NodeShapeProgram },
      labelColor: { color: "#e8eefc" }, labelFont: '"Segoe UI", system-ui, sans-serif', labelSize: 12, labelWeight: "600",
      labelRenderedSizeThreshold: 6, labelDensity: 0.5, zIndex: true, minCameraRatio: 0.15, maxCameraRatio: 2.5,
      defaultDrawNodeHover: (ctx, d, settings) => {
        const label = d.label ?? "";
        ctx.font = `600 ${settings.labelSize}px ${settings.labelFont}`;
        const w = ctx.measureText(label).width + 16;
        ctx.fillStyle = "rgba(15, 23, 41, 0.95)"; ctx.strokeStyle = "rgba(56, 189, 248, 0.6)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.roundRect(d.x + d.size + 4, d.y - 12, w, 24, 6); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#e8eefc"; ctx.fillText(label, d.x + d.size + 12, d.y + 4);
      },
    });
    sigma.current = r;

    r.setSetting("nodeReducer", (node, d) => {
      const s = state.current;
      const res = { ...d } as Record<string, unknown>;
      if (!visible(node)) { res.hidden = true; return res; }
      const focus = s.hovered ?? s.selected;
      if (focus && g.hasNode(focus)) {
        if (neighbours(focus).has(node)) { res.forceLabel = true; res.zIndex = 4; if (node === focus) res.size = (d.size as number) * 1.4; }
        else { res.color = DIM; res.label = ""; res.zIndex = 0; }
      }
      if (d.ring === 0) res.forceLabel = true;
      return res;
    });
    r.setSetting("edgeReducer", (edge, d) => {
      const s = state.current;
      const res = { ...d } as Record<string, unknown>;
      const [a, b] = g.extremities(edge);
      if (!visible(a) || !visible(b)) { res.hidden = true; return res; }
      const focus = s.hovered ?? s.selected;
      if (focus && g.hasNode(focus) && a !== focus && b !== focus) res.color = d.style === "solid" ? "rgba(147, 197, 253, 0.08)" : res.color;
      else if (focus && d.style === "solid") { res.color = "rgba(147, 197, 253, 0.85)"; res.size = 1.8; }
      return res;
    });

    // Overlay: ring guides and dashed edges, redrawn after every Sigma render (no animation loop)
    const ctx = overlay.current!.getContext("2d")!;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const resize = () => {
      const c = overlay.current!;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(() => { resize(); r.refresh(); });
    ro.observe(overlay.current!);
    const draw = () => {
      const c = overlay.current!;
      ctx.clearRect(0, 0, c.clientWidth, c.clientHeight);
      const o = r.graphToViewport({ x: 0, y: 0 });
      ctx.save();
      ctx.setLineDash([2, 6]);
      ctx.strokeStyle = "rgba(148, 163, 184, 0.35)";
      ctx.lineWidth = 1;
      for (const rad of state.current.showOuter ? [R1, R2] : [R1]) {
        const p = r.graphToViewport({ x: rad, y: 0 });
        ctx.beginPath(); ctx.arc(o.x, o.y, Math.hypot(p.x - o.x, p.y - o.y), 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
      const focus = state.current.hovered ?? state.current.selected;
      g.forEachEdge((e, attr, a, b) => {
        if (attr.style === "solid" || !visible(a) || !visible(b)) return;
        const pa = r.graphToViewport({ x: g.getNodeAttribute(a, "x"), y: g.getNodeAttribute(a, "y") });
        const pb = r.graphToViewport({ x: g.getNodeAttribute(b, "x"), y: g.getNodeAttribute(b, "y") });
        const dim = focus && a !== focus && b !== focus;
        ctx.save();
        ctx.setLineDash(attr.style === "inferred" ? [6, 5] : [3, 4]);
        ctx.strokeStyle = attr.style === "inferred" ? `rgba(251, 191, 36, ${dim ? 0.15 : 0.9})` : `rgba(167, 139, 250, ${dim ? 0.15 : 0.9})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
        ctx.restore();
      });
      const sel = state.current.selected;
      if (sel && g.hasNode(sel) && visible(sel)) {
        const p = r.graphToViewport({ x: g.getNodeAttribute(sel, "x"), y: g.getNodeAttribute(sel, "y") });
        const size = r.getNodeDisplayData(sel)?.size ?? 6;
        ctx.strokeStyle = "rgba(56, 189, 248, 0.9)"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, size + (reduced ? 6 : 7), 0, Math.PI * 2); ctx.stroke();
      }
    };
    r.on("afterRender", draw);
    r.on("clickNode", ({ node }) => select.current(node));
    r.on("clickStage", () => select.current(null));
    r.on("enterNode", ({ node }) => { state.current.hovered = node; box.current!.style.cursor = "pointer"; r.refresh({ skipIndexation: true }); });
    r.on("leaveNode", () => { state.current.hovered = null; box.current!.style.cursor = "default"; r.refresh({ skipIndexation: true }); });

    return () => { ro.disconnect(); r.kill(); sigma.current = null; };
  }, [data]);

  useEffect(() => {
    const r = sigma.current;
    if (!r) return;
    r.refresh();
    if (selected && r.getGraph().hasNode(selected)) {
      const d = r.getNodeDisplayData(selected);
      if (d) r.getCamera().animate({ x: d.x, y: d.y, ratio: Math.min(r.getCamera().ratio, 0.8) }, { duration: 500 });
    }
  }, [hidden, showOuter, selected]);

  const cam = (f: "in" | "out" | "reset") => {
    const c = sigma.current?.getCamera();
    if (!c) return;
    if (f === "in") c.animatedZoom({ duration: 250 }); else if (f === "out") c.animatedUnzoom({ duration: 250 }); else c.animatedReset({ duration: 350 });
  };

  return (
    <div className="pf-cons-stage">
      <div className="graph-stage" role="img" aria-label={`Your constellation: ${data.nodes.length - 1} connections. The same connections are listed below the graph.`}>
        <div ref={box} className="graph-sigma" />
        <canvas ref={overlay} className="graph-overlay" aria-hidden="true" />
      </div>
      <div className="pf-cons-zoom" role="group" aria-label="Zoom">
        <button type="button" className="btn btn-ghost pf-icon-btn" aria-label="Zoom in" onClick={() => cam("in")}><Icon name="plus" /></button>
        <button type="button" className="btn btn-ghost pf-icon-btn" aria-label="Zoom out" onClick={() => cam("out")}><Icon name="minus" /></button>
        <button type="button" className="btn btn-ghost pf-icon-btn" aria-label="Fit to view" onClick={() => cam("reset")}><Icon name="reset" /></button>
      </div>
    </div>
  );
}
