"use client";
// Executive Intelligence answers and the Opportunity Discovery board (PRD 8.6, 8.7).
import { useState } from "react";
import { Icon } from "./Icon";
import { aiLabel, money } from "../lib/format";
import { EXEC_QUESTIONS } from "../lib/questions";
import type { DiscoveryCard, DiscoveryResult, DiscoveryType, ExecAnswer } from "../lib/types";

const TONE: Record<string, string> = { cost: "var(--cost)", prod: "var(--prod)", rev: "var(--rev)", risk: "var(--danger)", neutral: "var(--accent-2)" };

// ---------------------------------------------------------------- executive answer
export function ExecPanel({ r, onFocus, onAsk }: { r: ExecAnswer; onFocus: (id: string) => void; onAsk: (q: string) => void }) {
  const [showAssumptions, setShowAssumptions] = useState(false);
  const others = Object.entries(EXEC_QUESTIONS).filter(([k]) => k !== r.intent);
  return (
    <div className="panel-body">
      <div className="eyebrow"><Icon name="brief" /> Executive intelligence</div>
      <h2 className="panel-title">{r.question}</h2>
      {r.query.trim().toLowerCase() !== r.question.toLowerCase() && <p className="muted small">You asked: "{r.query}"</p>}

      <div className="decision rise">
        <span className="eyebrow">Decision</span>
        <p>{r.headline}</p>
      </div>
      <p className="narrative"><span className="chip" title="Which AI service wrote this brief">AI brief: {aiLabel(r.provider)}</span> {r.narrative}</p>

      <section aria-label="Key figures" className="value-tiles">
        {r.metrics.map((m) => (
          <div key={m.label} className="tile" style={{ ["--c" as string]: TONE[m.tone] }}><span className="eyebrow">{m.label}</span><b className="num">{m.value}</b></div>
        ))}
      </section>

      {r.table.rows.length > 0 && (
        <div className="table-wrap exec-table" role="region" aria-label="Supporting data" tabIndex={0}>
          <table className="records">
            <thead><tr>{r.table.columns.map((c) => <th key={c.label} className={c.numeric ? "n" : undefined} scope="col">{c.label}</th>)}</tr></thead>
            <tbody>
              {r.table.rows.map((row, i) => (
                <tr key={i}>
                  {row.cells.map((cell, j) => (
                    <td key={j} className={r.table.columns[j]?.numeric ? "n" : undefined}>
                      {j === 0 && row.focusId ? <button className="link-btn" onClick={() => onFocus(row.focusId!)}>{cell}</button> : cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="section-h">Recommended next steps</h3>
      <ul className="exec-actions">
        {r.actions.map((a) => (
          <li key={a.label} className="card">
            <strong>{a.label}</strong>
            <p className="small muted">{a.detail}</p>
            {a.query && <button className="btn small" onClick={() => onAsk(a.query!)}><Icon name="arrow" />Ask this</button>}
            {a.href && <a className="btn small" href={a.href}><Icon name="chart" />Open</a>}
          </li>
        ))}
      </ul>

      <button className="btn btn-ghost small" aria-expanded={showAssumptions} onClick={() => setShowAssumptions(!showAssumptions)}>
        {showAssumptions ? "Hide" : "Show"} how this is calculated
      </button>
      {showAssumptions && <ul className="assumptions">{r.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>}

      <h3 className="section-h">Other executive questions</h3>
      <div className="chips">{others.map(([k, q]) => <button key={k} className="chip chip-btn" onClick={() => onAsk(q)}>{q}</button>)}</div>
    </div>
  );
}

// ---------------------------------------------------------------- opportunity discovery
export const DISCOVERY_META: Record<DiscoveryType, { label: string; icon: string; color: string }> = {
  revenue: { label: "Revenue", icon: "coin", color: "var(--rev)" },
  external_spend: { label: "External spend", icon: "coin", color: "var(--cost)" },
  capacity: { label: "Spare capacity", icon: "clock", color: "var(--prod)" },
  reskill: { label: "Reskill, don't hire", icon: "grad", color: "var(--accent-2)" },
  duplicate: { label: "Duplicated work", icon: "copy", color: "var(--cost)" },
  hidden_expert: { label: "Hidden expert", icon: "star", color: "var(--warn)" },
  collaboration: { label: "Collaboration", icon: "link", color: "var(--info)" },
  risk: { label: "Key-person risk", icon: "alert", color: "var(--danger)" },
  sme: { label: "SME support", icon: "hand", color: "var(--pink)" },
};

function DiscoveryItem({ c, active, onShow, onFocus, onAsk, index }: {
  c: DiscoveryCard; active: boolean; onShow: (c: DiscoveryCard) => void; onFocus: (id: string) => void; onAsk: (q: string) => void; index: number;
}) {
  const [open, setOpen] = useState(false);
  const meta = DISCOVERY_META[c.type];
  return (
    <li className={`disc rise${active ? " disc-active" : ""}`} style={{ ["--c" as string]: meta.color, animationDelay: `${Math.min(index, 10) * 40}ms` }}>
      <div className="row-between">
        <span className="disc-type"><Icon name={meta.icon} />{meta.label}</span>
        <b className="num disc-metric">{c.metric}</b>
      </div>
      <strong className="disc-title">{c.title}</strong>
      <p className="small">{c.detail}</p>
      {c.valueAmt > 0 && <p className="muted small"><b className="num">{money(c.valueAmt)}</b> {c.valueLabel}</p>}
      {c.people.length > 0 && (
        <div className="chips">{c.people.slice(0, 5).map((p) => <button key={p.id} className="chip chip-btn" onClick={() => onFocus(p.id)}>{p.name}</button>)}</div>
      )}
      <button className="btn btn-ghost why-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>Evidence ({c.evidence.length}) <Icon name="arrow" /></button>
      {open && <ul className="evidence rise">{c.evidence.map((e) => <li key={e}>{e}</li>)}</ul>}
      <div className="disc-actions">
        <button className="btn small" aria-pressed={active} onClick={() => onShow(c)}><Icon name="network" />Show on graph</button>
        <button className="btn small" onClick={() => (c.action.query ? onAsk(c.action.query) : c.action.focusId && onFocus(c.action.focusId))}>
          <Icon name="arrow" />{c.action.label}
        </button>
      </div>
    </li>
  );
}

export function DiscoverPanel({ result, error, activeId, onShow, onFocus, onAsk }: {
  result: DiscoveryResult | null; error: string; activeId: string | null;
  onShow: (c: DiscoveryCard) => void; onFocus: (id: string) => void; onAsk: (q: string) => void;
}) {
  const [filter, setFilter] = useState<DiscoveryType | "all">("all");
  if (error) return <div className="panel-body"><p role="alert">{error}</p></div>;
  if (!result) return <div className="panel-body"><div className="skeleton" style={{ height: 24, width: "60%" }} /><div className="skeleton" style={{ height: 220, marginTop: 16 }} /></div>;
  const types = [...new Set(result.cards.map((c) => c.type))];
  const shown = filter === "all" ? result.cards : result.cards.filter((c) => c.type === filter);
  return (
    <div className="panel-body">
      <div className="eyebrow"><Icon name="spark" /> Opportunity discovery</div>
      <h2 className="panel-title">What the graph found</h2>
      <p className="muted small">
        {result.cards.length} opportunities worth <b className="num">{money(result.totalValueAmt)}</b>, from a scan of people, projects, systems, cases and spend
        at {new Date(result.generatedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}.
      </p>
      <div className="chips" role="group" aria-label="Filter by type">
        <button className="chip chip-btn" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All {result.cards.length}</button>
        {types.map((t) => (
          <button key={t} className="chip chip-btn" aria-pressed={filter === t} onClick={() => setFilter(t)}>
            {DISCOVERY_META[t].label} {result.cards.filter((c) => c.type === t).length}
          </button>
        ))}
      </div>
      <ul className="disc-list">
        {shown.map((c, i) => <DiscoveryItem key={c.id} c={c} index={i} active={activeId === c.id} onShow={onShow} onFocus={onFocus} onAsk={onAsk} />)}
      </ul>
      <p className="note"><Icon name="shield" /> Every card is a rule over records and names its evidence. People appear only if they opted in to visibility.</p>
    </div>
  );
}
