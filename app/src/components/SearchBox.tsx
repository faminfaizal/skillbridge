"use client";
// Global search (ARIA combobox): people, projects and systems by name, title or kind. "/" focuses it.
import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphData } from "../lib/types";
import { ShapeGlyph } from "./ShapeGlyph";
import { DIVISION_LABEL, SHAPES, nodeColor, type EntityType } from "../lib/shapes";

const SEARCHABLE = new Set(["person", "project", "system"]);

export default function SearchBox({ data, onPick }: { data: GraphData | null; onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const index = useMemo(() => (data?.nodes ?? [])
    .filter((n) => SEARCHABLE.has(n.type))
    .map((n) => ({
      id: n.id, type: n.type as EntityType, label: n.label, color: nodeColor(n.type, n.attrs),
      sub: n.type === "person" ? `${n.attrs.title ?? ""} · ${DIVISION_LABEL[String(n.attrs.division)] ?? ""}` : n.type === "system" ? String(n.attrs.kind ?? "System") : `Project · ${n.attrs.status ?? ""}`,
      hay: `${n.label} ${n.attrs.title ?? ""} ${n.attrs.kind ?? ""}`.toLowerCase(),
    })), [data]);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    return index
      .filter((x) => x.hay.includes(s))
      .sort((a, b) => Number(!a.label.toLowerCase().startsWith(s)) - Number(!b.label.toLowerCase().startsWith(s)) || a.label.localeCompare(b.label))
      .slice(0, 8);
  }, [q, index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && t.tagName !== "INPUT" && t.tagName !== "TEXTAREA") { e.preventDefault(); inputRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function pick(id: string) {
    onPick(id);
    setOpen(false);
    setQ("");
    inputRef.current?.blur();
  }

  const expanded = open && q.trim().length >= 2;
  return (
    <div className="search">
      <label htmlFor="global-search" className="sr-only">Search people, projects and systems</label>
      <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
      <input
        id="global-search" ref={inputRef} type="search" autoComplete="off" placeholder="Search people, projects, systems ( / )"
        role="combobox" aria-expanded={expanded} aria-controls="search-list" aria-autocomplete="list"
        aria-activedescendant={expanded && results[active] ? `opt-${results[active].id}` : undefined}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === "Enter" && results[active]) { e.preventDefault(); pick(results[active].id); }
          else if (e.key === "Escape") { setQ(""); setOpen(false); }
        }}
      />
      {expanded && (
        <ul id="search-list" role="listbox" className="search-list panel" aria-label="Search results">
          {results.length === 0 && <li className="search-empty" role="presentation">No person, project or system matches "{q}".</li>}
          {results.map((r, i) => (
            <li key={r.id} id={`opt-${r.id}`} role="option" aria-selected={i === active} className={i === active ? "active" : ""}
              onMouseDown={(e) => { e.preventDefault(); pick(r.id); }} onMouseEnter={() => setActive(i)}>
              <ShapeGlyph type={r.type} color={r.color} />
              <span className="search-text"><b>{r.label}</b><span className="muted">{r.sub}</span></span>
              <span className="search-kind">{SHAPES[r.type].label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
