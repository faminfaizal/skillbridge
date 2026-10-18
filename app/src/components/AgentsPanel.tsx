"use client";
// AI agents: proposal inbox (human approval), live activity (each run's tool calls), the agent roster, and the demo
// data feed. Agents propose; people decide.
import { useState } from "react";
import CloudStatus from "./CloudStatus";
import { Icon } from "./Icon";
import { aiLabel, money } from "../lib/format";
import type { AgentId, AgentsView, InboxItem } from "../lib/types";

export type AgentsData = AgentsView & { scenarios: { id: string; label: string; detail: string; agents: string }[] };
type Tab = "inbox" | "activity" | "agents";

const AGENT_ICON: Record<AgentId, string> = { connectivity: "network", people: "trend", scout: "spark", sentinel: "alert", concierge: "brief" };
const AGENT_SHORT: Record<AgentId, string> = { connectivity: "Connectivity", people: "People Growth", scout: "Opportunity Scout", sentinel: "Risk Sentinel", concierge: "Concierge" };
const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
};

function Proposal({ p, onDecide, onShow, busy }: { p: InboxItem; onDecide: (id: number, d: "approve" | "dismiss") => void; onShow: (ids: string[]) => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`proposal rise ag-${p.agent}${p.status !== "pending" ? " decided" : ""}`}>
      <div className="row-between">
        <span className="ag-tag"><Icon name={AGENT_ICON[p.agent]} />{AGENT_SHORT[p.agent]}</span>
        {p.valueAmt > 0 && <b className="num prop-value">{money(p.valueAmt)}</b>}
      </div>
      <strong>{p.title}</strong>
      <p className="small">{p.detail}</p>
      <p className="muted small">For: {p.approver} · <span title="Which AI service drafted this">drafted by {p.provider === "rules" ? "rules" : aiLabel(p.provider)}</span> · {ago(p.createdAt)}</p>
      <button className="btn btn-ghost why-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>Evidence ({p.evidence.length}) <Icon name="arrow" /></button>
      {open && <ul className="evidence rise">{p.evidence.map((e) => <li key={e}>{e}</li>)}</ul>}
      {p.status === "pending" ? (
        <div className="disc-actions">
          <button className="btn small btn-approve" disabled={busy} onClick={() => onDecide(p.id, "approve")}><Icon name="check" />Approve</button>
          <button className="btn small" disabled={busy} onClick={() => onDecide(p.id, "dismiss")}><Icon name="x" />Dismiss</button>
          <button className="btn btn-ghost small" onClick={() => onShow(p.nodeIds)}><Icon name="network" />Show on graph</button>
        </div>
      ) : (
        <p className={`small outcome ${p.status}`} role="status"><Icon name={p.status === "approved" ? "check" : "x"} /> {p.outcome}</p>
      )}
    </li>
  );
}

export default function AgentsPanel({ data, error, onSimulate, onDecide, onReset, onShow, simulating, deciding }: {
  data: AgentsData | null; error: string; simulating: string | null; deciding: boolean;
  onSimulate: (id: string) => void; onDecide: (id: number, d: "approve" | "dismiss") => void; onReset: () => void; onShow: (ids: string[]) => void;
}) {
  const [tab, setTab] = useState<Tab>("inbox");
  if (error) return <div className="panel-body"><p role="alert">{error}</p></div>;
  if (!data) return <div className="panel-body"><div className="skeleton" style={{ height: 24, width: "60%" }} /><div className="skeleton" style={{ height: 220, marginTop: 16 }} /></div>;
  const pending = data.inbox.filter((i) => i.status === "pending");
  const decided = data.inbox.filter((i) => i.status !== "pending");
  const tabs: [Tab, string][] = [["inbox", `Inbox${pending.length ? ` (${pending.length})` : ""}`], ["activity", "Activity"], ["agents", "Agents"]];
  return (
    <div className="panel-body">
      <div className="eyebrow"><Icon name="spark" /> AI agents</div>
      <h2 className="panel-title">Five agents, one capability graph</h2>
      <div className="ag-strip" aria-label="Agent status">
        {data.agents.map((a) => (
          <span key={a.id} className={`ag-chip${a.state === "running" ? " running" : ""}`} title={a.goal}>
            <span className="ag-dot" aria-hidden="true" /><Icon name={a.icon} />{AGENT_SHORT[a.id]}<span className="sr-only">{a.state === "running" ? " running" : " idle"}</span>
          </span>
        ))}
      </div>
      <p className="muted small" role="status" aria-live="polite">
        {data.busy ? "Agents are working on new data…" : data.queued ? `${data.queued} change${data.queued === 1 ? "" : "s"} queued` : "Watching for data changes."}
      </p>

      <CloudStatus compact />
      <section className="sim card" aria-labelledby="sim-h">
        <div className="row-between"><h3 id="sim-h" className="section-h" style={{ margin: 0 }}>Simulate new data</h3><span className="chip">Demo feed</span></div>
        <p className="muted small">Writes records into the data tables; database triggers log them and the agents react, as to a real HR or ITSM feed.</p>
        <div className="sim-grid">
          {data.scenarios.map((s) => (
            <button key={s.id} className="sim-btn" disabled={!!simulating || data.busy} onClick={() => onSimulate(s.id)} title={s.detail} aria-describedby={`sim-${s.id}`}>
              {simulating === s.id ? <span className="spinner" aria-hidden="true" /> : <Icon name="zap" />}
              <span><b>{s.label}</b><span className="sim-agents">{s.agents}</span><span id={`sim-${s.id}`} className="sr-only">{s.detail}</span></span>
            </button>
          ))}
        </div>
      </section>

      <div className="tabs" role="tablist" aria-label="Agent views">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls={`tabpanel-${id}`} className="tab" onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      <div role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`} className="tabpanel">
        {tab === "inbox" && (
          <>
            {!pending.length && <p className="muted small">No proposals waiting. Simulate new data to see the agents react.</p>}
            <ul className="disc-list">{pending.map((p) => <Proposal key={p.id} p={p} onDecide={onDecide} onShow={onShow} busy={deciding} />)}</ul>
            {decided.length > 0 && <><h3 className="section-h">Decided</h3><ul className="disc-list">{decided.slice(0, 8).map((p) => <Proposal key={p.id} p={p} onDecide={onDecide} onShow={onShow} busy={deciding} />)}</ul></>}
          </>
        )}
        {tab === "activity" && (
          <>
            {!data.runs.length && <p className="muted small">No runs yet.</p>}
            <ol className="runs">
              {data.runs.map((r) => (
                <li key={r.id} className={`run ag-${r.agent} ${r.status}`}>
                  <div className="row-between">
                    <span className="ag-tag"><Icon name={AGENT_ICON[r.agent]} />{AGENT_SHORT[r.agent]}</span>
                    <span className="muted small">{r.status === "running" ? "running…" : ago(r.finishedAt ?? r.startedAt)}</span>
                  </div>
                  <p className="small"><span className="muted">Trigger:</span> {r.trigger}</p>
                  <ol className="steps-list">
                    {r.steps.map((s, i) => (
                      <li key={i}><span className={`step-tool${s.ai ? " ai" : ""}`}>{s.ai && <Icon name="spark" />}{s.tool}</span> <span className="muted">{s.detail}</span>{s.ms > 0 && <span className="muted num"> · {s.ms} ms</span>}</li>
                    ))}
                  </ol>
                  <p className="small"><b>{r.summary}</b>{r.provider && r.provider !== "rules" && r.provider !== "template" ? <span className="muted"> · AI: {aiLabel(r.provider)}</span> : null}</p>
                  {r.nodeIds.length > 0 && <button className="btn btn-ghost small" onClick={() => onShow(r.nodeIds)}><Icon name="network" />Show on graph</button>}
                </li>
              ))}
            </ol>
          </>
        )}
        {tab === "agents" && (
          <ul className="disc-list">
            {data.agents.map((a) => (
              <li key={a.id} className={`agent-card ag-${a.id}`}>
                <div className="row-between"><strong><Icon name={a.icon} /> {a.name}</strong><span className="muted small">{a.runs} run{a.runs === 1 ? "" : "s"}{a.lastRun ? `, last ${ago(a.lastRun)}` : ""}</span></div>
                <p className="small">{a.goal}</p>
                <dl className="agent-spec">
                  <dt>Triggers</dt><dd>{a.triggers.join("; ")}</dd>
                  <dt>Tools</dt><dd>{a.tools.join(", ")}</dd>
                  <dt>AI step</dt><dd>{a.aiStep}</dd>
                  <dt>Proposes</dt><dd>{a.proposes.join("; ")}</dd>
                  <dt>Approver</dt><dd>{a.approver}</dd>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="note"><Icon name="shield" /> Agents propose, people decide. Figures come from the engine; AI drafts the words. Only people who opted in to visibility are named.</p>
      <button className="btn btn-ghost small btn-danger" onClick={onReset} disabled={!!simulating || data.busy}><Icon name="reset" />Reset agent demo</button>
    </div>
  );
}
