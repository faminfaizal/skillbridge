"use client";
// "People" tabs: Connections, Peer feedback.
import { useId, useMemo, useState } from "react";
import { Icon } from "../Icon";
import { Card, Combobox, Empty, FieldError, RemoveButton, SectionHead, useProfile, type Option } from "./kit";

const KINDS = [
  { id: "mentor", label: "My mentor" }, { id: "mentee", label: "My mentee" }, { id: "goto", label: "Go-to person for a skill" },
] as const;
type Kind = (typeof KINDS)[number]["id"];

// ================================================================ Connections
export function ConnectionsTab() {
  const { b, act, removeLater, pending } = useProfile();
  const [who, setWho] = useState<Option | null>(null);
  const [kind, setKind] = useState<Kind>("goto");
  const [sk, setSk] = useState<Option | null>(null);
  const [err, setErr] = useState("");
  const id = useId();
  const people = useMemo(() => b.catalog.people.map((p) => ({ id: p.id, label: p.name, sub: p.title })), [b.catalog.people]);
  const skills = useMemo(() => b.catalog.skills.map((s) => ({ id: s.id, label: s.name, sub: s.family })), [b.catalog.skills]);
  const add = async () => {
    if (!who) { setErr("Pick a person."); return; }
    if (kind === "goto" && !sk) { setErr("Pick the skill you go to them for."); return; }
    setErr("");
    if (await act("connections", "add", { otherId: who.id, kind, skillId: sk?.id })) { setWho(null); setSk(null); }
  };
  const own = b.connections.own.filter((c) => !pending.has(`cn:${c.id}`));
  return (
    <>
      <SectionHead title="Connections" desc="Mentors, mentees and the people you go to for help. Naming a go-to person also counts as a peer nomination for them." section="connections" />
      <Card title="Add a connection">
        <div className="pf-grid2">
          {who ? (
            <div className="pf-field"><span className="pf-label">Person</span>
              <div className="pf-picked"><b>{who.label}</b><span className="small muted">{who.sub}</span><button type="button" className="link-btn small" onClick={() => setWho(null)}>Change</button></div></div>
          ) : <Combobox label="Person" options={people} placeholder="Search by name or title" onPick={setWho} />}
          <fieldset className="pf-fieldset"><legend>They are</legend>
            <div className="pf-seg small">{KINDS.map((k) => <button key={k.id} type="button" aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>{k.label}</button>)}</div></fieldset>
        </div>
        {kind === "goto" && (sk
          ? <div className="pf-picked"><span className="small muted">For</span><b>{sk.label}</b><button type="button" className="link-btn small" onClick={() => setSk(null)}>Change</button></div>
          : <Combobox label="Skill you go to them for" options={skills} placeholder="Search skills" onPick={setSk} />)}
        <FieldError id={`${id}-e`} text={err} />
        <div className="pf-row"><button type="button" className="btn btn-primary" onClick={add}><Icon name="plus" />Add connection</button></div>
      </Card>
      <Card title={<>Your connections <span className="pf-count-chip">{own.length}</span></>}>
        {own.length === 0 ? <Empty icon="users" title="No connections yet" text="Start with someone from the list below: tap Mentor or Go-to." /> : (
          <ul className="pf-list compact">{own.map((c) => (
            <li key={c.id} className="pf-item">
              <div className="pf-item-main"><div className="pf-item-top"><b>{c.name}</b><span className="chip">{c.kind === "goto" ? `Go-to for ${c.skill}` : c.kind === "mentor" ? "Mentor" : "Mentee"}</span></div>
                <p className="small muted">{c.title}</p></div>
              <div className="pf-item-actions"><RemoveButton label={c.name} onConfirm={() => removeLater(`cn:${c.id}`, `Removed ${c.name}`, () => act("connections", "remove", { id: c.id }))} /></div>
            </li>))}</ul>
        )}
      </Card>
      <Card title={<><Icon name="lock" />People you worked with</>}>
        <p className="small muted">From shared projects in the project records.</p>
        {b.connections.workedWith.length === 0 ? <p className="small muted">No shared projects on record.</p> : (
          <ul className="pf-people">{b.connections.workedWith.map((w) => (
            <li key={w.id}>
              <span className="pf-avatar" aria-hidden="true">{w.name.split(" ").map((x) => x[0]).slice(0, 2).join("")}</span>
              <div><b>{w.name}</b><span className="small muted">{w.title} · {w.shared} shared project{w.shared > 1 ? "s" : ""}</span></div>
              <div className="pf-row">
                <button type="button" className="btn btn-ghost small" onClick={() => act("connections", "add", { otherId: w.id, kind: "mentor" })}>Mentor</button>
                <button type="button" className="btn btn-ghost small" onClick={() => { setWho({ id: w.id, label: w.name, sub: w.title }); setKind("goto"); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Go-to for...</button>
              </div>
            </li>))}</ul>
        )}
      </Card>
    </>
  );
}

// ================================================================ Peer feedback
/** "Who was dependable during issues?" -> "Was dependable during issues"; "Whose work..." -> "Their work..." */
const promptLabel = (p: string) => {
  const s = p.replace(/^Whose /, "Their ").replace(/^Who /, "").replace(/\?$/, "");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export function FeedbackTab() {
  const { b, act } = useProfile();
  const [to, setTo] = useState<Option | null>(null);
  const [q, setQ] = useState("");
  const [project, setProject] = useState("");
  const [text, setText] = useState("");
  const [req, setReq] = useState<string | undefined>();
  const [err, setErr] = useState("");
  const id = useId();
  const people = useMemo(() => b.catalog.people.map((p) => ({ id: p.id, label: p.name, sub: p.title })), [b.catalog.people]);
  const send = async () => {
    if (!to) { setErr("Pick who you are recognising."); return; }
    if (!q) { setErr("Choose what you are recognising them for."); return; }
    setErr("");
    if (await act("feedback", "give", { toId: to.id, question: q, projectId: project || undefined, text, requestId: req })) { setTo(null); setQ(""); setProject(""); setText(""); setReq(undefined); }
  };
  const answer = (r: (typeof b.feedback.requests)[number]) => {
    setTo({ id: r.fromId, label: r.from });
    setProject(b.catalog.myProjects.find((p) => p.name === r.project)?.id ?? "");
    setReq(r.id);
    document.getElementById(`${id}-form`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const received = b.feedback.received;
  return (
    <>
      <SectionHead title="Peer feedback" desc="Recognise colleagues and see recognition you received. Feedback is never used in appraisal." section="feedback" />
      {b.feedback.requests.length > 0 && (
        <Card title={<><Icon name="inbox" />Asked for your feedback <span className="pf-count-chip attn">{b.feedback.requests.length}</span></>}>
          <ul className="pf-list compact">{b.feedback.requests.map((r) => (
            <li key={r.id} className="pf-item">
              <div className="pf-item-main"><b>{r.from}</b><p className="small muted">{r.project ? `On ${r.project}` : "General"} · {r.date}</p></div>
              <div className="pf-item-actions pf-row">
                <button type="button" className="btn btn-primary small" onClick={() => answer(r)}>Give feedback</button>
                <button type="button" className="btn small" onClick={() => act("feedback", "dismiss", { id: r.id })}>Dismiss</button>
              </div>
            </li>))}</ul>
        </Card>
      )}
      <Card title="Recognise someone">
        <div id={`${id}-form`} className="pf-feedback-form">
          {to ? (
            <div className="pf-picked"><span className="small muted">To</span><b>{to.label}</b>{req && <span className="chip">Answering a request</span>}
              <button type="button" className="link-btn small" onClick={() => { setTo(null); setReq(undefined); }}>Change</button></div>
          ) : <Combobox label="Who" options={people} placeholder="Search by name" onPick={setTo} />}
          <fieldset className="pf-fieldset"><legend>For</legend>
            <div className="pf-prompts">{b.feedback.prompts.map((p) => (
              <button key={p} type="button" aria-pressed={q === p} onClick={() => setQ(p)}>{promptLabel(p)}</button>))}</div>
          </fieldset>
          <div className="pf-grid2">
            <div className="pf-field"><label htmlFor={`${id}-p`}>Project (optional)</label>
              <select id={`${id}-p`} value={project} onChange={(e) => setProject(e.target.value)}><option value="">Not about a project</option>
                {b.catalog.myProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div className="pf-field"><label htmlFor={`${id}-t`}>Message (optional)</label>
              <textarea id={`${id}-t`} rows={2} maxLength={800} value={text} onChange={(e) => setText(e.target.value)} placeholder="One or two sentences on what they did" /></div>
          </div>
          <FieldError id={`${id}-e`} text={err} />
          <div className="pf-row"><button type="button" className="btn btn-primary" onClick={send}><Icon name="star" />Send recognition</button></div>
        </div>
      </Card>
      <Card title={<>Received <span className="pf-count-chip">{received.length}</span></>}>
        {received.length === 0 ? <Empty icon="star" title="No recognition yet" text="Ask your project team for feedback from the My Projects tab." /> : (
          <ul className="pf-list compact">{received.map((r) => (
            <li key={r.id} className={`pf-item ${r.hidden ? "pf-dim" : ""}`}>
              <div className="pf-item-main">
                <div className="pf-item-top"><b>{r.from}</b><span className="small muted">{r.date}</span>{r.hidden && <span className="pf-badge"><Icon name="eyeoff" />Hidden</span>}</div>
                <p className="small">{r.question}{r.project && <span className="muted"> · {r.project}</span>}</p>
                {r.text && <blockquote className="pf-quote">"{r.text}"</blockquote>}
              </div>
              <div className="pf-item-actions pf-row">
                <button type="button" className="btn btn-ghost small" disabled={r.thanked} onClick={() => act("feedback", "thank", { recId: r.id })}><Icon name="hand" />{r.thanked ? "Thanked" : "Thank"}</button>
                <button type="button" className="btn btn-ghost pf-icon-btn" aria-pressed={r.hidden} aria-label={r.hidden ? "Show to others" : "Hide from others"} title={r.hidden ? "Show" : "Hide"}
                  onClick={() => act("feedback", "hide", { recId: r.id, hidden: !r.hidden })}><Icon name={r.hidden ? "eye" : "eyeoff"} /></button>
              </div>
            </li>))}</ul>
        )}
      </Card>
      {b.feedback.given.length > 0 && (
        <Card title={<>Given by you <span className="pf-count-chip">{b.feedback.given.length}</span></>}>
          <ul className="pf-list compact">{b.feedback.given.map((g) => (
            <li key={g.id} className="pf-item"><div className="pf-item-main"><div className="pf-item-top"><b>{g.to}</b><span className="small muted">{g.date}</span></div>
              <p className="small">{g.question}</p>{g.text && <blockquote className="pf-quote">"{g.text}"</blockquote>}</div></li>))}</ul>
        </Card>
      )}
    </>
  );
}
