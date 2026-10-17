"use client";
// Legend: shape = entity type, colour = division (people). Same vocabulary in 2D and 3D.
// Two narrow vertical columns on the left edge, so it never covers the graph; collapsible.
import { useEffect, useState } from "react";
import { DIVISION_COLOR, DIVISION_LABEL, LEGEND_TYPES, SHAPES } from "../lib/shapes";
import { ShapeGlyph } from "./ShapeGlyph";
import { Icon } from "./Icon";

const KEY = "sb-legend-open";

export default function Legend({ dim }: { dim: "2d" | "3d" }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    try { if (localStorage.getItem(KEY) === "0") setOpen(false); } catch { /* storage unavailable */ }
  }, []);
  function toggle() {
    setOpen(!open);
    try { localStorage.setItem(KEY, open ? "0" : "1"); } catch { /* storage unavailable */ }
  }
  return (
    <section className={`legend${open ? "" : " legend-closed"}`} aria-label="Legend">
      <button className="legend-toggle" aria-expanded={open} aria-controls="legend-body" onClick={toggle}>
        <span className="eyebrow">Legend</span><Icon name="arrow" />
      </button>
      {open && (
        <div id="legend-body" className="legend-body">
          <div className="legend-cols">
            <ul className="legend-col" aria-label="Shapes by type">
              {LEGEND_TYPES.map((t) => <li key={t}><ShapeGlyph type={t} size={12} />{SHAPES[t].label}</li>)}
              <li><i className="dash" aria-hidden="true" />AI-inferred</li>
            </ul>
            <ul className="legend-col" aria-label="People by division">
              <li className="muted">People by division</li>
              {Object.entries(DIVISION_COLOR).map(([id, c]) => <li key={id}><i style={{ background: c }} aria-hidden="true" />{DIVISION_LABEL[id]}</li>)}
            </ul>
          </div>
          {dim === "3d" && <p className="legend-hint muted">Top to bottom: organisation, skills, people, work, systems, customers. Drag to orbit, right-drag to pan, scroll to zoom.</p>}
        </div>
      )}
    </section>
  );
}
