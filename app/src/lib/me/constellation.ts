// My Constellation: the person's own slice of the capability graph (graph.json) plus profile-only links, laid out
// radially. Ring 1 = everything directly linked to the person; ring 2 = what those projects, incidents and knowledge
// items touch (customers, problem types, systems). Positions are deterministic so the picture is the same every visit.
import { all, get } from "../db.ts";
import { data } from "../engine/data.ts";
import { readGraph } from "../graphBuild.ts";
import { ensureProfileTables } from "./tables.ts";
import type { TabId } from "./types.ts";

export type CType = "person" | "skill" | "project" | "system" | "incident" | "knowledge" | "department" | "division" | "org" | "problem";
export interface CNode {
  id: string; type: CType; label: string; ring: 0 | 1 | 2; x: number; y: number; size: number;
  rel: string; detail: string[]; profileOnly: boolean; tab?: TabId; private?: boolean;
}
export interface CEdge { id: string; source: string; target: string; rel: string; style: "solid" | "inferred" | "profile" }
export interface Constellation { center: { id: string; label: string; title: string }; nodes: CNode[]; edges: CEdge[]; updatedAt: string | null }

const REL: Record<string, string> = {
  has_skill: "Skill on your profile", inferred_skill: "AI-suggested skill", worked_on: "You worked on it", maintains: "You support this system",
  resolved: "You resolved it", authored: "You wrote it", collaborates: "Worked with you", member_of: "Your unit", solved_case: "You solved cases of this type",
  uses: "Used by your project", serves: "Customer of your project", solves: "Problem your project solved", on_system: "System of your incident",
  about: "Your knowledge is about it", depends_on: "Dependency", supplies: "Vendor of a system you touch", for_customer: "Customer", raised: "Raised this problem",
};
const SECTORS: CType[] = ["skill", "project", "person", "system", "incident", "knowledge", "division", "department", "org", "problem"];
const RING2_TYPES = new Set(["system", "org", "problem", "project"]);
const TAB: Partial<Record<CType, TabId>> = { skill: "skills", project: "projects", person: "connections", knowledge: "impact", incident: "evidence" };
const SIZE: Record<number, number> = { 0: 16, 1: 7, 2: 5 };
/** Ring radii in graph units; the canvas draws its guide circles at the same values. */
export const R1 = 1.35;
export const R2 = 2.25;

export function constellation(me: string): Constellation | null {
  ensureProfileTables();
  const m = data();
  const p = m.people.get(me);
  if (!p) return null;
  const g = readGraph();
  const gNodes = new Map((g?.nodes ?? []).map((n) => [n.id, n]));
  const nodes = new Map<string, CNode>();
  const edges = new Map<string, CEdge>();
  const personLabel = (id: string) => {
    const x = m.people.get(id);
    if (!x) return { label: id, priv: false };
    return x.consent_visibility === 1 || id === me ? { label: x.name, priv: false } : { label: "Private colleague", priv: true };
  };
  const add = (id: string, type: CType, label: string, ring: 0 | 1 | 2, rel: string, detail: string[] = [], profileOnly = false, priv = false) => {
    const cur = nodes.get(id);
    if (cur) { if (ring < cur.ring) { cur.ring = ring; cur.rel = rel; } if (!profileOnly) cur.profileOnly = false; return cur; }
    const n: CNode = { id, type, label, ring, x: 0, y: 0, size: SIZE[ring], rel, detail, profileOnly, tab: TAB[type], private: priv || undefined };
    nodes.set(id, n);
    return n;
  };
  const link = (a: string, b: string, type: string, style: CEdge["style"]) => {
    const id = `${a}|${b}|${type}`;
    if (!edges.has(id) && !edges.has(`${b}|${a}|${type}`)) edges.set(id, { id, source: a, target: b, rel: REL[type] ?? type, style });
  };

  add(me, "person", p.name, 0, "You", [p.title]);

  // ---- ring 1: direct graph edges
  const declared = m.declared.get(me);
  const inferred = m.inferred.get(me);
  const assignments = new Map((m.assignments.get(me) ?? []).map((a) => [a.project_id, a]));
  const sysRoles = new Map(all<{ system_id: string; role: string }>("SELECT system_id, role FROM system_roles WHERE person_id = ?", me).map((r) => [r.system_id, r.role]));
  for (const e of g?.edges ?? []) {
    if (e.source !== me && e.target !== me) continue;
    const other = e.source === me ? e.target : e.source;
    const n = gNodes.get(other);
    if (!n || !SECTORS.includes(n.type as CType)) continue;
    const type = n.type as CType;
    let label = n.label;
    let detail: string[] = [];
    let priv = false;
    if (type === "skill") {
      const d = declared?.get(other);
      const i = inferred?.get(other);
      detail = d ? [`Level ${d.level}, last used ${d.last_used_year}`, `Source: ${d.source}`] : i ? [`${Math.round(i.confidence * 100)}% confidence`, i.rationale].filter(Boolean) : [];
    } else if (type === "project") {
      const a = assignments.get(other);
      const pr = m.projects.get(other);
      detail = [a ? `${a.role}, ${a.start_date.slice(0, 7)} to ${a.end_date.slice(0, 7)}, ${a.man_days} days` : "", pr ? `Status: ${pr.status}` : "", a?.contribution_note ?? ""].filter(Boolean);
    } else if (type === "person") {
      const pl = personLabel(other);
      label = pl.label; priv = pl.priv;
      detail = priv ? ["Opted out of discovery"] : [m.people.get(other)?.title ?? "", `${Math.round(e.weight)} shared project${Math.round(e.weight) === 1 ? "" : "s"}`];
    } else if (type === "system") {
      detail = [sysRoles.get(other) ? `Your role: ${sysRoles.get(other)}` : "", n.attrs?.criticality ? `Criticality: ${n.attrs.criticality}` : ""].filter(Boolean);
    } else if (type === "incident") {
      const i = get<{ summary: string; severity: string; opened: string }>("SELECT summary, severity, opened FROM incidents WHERE id = ?", other);
      detail = i ? [i.summary, `${i.severity}, opened ${i.opened.slice(0, 10)}`] : [];
    } else if (type === "knowledge") {
      detail = [`Reused ${n.attrs?.reuse ?? 0} times`];
    }
    add(other, type, label, 1, REL[e.type] ?? e.type, detail, false, priv);
    link(me, other, e.type, e.evidence === "inferred" ? "inferred" : "solid");
  }

  // ---- ring 1 from ERA and the profile (not in the graph, or not yet)
  if (p.manager_id) {
    const pl = personLabel(p.manager_id);
    add(p.manager_id, "person", pl.label, 1, "Your manager", [m.people.get(p.manager_id)?.title ?? ""]);
    link(p.manager_id, me, "reports_to", "solid");
    edges.get(`${p.manager_id}|${me}|reports_to`)!.rel = "Your manager (ERA)";
  }
  for (const r of all<{ id: string; title: string }>("SELECT id, title FROM people WHERE manager_id = ?", me)) {
    const pl = personLabel(r.id);
    add(r.id, "person", pl.label, 1, "Reports to you", [r.title], false, pl.priv);
    link(me, r.id, "manages", "solid");
    edges.get(`${me}|${r.id}|manages`)!.rel = "Reports to you (ERA)";
  }
  for (const d of declared?.values() ?? []) {
    if (nodes.has(d.skill_id)) continue;
    add(d.skill_id, "skill", m.skills.get(d.skill_id)?.name ?? d.skill_id, 1, "Skill on your profile (graph updating)", [`Level ${d.level}, source: ${d.source}`], true);
    link(me, d.skill_id, "has_skill", "profile");
  }
  for (const w of all<{ skill_id: string }>("SELECT skill_id FROM profile_skill_meta WHERE person_id = ? AND want_grow = 1", me)) {
    const n = add(w.skill_id, "skill", m.skills.get(w.skill_id)?.name ?? w.skill_id, 1, "Skill you want to grow", ["Want to grow"], !declared?.has(w.skill_id));
    if (!n.detail.includes("Want to grow")) n.detail.push("Want to grow");
    if (!declared?.has(w.skill_id)) link(me, w.skill_id, "want_grow", "profile");
  }
  for (const pp of all<{ id: string; name: string; type: string; role: string; status: string; project_id: string | null }>(
    "SELECT id, name, type, role, status, project_id FROM profile_projects WHERE person_id = ? AND status <> 'confirmed'", me)) {
    add(`pp:${pp.id}`, "project", pp.name, 1, pp.status === "declined" ? "Your entry, declined" : "Your entry, awaiting confirmation", [`${pp.type}, ${pp.role}`], true);
    link(me, `pp:${pp.id}`, "self_reported", "profile");
  }
  for (const c of all<{ other_id: string; kind: string; skill_id: string | null }>("SELECT other_id, kind, skill_id FROM profile_connections WHERE person_id = ?", me)) {
    const pl = personLabel(c.other_id);
    const rel = c.kind === "mentor" ? "Your mentor" : c.kind === "mentee" ? "Your mentee" : `Your go-to for ${m.skills.get(c.skill_id ?? "")?.name ?? "a skill"}`;
    const n = add(c.other_id, "person", pl.label, 1, rel, [m.people.get(c.other_id)?.title ?? ""], true, pl.priv);
    if (!n.detail.includes(rel)) n.detail.push(rel);
    link(me, c.other_id, `conn_${c.kind}`, "profile");
    edges.get(`${me}|${c.other_id}|conn_${c.kind}`)!.rel = rel;
  }

  // ---- ring 2: what your projects, incidents, knowledge and systems touch
  const ring1 = [...nodes.values()].filter((n) => n.ring === 1 && ["project", "incident", "knowledge", "system"].includes(n.type));
  const ring1Ids = new Set(ring1.map((n) => n.id));
  const r2count = new Map<string, number>();
  const r2edges: { a: string; b: string; type: string }[] = [];
  for (const e of g?.edges ?? []) {
    const a = ring1Ids.has(e.source) ? e.source : ring1Ids.has(e.target) ? e.target : null;
    if (!a) continue;
    const other = a === e.source ? e.target : e.source;
    if (other === me) continue;
    const n = gNodes.get(other);
    if (!n || !RING2_TYPES.has(n.type)) continue;
    r2edges.push({ a, b: other, type: e.type });
    if (!nodes.has(other) || nodes.get(other)!.ring === 2) r2count.set(other, (r2count.get(other) ?? 0) + 1);
  }
  const keep = new Set([...r2count.entries()].sort((x, y) => y[1] - x[1]).slice(0, 36).map(([id]) => id));
  for (const { a, b, type } of r2edges) {
    const n = gNodes.get(b)!;
    if (!nodes.has(b)) {
      if (!keep.has(b)) continue;
      const t = n.type as CType;
      const detail = t === "org" ? [`${n.attrs?.kind ?? "organisation"}${n.attrs?.sector ? `, ${n.attrs.sector}` : ""}`] : t === "system" && n.attrs?.criticality ? [`Criticality: ${n.attrs.criticality}`] : [];
      add(b, t, n.label, 2, REL[type] ?? type, detail);
    }
    link(a, b, type, "solid");
  }

  layout([...nodes.values()], [...edges.values()], me);
  const updatedAt = (g?.meta as { generatedAt?: string } | undefined)?.generatedAt ?? null;
  return { center: { id: me, label: p.name, title: p.title }, nodes: [...nodes.values()], edges: [...edges.values()], updatedAt };
}

/** Radial layout: ring 1 split into sectors by type (span by sqrt of count), ring 2 placed outward from its parents. */
function layout(nodes: CNode[], edges: CEdge[], me: string): void {
  const r1 = nodes.filter((n) => n.ring === 1).sort((a, b) => SECTORS.indexOf(a.type) - SECTORS.indexOf(b.type) || a.label.localeCompare(b.label));
  const groups = SECTORS.map((t) => r1.filter((n) => n.type === t)).filter((g) => g.length);
  const weight = groups.map((g) => Math.sqrt(g.length) + 0.6);
  const total = weight.reduce((s, w) => s + w, 0);
  const gap = 0.08;
  const usable = Math.PI * 2 - gap * groups.length;
  let a0 = -Math.PI / 2;
  const angle = new Map<string, number>();
  groups.forEach((g, gi) => {
    const span = (weight[gi] / total) * usable;
    g.forEach((n, i) => {
      const a = a0 + span * ((i + 0.5) / g.length);
      // Busy sectors stagger over two or three sub-rings so neighbours and their labels do not collide
      const layers = g.length > 16 ? 3 : g.length > 6 ? 2 : 1;
      const r = R1 + ((i % layers) - (layers - 1) / 2) * 0.16;
      n.x = Math.cos(a) * r; n.y = Math.sin(a) * r;
      angle.set(n.id, a);
    });
    a0 += span + gap;
  });
  const center = nodes.find((n) => n.id === me)!;
  center.x = 0; center.y = 0;
  // ring 2: mean angle of ring-1 neighbours, then spread so neighbours keep a minimum separation
  const r2 = nodes.filter((n) => n.ring === 2);
  const nb = new Map<string, number[]>();
  for (const e of edges) {
    for (const [x, y] of [[e.source, e.target], [e.target, e.source]]) {
      if (angle.has(x) && r2.some((n) => n.id === y)) nb.set(y, [...(nb.get(y) ?? []), angle.get(x)!]);
    }
  }
  const meanAngle = (as: number[]) => Math.atan2(as.reduce((s, a) => s + Math.sin(a), 0), as.reduce((s, a) => s + Math.cos(a), 0));
  const placed = r2.map((n) => ({ n, a: meanAngle(nb.get(n.id) ?? [0]) })).sort((x, y) => x.a - y.a);
  const minSep = placed.length ? Math.min(0.22, (Math.PI * 2) / placed.length) : 0;
  for (let i = 1; i < placed.length; i++) if (placed[i].a - placed[i - 1].a < minSep) placed[i].a = placed[i - 1].a + minSep;
  placed.forEach(({ n, a }, i) => { const r = R2 + ((i % 3) - 1) * 0.1; n.x = Math.cos(a) * r; n.y = Math.sin(a) * r; });
  // Sigma's y axis points up; flip so the first sector starts at the top
  for (const n of nodes) n.y = -n.y;
}
