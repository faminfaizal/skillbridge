"use client";
// Detail panel for any non-person node (project, system, skill, customer, incident...): what it connects to, grouped by type.
// Lets the user walk the graph: system -> projects -> people -> skills (PRD 11.6 "Dive in").
import { useMemo } from "react";
import type { GraphData } from "../lib/types";
import { SHAPES, nodeColor, type EntityType } from "../lib/shapes";
import { ShapeGlyph } from "./ShapeGlyph";

const ORDER: EntityType[] = ["person", "project", "system", "incident", "knowledge", "org", "opportunity", "skill", "problem", "department", "division"];
const PLURAL: Record<string, string> = {
  person: "People", project: "Projects", system: "Systems", incident: "Incidents", knowledge: "Knowledge", org: "Customers and partners",
  opportunity: "Opportunities", skill: "Skills", problem: "Problem types", department: "Departments", division: "Divisions",
};
const RELATION: Record<string, string> = {
  worked_on: "worked on", uses: "uses", maintains: "maintains", depends_on: "depends on", on_system: "incident on", resolved: "resolved",
  authored: "authored", about: "about", supplies: "vendor", serves: "customer", solves: "solves", for_customer: "for", requires: "requires",
  has_skill: "has skill", inferred_skill: "AI-inferred", member_of: "member", part_of: "part of", solved_case: "solved cases", raised: "raised cases",
};

export default function NodePanel({ id, data, onFocus }: { id: string; data: GraphData; onFocus: (id: string) => void }) {
  const node = useMemo(() => data.nodes.find((n) => n.id === id), [data, id]);
  const groups = useMemo(() => {
    const byId = new Map(data.nodes.map((n) => [n.id, n]));
    const out = new Map<string, { id: string; label: string; type: EntityType; color: string; rel: string; inferred: boolean }[]>();
    const seen = new Set<string>();
    for (const e of data.edges) {
      if (e.type === "collaborates") continue;
      const other = e.source === id ? e.target : e.target === id ? e.source : null;
      if (!other || seen.has(other)) continue;
      const n = byId.get(other);
      if (!n) continue;
      seen.add(other);
      const t = n.type as EntityType;
      if (!out.has(t)) out.set(t, []);
      out.get(t)!.push({ id: n.id, label: n.label, type: t, color: nodeColor(n.type, n.attrs), rel: RELATION[e.type] ?? e.type, inferred: e.evidence === "inferred" });
    }
    return ORDER.filter((t) => out.has(t)).map((t) => ({ type: t, items: out.get(t)!.sort((a, b) => a.label.localeCompare(b.label)) }));
  }, [data, id]);

  if (!node) return <div className="panel-body"><p role="alert">This item is not in the graph.</p></div>;
  const t = node.type as EntityType;
  const facts = Object.entries(node.attrs).filter(([k, v]) => ["status", "criticality", "kind", "sector", "severity", "reuse", "family"].includes(k) && v !== null && v !== "");
  return (
    <div className="panel-body">
      <div className="eyebrow node-eyebrow"><ShapeGlyph type={t} color={nodeColor(node.type, node.attrs)} />{SHAPES[t]?.label ?? t}</div>
      <h2 className="panel-title">{node.label}</h2>
      {facts.length > 0 && <div className="chips">{facts.map(([k, v]) => <span key={k} className="chip">{k}: {String(v)}</span>)}</div>}
      <p className="muted small">Connected to {groups.reduce((a, g) => a + g.items.length, 0)} items. Select one to walk the graph.</p>
      {groups.map((g) => (
        <section key={g.type}>
          <h3 className="section-h node-h"><ShapeGlyph type={g.type} />{PLURAL[g.type]} ({g.items.length})</h3>
          <ul className="node-list">
            {g.items.slice(0, 14).map((it) => (
              <li key={it.id}>
                <button className="link-btn" onClick={() => onFocus(it.id)}>{it.label}</button>
                <span className={`muted small${it.inferred ? " inferred-rel" : ""}`}> · {it.rel}</span>
              </li>
            ))}
            {g.items.length > 14 && <li className="muted small">and {g.items.length - 14} more</li>}
          </ul>
        </section>
      ))}
    </div>
  );
}
