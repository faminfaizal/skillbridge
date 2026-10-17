"use client";
// "Control" tabs: Privacy, My data, My impact; plus Team validation for managers.
import { useId, useState } from "react";
import { Icon } from "../Icon";
import { money } from "../../lib/format";
import { AUDIENCES, type Audience } from "../../lib/me/types";
import { Card, Empty, FieldError, SectionHead, Toggle, fmtMonth, levelLabel, useProfile } from "./kit";

const SECTIONS: [string, string][] = [
  ["about", "About me"], ["projects", "My Projects"], ["skills", "Skills"], ["evidence", "Evidence"], ["documents", "Documents"], ["certs", "Certifications"],
  ["connections", "Connections"], ["feedback", "Peer feedback"], ["growth", "Interests and growth"], ["availability", "Availability"],
];

// ================================================================ Privacy
export function PrivacyTab() {
  const { b, act } = useProfile();
  return (
    <>
      <SectionHead title="Privacy" desc="You decide who sees each part of your profile. Changes apply straight away." />
      <Card title="Discovery">
        <Toggle label="Let SkillBridge suggest me for teams and opportunities" checked={b.privacy.consent} onChange={(v) => act("privacy", "consent", { consent: v })}
          hint={b.privacy.consent ? "On: managers can find you by skill, and you can be suggested for teams." : "Off: you appear only in totals. Nobody can find you by skill."} />
        <p className="small muted">Your profile is never used in performance appraisal. You can change this at any time.</p>
      </Card>
      <Card title="Who can see each section">
        <div className="table-wrap">
          <table className="pf-table">
            <thead><tr><th scope="col">Section</th><th scope="col">Visible to</th></tr></thead>
            <tbody>{SECTIONS.map(([k, label]) => (
              <tr key={k}><th scope="row">{label}</th><td>
                <label className="sr-only" htmlFor={`aud-${k}`}>{label}: visible to</label>
                <select id={`aud-${k}`} value={b.privacy.sections[k] ?? "everyone"} onChange={(e) => act("privacy", "audience", { section: k, audience: e.target.value as Audience })}>
                  {AUDIENCES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></td></tr>))}</tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

// ================================================================ My data
export function DataTab() {
  const { b, act, userId } = useProfile();
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <SectionHead title="My data" desc="Everything SkillBridge holds about you, every change, and your error reports." />
      <Card title="Download">
        <p className="small">A complete copy of your profile as a JSON file: ERA facts, projects, skills, evidence, feedback and settings.</p>
        <div className="pf-row"><a className="btn" href={`/api/me/export?as=${userId}`} download><Icon name="download" />Download my data</a></div>
      </Card>
      <Card title={<>Change history <span className="pf-count-chip">{b.history.length}</span></>}>
        {b.history.length === 0 ? <p className="small muted">No changes yet. Every edit you or your manager make appears here.</p> : (
          <div className="table-wrap">
            <table className="pf-table">
              <thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">Section</th><th scope="col">Change</th></tr></thead>
              <tbody>{b.history.map((h, i) => <tr key={i}><td className="num nowrap">{h.at.slice(0, 16).replace("T", " ")}</td><td>{h.actor}</td><td>{h.section}</td><td>{h.summary}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title={<>Error reports <span className="pf-count-chip">{b.reports.length}</span></>}>
        {b.reports.length === 0 ? <p className="small muted">No reports. Use Report an error on About me or My Projects if something is wrong.</p> : (
          <ul className="pf-list compact">{b.reports.map((r) => (
            <li key={r.id} className="pf-item"><div className="pf-item-main"><div className="pf-item-top"><b>{r.target}</b><span className="pf-badge pf-wait">{r.status === "open" ? "Open" : r.status}</span><span className="small muted">{r.date}</span></div>
              <p className="small">{r.kind === "new_skill" ? "New skill suggested to HR" : r.message}</p></div></li>))}</ul>
        )}
      </Card>
      <Card title="Demo only">
        <p className="small">Undo every change made to this profile in the demo, including project entries, skills and settings.</p>
        <div className="pf-row">{confirm
          ? <><button type="button" className="btn btn-danger" onClick={async () => { setConfirm(false); await act("data", "reset"); }}>Yes, undo all my changes</button><button type="button" className="btn" onClick={() => setConfirm(false)}>Keep them</button></>
          : <button type="button" className="btn btn-danger" onClick={() => setConfirm(true)}><Icon name="reset" />Undo all my changes</button>}</div>
      </Card>
    </>
  );
}

// ================================================================ My impact
export function ImpactTab() {
  const { b } = useProfile();
  const i = b.impact;
  return (
    <>
      <SectionHead title="My impact" desc="What your work has added up to, from records SkillBridge already holds." />
      <div className="pf-kpis">
        <div className="pf-kpi"><span className="eyebrow">Value you helped unlock</span><b className="num">{money(i.valueAmt)}</b><span className="small muted">{i.records.length} activation{i.records.length === 1 ? "" : "s"}</span></div>
        <div className="pf-kpi"><span className="eyebrow">Projects</span><b className="num">{i.projects}</b></div>
        <div className="pf-kpi"><span className="eyebrow">Incidents resolved</span><b className="num">{i.incidents}</b></div>
        <div className="pf-kpi"><span className="eyebrow">Recognitions</span><b className="num">{i.recognition}</b></div>
      </div>
      <Card title="Activations you were part of">
        {i.records.length === 0 ? <Empty icon="coin" title="None yet" text="When you join a team formed in SkillBridge, the value it creates is credited here." /> : (
          <div className="table-wrap"><table className="pf-table"><thead><tr><th scope="col">Date</th><th scope="col">Activation</th><th scope="col" className="n">Value</th></tr></thead>
            <tbody>{i.records.map((r) => <tr key={r.id}><td className="num nowrap">{r.date}</td><td>{r.title}</td><td className="n num">{money(r.valueAmt)}</td></tr>)}</tbody></table></div>
        )}
      </Card>
      <Card title="Knowledge you wrote">
        {i.knowledge.length === 0 ? <p className="small muted">No knowledge items authored yet.</p> : (
          <ul className="pf-list compact">{i.knowledge.map((k) => <li key={k.title} className="pf-item"><div className="pf-item-main"><div className="pf-item-top"><b>{k.title}</b><span className="chip num">Reused {k.reuse}×</span></div></div></li>)}</ul>
        )}
      </Card>
    </>
  );
}

// ================================================================ Team validation (managers)
function DeclineNote({ onSend, onCancel }: { onSend: (note: string) => void; onCancel: () => void }) {
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const id = useId();
  return (
    <div className="pf-inline-form">
      <div className="pf-field"><label htmlFor={id}>Why are you declining?</label>
        <input id={id} autoFocus value={note} maxLength={300} aria-describedby={`${id}-e`} onChange={(e) => setNote(e.target.value)} placeholder="For example: dates overlap another project; please check" /></div>
      <FieldError id={`${id}-e`} text={err} />
      <div className="pf-row"><button type="button" className="btn btn-danger small" onClick={() => (note.trim().length < 3 ? setErr("Tell them why, so they can fix the entry.") : onSend(note))}>Decline</button>
        <button type="button" className="btn small" onClick={onCancel}>Cancel</button></div>
    </div>
  );
}

export function TeamTab() {
  const { b, act } = useProfile();
  const [declining, setDeclining] = useState<string | null>(null);
  const t = b.team;
  if (!t) return null;
  const withEvidence = t.skills.filter((s) => s.evidence > 0);
  return (
    <>
      <SectionHead title="Team validation" desc={`Confirm what your ${t.reports.length} direct report${t.reports.length > 1 ? "s" : ""} added. Confirmed items count as stronger evidence.`} />
      <Card title={<>Project entries <span className="pf-count-chip attn">{t.projects.length}</span></>}>
        {t.projects.length === 0 ? <Empty icon="check" title="All caught up" text="No project entries waiting for you." /> : (
          <ul className="pf-list">{t.projects.map((p) => (
            <li key={p.id} className="pf-item">
              <div className="pf-item-main">
                <div className="pf-item-top"><b>{p.name}</b><span className="small muted">by {p.person}</span></div>
                <p className="small muted">{p.type} · {p.role} · {fmtMonth(p.start)} to {fmtMonth(p.end)}{p.effort && ` · ${p.effort}`}</p>
                {p.contribution && <p className="small">{p.contribution}</p>}
                {p.skills.length > 0 && <div className="pf-chips">{p.skills.map((s) => <span key={s} className="chip">{s}</span>)}</div>}
                {declining === p.id && <DeclineNote onCancel={() => setDeclining(null)} onSend={async (note) => { if (await act("team", "project", { id: p.id, decision: "decline", note })) setDeclining(null); }} />}
              </div>
              {declining !== p.id && (
                <div className="pf-item-actions pf-row">
                  <button type="button" className="btn btn-approve small" onClick={() => act("team", "project", { id: p.id, decision: "confirm" })}><Icon name="check" />Confirm</button>
                  <button type="button" className="btn small" onClick={() => setDeclining(p.id)}>Decline</button>
                </div>
              )}
            </li>))}</ul>
        )}
      </Card>
      <Card title={<>Skills <span className="pf-count-chip attn">{t.skills.length}</span></>} actions={withEvidence.length > 1 ? (
        <button type="button" className="btn small" onClick={async () => { for (const s of withEvidence) await act("team", "skill", { personId: s.personId, skillId: s.skillId, decision: "confirm" }); }}>
          <Icon name="check" />Confirm {withEvidence.length} with evidence</button>) : undefined}>
        {t.skills.length === 0 ? <Empty icon="check" title="All caught up" text="No skill changes waiting for you." /> : (
          <ul className="pf-list compact">{t.skills.map((s) => (
            <li key={`${s.personId}-${s.skillId}`} className="pf-item">
              <div className="pf-item-main"><div className="pf-item-top"><b>{s.skill}</b><span className="small muted">{s.person}</span><span className="chip">{levelLabel(s.level)}</span>
                <span className={`pf-badge ${s.evidence ? "pf-ok" : ""}`}>{s.evidence ? `${s.evidence} evidence` : "No evidence yet"}</span></div><p className="small muted">Added {s.date}</p></div>
              <div className="pf-item-actions pf-row">
                <button type="button" className="btn btn-approve small" onClick={() => act("team", "skill", { personId: s.personId, skillId: s.skillId, decision: "confirm" })}><Icon name="check" />Confirm</button>
                <button type="button" className="btn small" onClick={() => act("team", "skill", { personId: s.personId, skillId: s.skillId, decision: "decline" })}>Decline</button>
              </div>
            </li>))}</ul>
        )}
      </Card>
      <Card title="Your team">
        <ul className="pf-people">{t.reports.map((r) => (
          <li key={r.id}><span className="pf-avatar" aria-hidden="true">{r.name.split(" ").map((x) => x[0]).slice(0, 2).join("")}</span><div><b>{r.name}</b><span className="small muted">{r.title}</span></div></li>))}</ul>
      </Card>
    </>
  );
}
