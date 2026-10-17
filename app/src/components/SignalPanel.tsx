"use client";
// Side panel for the six People Signals (bridges, overloaded connectors, rising stars, knowledge islands,
// experts to re-engage, off-chart contributors). One layout; each item names the records behind it.
import { useState } from "react";
import { Icon } from "./Icon";
import type { SignalItem, SignalResult } from "../lib/types";

function Spark({ values, labels }: { values: number[]; labels: string[] }) {
  const max = Math.max(1, ...values);
  return (
    <figure className="spark" aria-label={`Contributions per quarter: ${values.map((v, i) => `${labels[i]} ${v}`).join(", ")}`}>
      <div className="spark-bars" aria-hidden="true">
        {values.map((v, i) => <i key={i} style={{ height: `${Math.max(4, (v / max) * 100)}%` }} className={labels[i]?.startsWith("2026") ? "y26" : undefined} title={`${labels[i]}: ${v}`} />)}
      </div>
      <figcaption className="muted">2025 <span>2026</span></figcaption>
    </figure>
  );
}

function Item({ it, active, onShow, onFocus, index }: { it: SignalItem; active: boolean; onShow: (it: SignalItem) => void; onFocus: (id: string) => void; index: number }) {
  return (
    <li className={`sig rise${active ? " disc-active" : ""}`} style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}>
      <div className="sig-head">
        <button className="cand-name" onClick={() => onFocus(it.focusId)} aria-label={`Open ${it.title}`}>
          <span><strong>{it.title}</strong><span className="muted">{it.subtitle}</span></span>
        </button>
        <span className="sig-metric"><b className="num">{it.metric}</b><span className="muted">{it.metricLabel}</span></span>
      </div>
      {it.spark && <Spark values={it.spark} labels={it.sparkLabels ?? []} />}
      <ul className="facts">{it.facts.map((f) => <li key={f}>{f}</li>)}</ul>
      {it.people.length > 1 && <div className="chips">{it.people.slice(0, 6).map((p) => <button key={p.id} className="chip chip-btn" onClick={() => onFocus(p.id)}>{p.name}</button>)}</div>}
      <div className="disc-actions">
        <button className="btn small" aria-pressed={active} onClick={() => onShow(it)}><Icon name="network" />Show on graph</button>
      </div>
    </li>
  );
}

export default function SignalPanel({ result, error, activeId, onShow, onFocus }: {
  result: SignalResult | null; error: string; activeId: string | null; onShow: (it: SignalItem) => void; onFocus: (id: string) => void;
}) {
  const [showMethod, setShowMethod] = useState(false);
  if (error) return <div className="panel-body"><p role="alert">{error}</p></div>;
  if (!result) return <div className="panel-body"><div className="skeleton" style={{ height: 24, width: "60%" }} /><div className="skeleton" style={{ height: 220, marginTop: 16 }} /></div>;
  const risk = result.kind === "bottlenecks" || result.kind === "islands";
  return (
    <div className="panel-body">
      <div className="eyebrow">{risk ? "Risk signals" : "People signals"}</div>
      <h2 className="panel-title">{result.title}</h2>
      <p className="narrative">{result.question} {result.description}</p>
      <button className="btn btn-ghost small" aria-expanded={showMethod} onClick={() => setShowMethod(!showMethod)}>{showMethod ? "Hide" : "Show"} how this is found</button>
      {showMethod && <ul className="assumptions">{result.method.map((m) => <li key={m}>{m}</li>)}</ul>}
      {result.items.length === 0 ? (
        <p className="muted">Nothing stands out right now. This lens re-runs whenever the data is rebuilt.</p>
      ) : (
        <ul className="disc-list">{result.items.map((it, i) => <Item key={it.id} it={it} index={i} active={activeId === it.id} onShow={onShow} onFocus={onFocus} />)}</ul>
      )}
      <p className="note"><Icon name="shield" /> For recognition and planning, never performance scoring. Only people who opted in to visibility are named.</p>
    </div>
  );
}
