"use client";
import { useEffect, useState } from "react";
import { Icon } from "../../components/Icon";
import AiStatus from "../../components/AiStatus";
import CloudStatus from "../../components/CloudStatus";
import Sankey from "../../components/Sankey";
import { aiLabel, money } from "../../lib/format";
import type { ImpactSummary } from "../../lib/types";
import type { SocialLedger } from "../../lib/engine/social";

interface SocialResp { ledger: SocialLedger; statement: { text: string; provider: string; grounded: boolean } }
interface QuarterResp { source: "bigquery" | "sqlite"; rows: { quarter: string; activations: number; value: number }[]; jobMs?: number }

const num = (x: number) => x.toLocaleString("en-US", { maximumFractionDigits: 1 });

function SocialSection({ d, err }: { d: SocialResp | null; err: boolean }) {
  return (
    <section className="panel social" aria-labelledby="soc-h">
      <div className="social-head">
        <h2 id="soc-h" className="section-h">Social and environmental value</h2>
        <a className="small" href="/ledger">Live ledger (Firestore)</a>
      </div>
      {err && <p className="small muted" role="alert">Could not load the social ledger. Reload to try again.</p>}
      {!d && !err && <div className="skeleton" style={{ height: 96 }} />}
      {d && (
        <>
          <div className="social-tiles">
            {d.ledger.lines.map((l) => (
              <div key={l.key} className="social-tile">
                <span className="eyebrow">{l.label}</span>
                <b>{num(l.value)} <small>{l.value === 1 && l.unit === "people" ? "person" : l.unit}</small></b>
                <span className="small muted">History {num(l.seed)}, in the app {num(l.live)}</span>
                {l.note && <span className="small muted">{l.note}</span>}
              </div>
            ))}
          </div>
          <p className="social-statement">
            {d.statement.text}
            <span className="small muted"> ({aiLabel(d.statement.provider)}{d.statement.grounded ? ", every figure checked against the ledger" : ""})</span>
          </p>
          <details className="social-how">
            <summary className="small">How we count</summary>
            <ul className="assumptions">
              {d.ledger.lines.map((l) => <li key={l.key}><b>{l.label}:</b> {l.basis}</li>)}
              {d.ledger.assumptions.map((a) => <li key={a}>{a}</li>)}
            </ul>
          </details>
        </>
      )}
    </section>
  );
}

function QuartersPanel({ q, err }: { q: QuarterResp | null; err: boolean }) {
  const rows = q?.rows ?? [];
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <section className="panel quarters" aria-labelledby="q-h">
      <div className="social-head">
        <h2 id="q-h" className="section-h">Value by quarter, from BigQuery</h2>
        {q && <span className={`q-source ${q.source}`}>{q.source === "bigquery" ? `BigQuery${q.jobMs != null ? `, ${Math.round(q.jobMs)} ms` : ""}` : "SQLite fallback"}</span>}
      </div>
      <CloudStatus compact />
      {err && <p className="small muted" role="alert">Could not load the quarters. Reload to try again.</p>}
      {!q && !err && <div className="skeleton" style={{ height: 120 }} />}
      {q && !rows.length && <p className="small muted">No quarters recorded yet. Activations appear here once they are synced.</p>}
      {rows.length > 0 && (
        <table className="q-bars">
          <caption className="sr-only">Value unlocked per quarter, with the number of activations</caption>
          <thead><tr><th scope="col">Quarter</th><th scope="col">Value unlocked</th><th scope="col" className="n">Activations</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.quarter} title={`${r.quarter}: ${money(r.value)} from ${r.activations} activation${r.activations === 1 ? "" : "s"}`}>
                <th scope="row">{r.quarter}</th>
                <td><span className="q-bar" aria-hidden="true"><i style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} /></span><span className="q-val">{money(r.value)}</span></td>
                <td className="n small muted">{r.activations}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default function ValuePage() {
  const [s, setS] = useState<ImpactSummary | null>(null);
  const [err, setErr] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [social, setSocial] = useState<SocialResp | null>(null);
  const [socialErr, setSocialErr] = useState(false);
  const [quarters, setQuarters] = useState<QuarterResp | null>(null);
  const [quartersErr, setQuartersErr] = useState(false);

  const json = (r: Response) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); };
  const load = () => {
    fetch("/api/impact").then(json).then(setS).catch(() => setErr("Could not load impact records."));
    fetch("/api/social").then(json).then((d: SocialResp) => { if (!d?.ledger?.lines) throw new Error("shape"); setSocial(d); setSocialErr(false); }).catch(() => setSocialErr(true));
    fetch("/api/value/quarters").then(json).then((d: QuarterResp) => { setQuarters({ source: d?.source === "bigquery" ? "bigquery" : "sqlite", rows: Array.isArray(d?.rows) ? d.rows : [], jobMs: d?.jobMs }); setQuartersErr(false); })
      .catch(() => setQuartersErr(true));
  };
  useEffect(() => { load(); }, []);

  async function reset() {
    await fetch("/api/impact", { method: "DELETE" });
    setConfirming(false);
    load();
  }

  const t = s?.totals;
  const fresh = s?.records.filter((r) => r.source === "activated") ?? [];
  return (
    <div className="value-page">
      <header className="topbar">
        <a className="brand" href="/" aria-label="AI SkillBridge home"><span className="logo" aria-hidden="true"><Icon name="network" /></span><span>AI SkillBridge</span></a>
        <span style={{ margin: "0 auto" }} />
        <a className="btn" href="/"><Icon name="back" />Back to the graph</a>
        <AiStatus />
      </header>
      <main id="main" className="value-main">
        <div className="value-head">
          <div>
            <div className="eyebrow">Strategic reinvestment</div>
            <h1>{t ? `${money(t.total)} of value unlocked.` : "Value unlocked"} Where should it go next?</h1>
          </div>
          {fresh.length > 0 && (confirming ? (
            <span className="chips" role="group" aria-label="Confirm reset">
              <span className="small muted">Remove {fresh.length} record{fresh.length > 1 ? "s" : ""} created in this demo?</span>
              <button className="btn btn-danger small" onClick={reset}>Remove</button>
              <button className="btn small" onClick={() => setConfirming(false)}>Keep</button>
            </span>
          ) : <button className="btn btn-danger small" onClick={() => setConfirming(true)}><Icon name="reset" />Reset demo records</button>)}
        </div>
        {err && <p role="alert">{err}</p>}
        {!s && !err && <div className="skeleton" style={{ height: 120 }} />}
        {s && t && (
          <>
            <section className="kpis" aria-label="Financial value">
              <div className="kpi total"><span className="eyebrow">Total value unlocked</span><b>{money(t.total)}</b><p>{s.records.length} activations to date</p></div>
              <div className="kpi" style={{ ["--c" as string]: "var(--cost)" }}><span className="eyebrow">Cost avoided</span><b>{money(t.costAvoided)}</b><p>External cost − internal cost</p></div>
              <div className="kpi" style={{ ["--c" as string]: "var(--prod)" }}><span className="eyebrow">Productivity</span><b>{money(t.productivity)}</b><p>Hours recovered × loaded labour cost</p></div>
              <div className="kpi" style={{ ["--c" as string]: "#6ee7b7" }}><span className="eyebrow">Recruitment avoided</span><b>{money(t.recruitment)}</b><p>Hires avoided × recruitment cost</p></div>
              <div className="kpi" style={{ ["--c" as string]: "var(--rev)" }}><span className="eyebrow">Revenue</span><b>{money(t.revenue)}</b><p>Won or influenced with internal teams</p></div>
            </section>
            <div className="value-grid">
              <section className="panel" aria-labelledby="flow-h">
                <h2 id="flow-h" className="section-h">From value to future capability</h2>
                <Sankey
                  totalLabel={`${money(t.total)} unlocked`}
                  sources={[
                    { label: "Cost avoided", value: t.costAvoided, color: "#34d399" },
                    { label: "Productivity", value: t.productivity, color: "#38bdf8" },
                    { label: "Recruitment avoided", value: t.recruitment, color: "#6ee7b7" },
                    { label: "Revenue", value: t.revenue, color: "#fbbf24" },
                  ].filter((x) => x.value > 0)}
                  targets={s.initiatives.map((i) => ({ label: i.name, value: i.allocation_amt, color: "#a78bfa", note: i.outcome }))}
                />
                <p className="small muted">Suggested reinvestment of the value unlocked into initiatives that build future capability. Allocations are illustrative.</p>
              </section>
              <section className="panel" aria-labelledby="cap-h">
                <h2 id="cap-h" className="section-h">Capability</h2>
                <div className="cap-tiles">
                  <div><b>{s.capability.peopleActivated}</b><span className="small muted">people activated</span></div>
                  <div><b>{s.capability.hiddenSkills}</b><span className="small muted">hidden skills discovered</span></div>
                  <div><b>{s.capability.projectsStaffed}</b><span className="small muted">teams staffed internally</span></div>
                  <div><b>{s.capability.gaps}</b><span className="small muted">open capability gaps</span></div>
                </div>
              </section>
            </div>
            <div className="value-grid">
              <SocialSection d={social} err={socialErr} />
              <QuartersPanel q={quarters} err={quartersErr} />
            </div>
            <section className="panel" style={{ padding: "16px 24px" }} aria-labelledby="rec-h">
              <h2 id="rec-h" className="section-h">Impact records</h2>
              <div className="table-wrap">
                <table className="records">
                  <thead><tr><th>Date</th><th>Activation</th><th className="n">People</th><th className="n">Cost avoided</th><th className="n">Productivity</th><th className="n">Recruitment</th><th className="n">Revenue</th></tr></thead>
                  <tbody>
                    {s.records.map((r) => (
                      <tr key={r.id} className={r.source === "activated" ? "new" : ""}>
                        <td className="num">{r.date}</td>
                        <td>{r.title}{r.source === "activated" && <span className="badge-new">NEW</span>}</td>
                        <td className="n">{r.people_count}</td>
                        <td className="n">{r.cost_avoided_amt ? money(r.cost_avoided_amt) : "None"}</td>
                        <td className="n">{money(r.productivity_amt)}</td>
                        <td className="n">{r.recruitment_amt ? money(r.recruitment_amt) : "None"}</td>
                        <td className="n">{r.revenue_amt ? money(r.revenue_amt) : "None"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
