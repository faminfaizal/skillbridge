"use client";
// 3D "Fly" view (Three.js via 3d-force-graph): the same graph as strata, organisation on top, people and skills in the middle,
// work below, systems and customers at the base. Orbit (drag), tilt (drag up/down), zoom (wheel), pan (right-drag);
// selecting anything flies the camera there. Positions come from the precomputed layout, so the scene is the same every time.
import { useEffect, useRef } from "react";
import * as THREE from "three";
import SpriteText from "three-spritetext";
import type { GraphData } from "../../lib/types";
import { BASE_EDGE_TYPES, buildAdjacency, deriveHighlight, type GraphView } from "../../lib/graphView";
import { SHAPES, STRATA, nodeColor, type EntityType } from "../../lib/shapes";

interface Props {
  data: GraphData;
  view: GraphView;
  onNodeClick: (id: string, type: string) => void;
  onStageClick: () => void;
  onError: (message: string) => void;
}

interface N3 { id: string; type: EntityType; label: string; color: string; size: number; x: number; y: number; z: number; fx: number; fy: number; fz: number }
interface L3 { id: string; source: string; target: string; type: string; evidence: string; ambient: boolean }

const PANEL_W = 470;
const DIM = "#334155";

function geometryFor(solid: string): THREE.BufferGeometry {
  switch (solid) {
    case "box": return new THREE.BoxGeometry(1.5, 1.5, 1.5);
    case "cylinder": return new THREE.CylinderGeometry(1, 1, 1.5, 6);
    case "tetrahedron": return new THREE.TetrahedronGeometry(1.25);
    case "dodecahedron": return new THREE.DodecahedronGeometry(1.1);
    case "cone": return new THREE.ConeGeometry(1.05, 2, 5);
    case "octahedron": return new THREE.OctahedronGeometry(1.15);
    case "icosahedron": return new THREE.IcosahedronGeometry(1);
    case "slab": return new THREE.BoxGeometry(1.3, 1.7, 0.35);
    case "torus": { const g = new THREE.TorusGeometry(1.2, 0.3, 8, 28); g.rotateX(Math.PI / 2); return g; }
    default: return new THREE.SphereGeometry(1, 18, 14);
  }
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export default function Graph3D({ data, view, onNodeClick, onStageClick, onError }: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<any>(null);
  const viewRef = useRef(view);
  const derivedRef = useRef<{ nodes: Set<string>; edges: Set<string> }>({ nodes: new Set(), edges: new Set() });
  const posRef = useRef(new Map<string, { x: number; y: number; z: number }>());
  const adjRef = useRef(buildAdjacency(data));
  const cbRef = useRef({ onNodeClick, onStageClick, onError });
  cbRef.current = { onNodeClick, onStageClick, onError };
  const labelSizeRef = useRef(6);
  const geoCache = useRef(new Map<string, THREE.BufferGeometry>());
  const matCache = useRef(new Map<string, THREE.Material>());

  function material(color: string, opacity: number, glow: boolean): THREE.Material {
    const key = `${color}|${opacity}|${glow}`;
    let m = matCache.current.get(key);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color, transparent: opacity < 1, opacity, emissive: glow ? new THREE.Color(color).multiplyScalar(0.45) : new THREE.Color(0x000000) });
      matCache.current.set(key, m);
    }
    return m;
  }

  function buildNode(n: N3): THREE.Object3D {
    const v = viewRef.current;
    const der = derivedRef.current;
    const active = der.nodes.size > 0 || v.mode === "talent";
    const solid = SHAPES[n.type]?.solid ?? "sphere";
    let geo = geoCache.current.get(solid);
    if (!geo) { geo = geometryFor(solid); geoCache.current.set(solid, geo); }
    let color = n.color, opacity = 1, glow = false, scale = n.size, label = false;
    const star = v.stars.includes(n.id), danger = v.danger.includes(n.id), focus = v.focusId === n.id;
    if (v.mode === "talent") {
      if (star) { color = "#fbbf24"; glow = true; scale *= 1.6; label = true; } else { color = DIM; opacity = 0.22; }
    } else if (active) {
      if (der.nodes.has(n.id)) {
        glow = true;
        label = n.type === "person" || n.type === "opportunity" || n.type === "system" || focus;
        if (star) { color = "#fbbf24"; scale *= 1.4; }
        if (danger) color = "#f87171";
        if (focus) scale *= 1.6;
      } else { color = DIM; opacity = 0.16; }
    } else if (n.type === "skill" || n.type === "problem" || n.type === "incident" || n.type === "knowledge") {
      opacity = 0.55;
    }
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(geo, material(color, opacity, glow));
    mesh.scale.setScalar(scale);
    group.add(mesh);
    if (label) {
      const t = new SpriteText(n.label, labelSizeRef.current, "#e8eefc");
      t.backgroundColor = "rgba(15, 23, 41, 0.78)";
      t.padding = 1.6;
      t.borderRadius = 2;
      t.fontFace = "Segoe UI, system-ui, sans-serif";
      t.fontWeight = "600";
      t.position.y = scale * 1.3 + labelSizeRef.current * 0.8;
      group.add(t);
    }
    if (star || danger || focus) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(scale * 1.9, 0.45, 8, 40), material(focus && !star && !danger ? "#38bdf8" : danger ? "#f87171" : "#fbbf24", 0.85, true));
      ring.rotation.x = Math.PI / 2;
      group.add(ring);
    }
    return group;
  }

  function linkVisible(l: L3): boolean {
    const der = derivedRef.current;
    if (viewRef.current.mode === "talent") return false;
    if (der.nodes.size) return der.edges.has(l.id);
    return BASE_EDGE_TYPES.has(l.type) && l.type !== "member_of";
  }

  function applyStyles() {
    const fg = fgRef.current;
    if (!fg) return;
    const der = derivedRef.current;
    const active = der.nodes.size > 0;
    fg.nodeThreeObject((n: N3) => buildNode(n))
      .linkVisibility((l: L3) => linkVisible(l))
      .linkColor((l: L3) => (active ? (l.evidence === "inferred" ? "#fbbf24" : "#93c5fd") : "#5b7bb5"))
      .linkWidth((l: L3) => (active ? (l.evidence === "inferred" ? 2.6 : 1.4) : 0))
      .linkOpacity(active ? 0.85 : 0.22)
      .linkDirectionalParticles((l: L3) => (active ? (der.edges.has(l.id) ? (l.evidence === "inferred" ? 4 : 2) : 0) : l.ambient ? 1 : 0))
      .linkDirectionalParticleColor((l: L3) => (l.evidence === "inferred" ? "#fbbf24" : "#bae6fd"))
      .linkDirectionalParticleWidth((l: L3) => (active ? (l.evidence === "inferred" ? 2.6 : 1.8) : 1.1))
      .linkDirectionalParticleSpeed(active ? 0.008 : 0.003);
    // positions are fixed (fx/fy/fz); a short engine run positions newly shown links and particles
    fg.d3ReheatSimulation();
  }

  /** Where to look and from how far: centre on the subject, distance from the spread of what should be in frame. */
  function framing(): { centre: { x: number; y: number; z: number }; dist: number } | null {
    const v = viewRef.current;
    const der = derivedRef.current;
    const pos = (id: string) => posRef.current.get(id);
    const ids = v.mode === "talent" ? v.stars : [...der.nodes];
    const inFrame = ids.map(pos).filter(Boolean) as { x: number; y: number; z: number }[];
    if (!inFrame.length) return null;
    // must-see nodes: people, stars and the opportunity are always inside the frame
    const typeOf = new Map(data.nodes.map((n) => [n.id, n.type]));
    const mustSee = ids.filter((id) => v.stars.includes(id) || typeOf.get(id) === "person" || typeOf.get(id) === "opportunity" || typeOf.get(id) === "system").map(pos).filter(Boolean) as { x: number; y: number; z: number }[];
    const focus = v.focusId && v.mode !== "talent" ? pos(v.focusId) : undefined;
    const centre = focus ?? inFrame.reduce((a, p) => ({ x: a.x + p.x / inFrame.length, y: a.y + p.y / inFrame.length, z: a.z + p.z / inFrame.length }), { x: 0, y: 0, z: 0 });
    const ds = inFrame.map((p) => Math.hypot(p.x - centre.x, p.y - centre.y, p.z - centre.z)).sort((a, b) => a - b);
    const p90 = ds[Math.floor(ds.length * 0.9)] ?? 1; // other nodes: ignore the farthest 10%
    const mustMax = Math.max(0, ...mustSee.map((p) => Math.hypot(p.x - centre.x, p.y - centre.y, p.z - centre.z)));
    const spread = Math.max(p90, mustMax);
    return { centre, dist: Math.min(1200, Math.max(130, spread * 1.9 + 60)) };
  }

  function frameCamera() {
    const fg = fgRef.current;
    if (!fg) return;
    const v = viewRef.current;
    const el = elRef.current!;
    const wide = el.clientWidth > 820;
    fg.width(Math.max(320, el.clientWidth - (v.panel && wide ? PANEL_W : 0))).height(el.clientHeight);
    const controls = fg.controls();
    const f = framing();
    if (!f) {
      controls.autoRotate = v.mode === "explore" || v.mode === "risk";
      fg.cameraPosition({ x: 0, y: 360, z: 640 }, { x: 0, y: 0, z: 0 }, 1400);
      return;
    }
    controls.autoRotate = false;
    const dir = new THREE.Vector3(0.45, 0.6, 1).normalize();
    fg.cameraPosition({ x: f.centre.x + dir.x * f.dist, y: f.centre.y + dir.y * f.dist, z: f.centre.z + dir.z * f.dist }, f.centre, 1800);
  }

  // build the scene once per dataset
  useEffect(() => {
    let disposed = false;
    adjRef.current = buildAdjacency(data);
    const xs = data.nodes.map((n) => n.x), ys = data.nodes.map((n) => n.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const k = 640 / Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const nodes: N3[] = data.nodes.map((n) => {
      const t = n.type as EntityType;
      const x = (n.x - cx) * k, z = (n.y - cy) * k, y = (STRATA[t] ?? 0) + (rnd() - 0.5) * 16;
      posRef.current.set(n.id, { x, y, z });
      return { id: n.id, type: t, label: n.label, color: nodeColor(n.type, n.attrs), size: Math.max(1.6, n.size * 0.75), x, y, z, fx: x, fy: y, fz: z };
    });
    const links: L3[] = data.edges
      .filter((e) => e.type !== "collaborates" && e.type !== "solved_case" && e.type !== "raised")
      .map((e, i) => ({ id: e.id, source: e.source, target: e.target, type: e.type, evidence: e.evidence, ambient: e.type === "worked_on" && i % 4 === 0 }));

    (async () => {
      try {
        const probe = document.createElement("canvas");
        if (!(probe.getContext("webgl2") || probe.getContext("webgl"))) throw new Error("WebGL is not available");
        const { default: ForceGraph3D } = await import("3d-force-graph");
        if (disposed) return;
        const fg = new (ForceGraph3D as any)(elRef.current!, { controlType: "orbit" });
        fgRef.current = fg;
        fg.backgroundColor("rgba(0,0,0,0)")
          .showNavInfo(false)
          .nodeId("id")
          .nodeLabel((n: N3) => `<div class="g3-tip"><b>${escapeHtml(n.label)}</b><span>${SHAPES[n.type]?.label ?? n.type}</span></div>`)
          .enableNodeDrag(false)
          .warmupTicks(1)
          .cooldownTime(1500)
          .onNodeClick((n: N3) => cbRef.current.onNodeClick(n.id, n.type))
          .onBackgroundClick(() => cbRef.current.onStageClick())
          .onNodeHover((n: N3 | null) => { elRef.current!.style.cursor = n ? "pointer" : "grab"; });
        fg.d3Force("charge", null);
        fg.d3Force("center", null);
        // keep the link force (it resolves link endpoints to node objects) but give it no pull; positions are pinned
        fg.d3Force("link").strength(0);
        const controls = fg.controls();
        controls.autoRotateSpeed = 0.35;
        controls.enableDamping = true;
        controls.maxDistance = 1600;
        controls.minDistance = 25;
        // soft fill light so shapes read as solids
        const scene = fg.scene();
        scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x0b1222, 0.9));
        fg.graphData({ nodes, links });
        derivedRef.current = deriveHighlight(adjRef.current, viewRef.current);
        applyStyles();
        fg.cameraPosition({ x: 0, y: 900, z: 1300 }, { x: 0, y: 0, z: 0 }, 0);
        frameCamera();
      } catch (e) {
        cbRef.current.onError((e as Error).message || "3D view could not start");
      }
    })();

    const ro = new ResizeObserver(() => {
      const fg = fgRef.current, el = elRef.current;
      if (!fg || !el) return;
      const wide = el.clientWidth > 820;
      fg.width(Math.max(320, el.clientWidth - (viewRef.current.panel && wide ? PANEL_W : 0))).height(el.clientHeight);
    });
    ro.observe(elRef.current!);
    return () => {
      disposed = true;
      ro.disconnect();
      fgRef.current?._destructor?.();
      fgRef.current = null;
      for (const g of geoCache.current.values()) g.dispose();
      for (const m of matCache.current.values()) m.dispose();
      geoCache.current.clear();
      matCache.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => {
    viewRef.current = view;
    derivedRef.current = deriveHighlight(adjRef.current, view);
    const f = framing();
    labelSizeRef.current = f ? Math.min(14, Math.max(4.5, f.dist / 55)) : 6; // labels scale with the camera distance
    applyStyles();
    frameCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  return <div ref={elRef} className="graph-3d" role="img" aria-label="Capability graph, 3D. Drag to orbit and tilt, scroll to zoom. Results are listed in the side panel." />;
}
