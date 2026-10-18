"use client";
// Public impact ledger: every activation and the value it unlocked, live from the Firestore mirror (SQLite when cloud
// sync is off). No names or person ids. Polls every 5 s so approvals elsewhere appear on their own.
import { useEffect, useState } from "react";
import { Icon } from "../../components/Icon";
import CloudStatus from "../../components/CloudStatus";
import { money } from "../../lib/format";
import type { LedgerView } from "../../lib/cloud/ledger";

export default function LedgerPage() {
  const [v, setV] = useState<LedgerView | null>(null);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/ledger", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((x: LedgerView) => { if (alive) { setV(x); setErr(""); } })
      .catch(() => { if (alive) setErr("Could not load the ledger. Retrying."); });
    load();
    const t = setInterval(load, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setErr("Copy failed: select the address bar to share this page.");
    }
  }

  const t = v?.totals;
  const live = v?.source === "firestore";
  return (
    <div className="value-page">
      <header className="topbar">
        <a className="brand" href="/" aria-label="AI SkillBridge home"><span className="logo" aria-hidden="true"><Icon name="network" /></span><span>AI SkillBridge</span></a>
        <span style={{ margin: "0 auto" }} />
        <button className="btn" onClick={copy} aria-live="polite"><Icon name={copied ? "check" : "link"} />{copied ? "Link copied" : "Copy link"}</button>
        <a className="btn" href="/value"><Icon name="chart" />Value dashboard</a>
      </header>
      <main id="main" className="value-main">
        <div className="value-head">
          <div>
            <div className="eyebrow">Public impact ledger</div>
            <h1>{t ? `${money(t.total)} unlocked by ${t.activations} activations.` : "Impact ledger"}</h1>
            <p className="small muted">Every record is a team staffed from inside instead of hiring or buying in. Totals add up the records below; no names are published.</p>
          </div>
          {v && (
            <span className={`ledger-source${live ? " live" : ""}`} role="status">
              <span className="cloud-dot" aria-hidden="true" />{live ? "Live from Firestore" : "From the app database"}
              {v.syncedAt && <span className="muted"> · synced {new Date(v.syncedAt).toLocaleTimeString()}</span>}
            </span>
          )}
        </div>
        {err && <p role="alert" className="small">{err}</p>}
        {!v && !err && <div className="skeleton" style={{ height: 120 }} />}
        {v && t && (
          <>
            <section className="kpis" aria-label="Ledger totals">
              <div className="kpi total"><span className="eyebrow">Total value unlocked</span><b>{money(t.total)}</b><p>{t.activations} activations, {t.people} people activated</p></div>
              <div className="kpi" style={{ ["--c" as string]: "var(--cost)" }}><span className="eyebrow">Cost avoided</span><b>{money(t.costAvoided)}</b><p>External cost minus internal cost</p></div>
              <div className="kpi" style={{ ["--c" as string]: "var(--prod)" }}><span className="eyebrow">Productivity</span><b>{money(t.productivity)}</b><p>Hours recovered at loaded labour cost</p></div>
              <div className="kpi" style={{ ["--c" as string]: "#6ee7b7" }}><span className="eyebrow">Recruitment avoided</span><b>{money(t.recruitment)}</b><p>Hires avoided at recruitment cost</p></div>
              <div className="kpi" style={{ ["--c" as string]: "var(--rev)" }}><span className="eyebrow">Revenue</span><b>{money(t.revenue)}</b><p>Won or influenced with internal teams</p></div>
            </section>
            <section className="panel" style={{ padding: "16px 24px" }} aria-labelledby="ledger-h">
              <h2 id="ledger-h" className="section-h">Records</h2>
              <div className="table-wrap">
                <table className="records">
                  <thead><tr><th>Record</th><th>Date</th><th>Activation</th><th className="n">People</th><th className="n">Cost avoided</th><th className="n">Productivity</th><th className="n">Recruitment</th><th className="n">Revenue</th><th className="n">Total</th></tr></thead>
                  <tbody>
                    {v.records.map((r) => {
                      const fresh = r.source === "activated" || r.source === "agent";
                      return (
                        <tr key={r.id} className={fresh ? "new" : ""}>
                          <td className="num">{r.id}</td>
                          <td className="num">{r.date}</td>
                          <td>{r.title}{fresh && <span className="badge-new">{r.source === "agent" ? "AGENT" : "NEW"}</span>}</td>
                          <td className="n">{r.people_count}</td>
                          <td className="n">{r.cost_avoided_amt ? money(r.cost_avoided_amt) : "None"}</td>
                          <td className="n">{money(r.productivity_amt)}</td>
                          <td className="n">{r.recruitment_amt ? money(r.recruitment_amt) : "None"}</td>
                          <td className="n">{r.revenue_amt ? money(r.revenue_amt) : "None"}</td>
                          <td className="n">{money(r.cost_avoided_amt + r.productivity_amt + r.recruitment_amt + r.revenue_amt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {!v.records.length && <p className="small muted">No activations recorded yet.</p>}
            </section>
            <CloudStatus />
          </>
        )}
      </main>
    </div>
  );
}
