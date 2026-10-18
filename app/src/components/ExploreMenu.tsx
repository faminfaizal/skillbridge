"use client";
// One "Explore" dropdown for every lens on the graph (WAI-ARIA menu button pattern with radio items).
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import type { SignalKind } from "../lib/types";

export type Lens = "explore" | "discover" | "talent" | "risk" | "crisis" | "community" | SignalKind;

export const LENSES: { group: string; items: { id: Lens; label: string; hint: string; icon: string }[] }[] = [
  { group: "Graph", items: [{ id: "explore", label: "Whole organisation", hint: "The living capability graph", icon: "network" }] },
  { group: "Opportunities", items: [{ id: "discover", label: "Opportunities", hint: "Revenue, savings and risks found in the graph", icon: "spark" }] },
  {
    group: "People", items: [
      { id: "talent", label: "Hidden talent", hint: "High contribution, low visibility", icon: "star" },
      { id: "rising", label: "Rising stars", hint: "Contribution growing fastest", icon: "trend" },
      { id: "bridges", label: "Collaboration bridges", hint: "The only link between teams", icon: "bridge" },
      { id: "forgotten", label: "Experts to re-engage", hint: "Proven experts whose activity faded", icon: "reset" },
      { id: "ghosts", label: "Off-chart contributors", hint: "Big work outside their formal role", icon: "offchart" },
      { id: "inclusion", label: "Opportunity equity", hint: "Does opportunity reach every location?", icon: "users" },
    ],
  },
  {
    group: "Act", items: [
      { id: "crisis", label: "Incident response team", hint: "A situation report becomes a nearby team", icon: "zap" },
      { id: "community", label: "Community skills exchange", hint: "Volunteers matched to community requests", icon: "hand" },
    ],
  },
  {
    group: "Risk", items: [
      { id: "risk", label: "Dependency risk", hint: "Systems that rest on a few people", icon: "alert" },
      { id: "bottlenecks", label: "Overloaded connectors", hint: "Too much work flows through one person", icon: "gauge" },
      { id: "islands", label: "Knowledge islands", hint: "Expertise trapped in one team", icon: "island" },
    ],
  },
];
const FLAT = LENSES.flatMap((g) => g.items);

export function lensLabel(id: Lens): string {
  return FLAT.find((x) => x.id === id)?.label ?? "Whole organisation";
}

export default function ExploreMenu({ value, onChange }: { value: Lens; onChange: (l: Lens) => void }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const btn = useRef<HTMLButtonElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const current = FLAT.find((x) => x.id === value) ?? FLAT[0];

  useEffect(() => {
    if (!open) return;
    items.current[active]?.focus();
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function openAt(i: number) { setActive(i); setOpen(true); }
  function choose(id: Lens) { setOpen(false); onChange(id); btn.current?.focus(); }

  function onButtonKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") { e.preventDefault(); openAt(Math.max(0, FLAT.findIndex((x) => x.id === value))); }
    if (e.key === "ArrowUp") { e.preventDefault(); openAt(FLAT.length - 1); }
  }
  function onMenuKey(e: React.KeyboardEvent) {
    const n = FLAT.length;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % n); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + n) % n); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(n - 1); }
    else if (e.key === "Escape" || e.key === "Tab") { setOpen(false); if (e.key === "Escape") btn.current?.focus(); }
  }

  let idx = -1;
  return (
    <div className="explore" ref={wrap}>
      <button ref={btn} className="btn explore-btn" aria-haspopup="menu" aria-expanded={open} aria-controls="explore-menu"
        onClick={() => (open ? setOpen(false) : openAt(Math.max(0, FLAT.findIndex((x) => x.id === value))))} onKeyDown={onButtonKey}>
        <Icon name={current.icon} />
        <span className="explore-label"><span className="explore-kicker">Explore</span>{current.label}</span>
        <Icon name="chevron" className="icon chev" />
      </button>
      {open && (
        <div id="explore-menu" className="explore-menu panel rise" role="menu" aria-label="Explore" onKeyDown={onMenuKey}>
          {LENSES.map((g) => (
            <div key={g.group} role="group" aria-label={g.group} className="explore-group">
              <div className="explore-group-h" aria-hidden="true">{g.group}</div>
              {g.items.map((it) => {
                idx += 1;
                const i = idx;
                return (
                  <button key={it.id} ref={(el) => { items.current[i] = el; }} role="menuitemradio" aria-checked={it.id === value} tabIndex={i === active ? 0 : -1}
                    className="explore-item" onClick={() => choose(it.id)} onMouseEnter={() => setActive(i)}>
                    <Icon name={it.icon} />
                    <span><b>{it.label}</b><span className="muted">{it.hint}</span></span>
                    {it.id === value && <Icon name="check" className="icon tick" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
