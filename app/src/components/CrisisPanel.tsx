"use client";
// Incident response team: a situation report (text or photo) becomes a team staffed by fit, proximity and availability,
// compared with a skills-only team. The Risk Sentinel proposes it; a person approves here or in the Agents inbox.
import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { IntakeForm, intakeForm, type IntakeValue } from "./IntakeForm";
import { aiLabel, money } from "../lib/format";
import type { ActPanelProps } from "./actPanels";
import type { CrisisPlan, TeamMember } from "../lib/engine/crisis";

const MODE: Record<TeamMember["mode"], string> = { local: "Local", road: "Road", flight: "Flight" };
const num = (n: number) => n.toLocaleString("en-US");
const STATUS: Record<CrisisPlan["status"], string> = { proposed: "Waiting for approval", mobilised: "Mobilised", dismissed: "Dismissed", "no team": "No team found" };

export default function CrisisPanel({ onFocus, onShow, onAgents, onToast, refreshAgents }: ActPanelProps) {
  const [plan, setPlan] = useState<CrisisPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [err, setErr] = useState("");
  const [showBasis, setShowBasis] = useState(false);

  function show(p: CrisisPlan) {
    onShow({ nodeIds: [...p.teamIds, ...p.skillIds], stars: p.teamIds, pulse: p.teamIds });
  }

  useEffect(() => {
    fetch("/api/crisis").then((r) => r.json()).then((b) => { if (b.crisis) { setPlan(b.crisis); show(b.crisis); } }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function send(body: FormData | string) {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/crisis", typeof body === "string"
        ? { method: "POST", headers: { "Content-Type": "application/json" }, body }
        : { method: "POST", body });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error ?? "The report could not be read.");
      setPlan(b.crisis);
      show(b.crisis);
      refreshAgents();
      onToast(b.crisis.teamIds.length ? `Incident team proposed for ${b.crisis.place.name}.` : `No consenting person qualifies for ${b.crisis.place.name}.`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function decide(decision: "approve" | "dismiss") {
    if (!plan?.inboxId) return;
    setDeciding(true);
    try {
      const r = await fetch(`/api/agents/inbox/${plan.inboxId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      onToast(b.outcome);
      const fresh = await fetch("/api/crisis").then((x) => x.json());
      if (fresh.crisis) setPlan(fresh.crisis);
      refreshAgents();
    } catch (e) {
      onToast(`Could not record the decision: ${(e as Error).message}`);
    } finally {
      setDeciding(false);
    }
  }

  const t = plan?.totals;
  return (
    <div className="panel-body">
      <div className="eyebrow"><Icon name="zap" /> Act</div>
      <h2 className="panel-title">Incident response team</h2>
      <p className="muted small">Paste a situation report or add a photo of it. Gemini reads it; the engine staffs the nearest qualified, available people and compares them with a team chosen on skill alone.</p>

      <IntakeForm label="Situation report" placeholder="For example: P1 fibre cut on the trunk route near Katherine, 4,200 customers down, need splicing and OTDR testing crews."
        submitLabel="Staff the response" busy={busy} onSubmit={(v: IntakeValue) => void send(intakeForm(v))}
        onSample={() => void send(JSON.stringify({ sample: true }))} sampleLabel="Use the sample report" />
      {err && <p className="intake-err small" role="alert">{err}</p>}

      {plan && t && (
        <section className="crisis rise" aria-label="Incident response plan">
          <div className="decision">
            <span className="eyebrow">{plan.place.name} &middot; {plan.severity}{plan.customersReported ? ` · ${num(plan.customersReported)} customers` : ""}</span>
            <p>{plan.summary}</p>
            <div className="chips">
              <span className="chip" title="Which AI service read the report">Read by: {aiLabel(plan.provider)} ({plan.read})</span>
              <span className={`chip crisis-status crisis-${plan.status.replace(" ", "-")}`}>{STATUS[plan.status]}</span>
            </div>
          </div>

          {plan.teamIds.length > 0 && (
            <div className="crisis-totals" role="list" aria-label="Against a skills-only team">
              <div className="tile" role="listitem" style={{ ["--c" as string]: "var(--prod)" }}><span className="eyebrow">On site in</span><b className="num">{t.etaHours} h</b><span className="small muted">vs {t.baselineEtaHours} h</span></div>
              <div className="tile" role="listitem" style={{ ["--c" as string]: "var(--danger)" }}><span className="eyebrow">Downtime avoided</span><b className="num">{t.downtimeHoursAvoided} h</b></div>
              <div className="tile" role="listitem" style={{ ["--c" as string]: "var(--cost)" }}><span className="eyebrow">Travel avoided</span><b className="num">{num(t.travelKmAvoided)} km</b></div>
              <div className="tile" role="listitem" style={{ ["--c" as string]: "var(--success)" }}><span className="eyebrow">CO2e avoided</span><b className="num">{num(t.co2eKgAvoided)} kg</b></div>
              <div className="tile" role="listitem" style={{ ["--c" as string]: "var(--rev)" }}><span className="eyebrow">Travel cost avoided</span><b className="num">{money(t.travelCostAvoided)}</b></div>
              <div className="tile" role="listitem" style={{ ["--c" as string]: "var(--accent-2)" }}><span className="eyebrow">Value</span><b className="num">{money(t.valueAmt)}</b></div>
            </div>
          )}

          <h3 className="section-h">Team by role</h3>
          <ul className="crisis-roles">
            {plan.roles.map((r) => (
              <li key={r.role} className={`card crisis-role ${r.gap ? "gap" : ""}`}>
                <div className="crisis-role-h">
                  <strong>{r.role}</strong>
                  <span className="small muted">{r.members.length} of {r.count}</span>
                </div>
                <div className="chips">{r.skills.map((s) => <button key={s.id} className="chip chip-btn" onClick={() => onFocus(s.id)}>{s.name}</button>)}</div>
                {r.members.length === 0 && <p className="small crisis-gap">No consenting, available person qualifies.</p>}
                <ul className="crisis-members">
                  {r.members.map((m) => (
                    <li key={m.personId}>
                      <button className="link-btn" onClick={() => onFocus(m.personId)}>{m.name}</button>
                      <span className="small muted"> {m.title}, {m.location}</span>
                      <div className="chips">
                        <span className={`chip crisis-mode crisis-${m.mode}`}>{MODE[m.mode]}</span>
                        <span className="chip">{num(m.km)} km</span>
                        <span className="chip">ETA {m.etaHours} h</span>
                        <span className="chip">Fit {Math.round(m.fit * 100)}%</span>
                        <span className="chip">{m.availabilityPct}% free</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          {plan.privateCount > 0 && <p className="small muted"><Icon name="lock" /> {plan.privateCount} more qualified {plan.privateCount === 1 ? "person keeps a" : "people keep their"} profile private: counted, not named.</p>}

          {plan.status === "proposed" && plan.inboxId && (
            <div className="crisis-actions">
              <button className="btn btn-approve" onClick={() => void decide("approve")} disabled={deciding}><Icon name="check" />Approve and mobilise</button>
              <button className="btn btn-ghost" onClick={() => void decide("dismiss")} disabled={deciding}>Dismiss</button>
              <button className="btn btn-ghost small" onClick={onAgents}><Icon name="inbox" />Agents inbox</button>
            </div>
          )}
          {plan.status === "mobilised" && <p className="small crisis-done"><Icon name="check" /> Mobilised. The impact and social ledgers now include this response.</p>}

          <button className="btn btn-ghost small" aria-expanded={showBasis} onClick={() => setShowBasis(!showBasis)}>{showBasis ? "Hide" : "Show"} how this is calculated</button>
          {showBasis && (
            <ul className="assumptions">
              {plan.basis.map((b) => <li key={b}>{b}</li>)}
              {plan.baseline.length > 0 && <li>Skills-only team: {plan.baseline.map((b) => `${b.role} from ${b.location} (${num(b.km)} km, ${b.etaHours} h)`).join("; ")}.</li>}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
