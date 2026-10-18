"use client";
// Google Cloud status: Firestore mirror, BigQuery and Pub/Sub, as live as the server reports (polls every 15 s).
// Compact mode (Agents panel): three chips, details in the tooltip. Owned by the cloud track (T1).
import { useEffect, useState } from "react";
import type { CloudStatusView } from "../lib/cloud/status";

type State = CloudStatusView["firestore"]["state"];
const STATE_LABEL: Record<State, string> = { live: "live", off: "off", error: "error", pending: "starting" };

function ago(iso: string | null): string {
  if (!iso) return "not yet";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
}

export default function CloudStatus({ compact = false }: { compact?: boolean }) {
  const [s, setS] = useState<CloudStatusView | null>(null);
  const [, setNow] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/cloud/status", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((x) => { if (alive && x) setS(x); }).catch(() => {});
    load();
    const t = setInterval(() => { load(); setNow(Date.now()); }, 15000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (!s) return null;
  const p = s.pubsub;
  const chips: { name: string; state: State; detail: string }[] = [
    { name: "Firestore", state: s.firestore.state, detail: s.firestore.state === "off" ? "Mirror off" : `${s.firestore.docs ?? 0} docs mirrored, synced ${ago(s.firestore.lastSyncAt)}` },
    { name: "BigQuery", state: s.bigquery.state, detail: s.bigquery.state === "off" ? "Analytics off" : `${s.bigquery.lastQueryMs !== null ? `last query ${s.bigquery.lastQueryMs} ms` : "no query yet"}, synced ${ago(s.bigquery.lastSyncAt)}` },
    { name: "Pub/Sub", state: p.state, detail: p.state === "off" ? "Events off" : `${p.published} published, ${p.pushes} pushed${p.lastPushLagMs !== null ? `, lag ${p.lastPushLagMs} ms` : ""}${p.failed ? `, ${p.failed} failed` : ""}` },
  ];
  return (
    <div className={`cloud-status${compact ? " compact" : ""}`} role="group" aria-label="Google Cloud status">
      {!compact && <div className="eyebrow">Google Cloud{s.on ? "" : ": sync off, SQLite only"}</div>}
      <div className="cloud-chips">
        {chips.map((c) => (
          <span key={c.name} className={`cloud-chip ${c.state}`} title={`${c.name}: ${STATE_LABEL[c.state]}. ${c.detail}`}>
            <span className="cloud-dot" aria-hidden="true" />{c.name}<span className={compact ? "sr-only" : "cloud-state"}> {STATE_LABEL[c.state]}</span>
          </span>
        ))}
      </div>
      {!compact && <ul className="cloud-details small muted">{chips.map((c) => <li key={c.name}><b>{c.name}</b> {c.detail}</li>)}</ul>}
    </div>
  );
}
