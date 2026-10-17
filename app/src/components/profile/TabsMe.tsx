"use client";
// "Me" tabs: About me, My Projects, Skills, Evidence, Documents, Certifications.
import { useId, useMemo, useRef, useState } from "react";
import { Icon } from "../Icon";
import { EFFORTS, PROJECT_TYPES, type ProfileBundle } from "../../lib/me/types";
import {
  Card, Combobox, Empty, FieldError, InlineText, LevelPicker, Locked, RemoveButton, SectionHead, SourceBadge, StatusBadge, TagInput, Toggle,
  fmtDate, fmtMonth, levelLabel, thisMonth, useProfile, type Option,
} from "./kit";

const thisYear = new Date().getFullYear();
const YEARS = Array.from({ length: 16 }, (_, i) => thisYear - i);

// ================================================================ About me
const LANGS = ["English", "Spanish", "Mandarin", "Cantonese", "Tamil", "Hokkien", "Portuguese", "Hindi", "Arabic", "Japanese"];

function ReportError({ targets, section, to }: { targets: string[]; section: "about" | "projects"; to: string }) {
  const { act } = useProfile();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(targets[0] ?? "");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const id = useId();
  if (!open) return <button type="button" className="btn btn-ghost small" onClick={() => setOpen(true)}><Icon name="alert" />Report an error</button>;
  const send = async () => {
    if (msg.trim().length < 5) { setErr("Describe what is wrong so it can be fixed."); return; }
    if (await act(section, "report", { target, message: msg })) { setOpen(false); setMsg(""); setErr(""); }
  };
  return (
    <div className="pf-inline-form" role="group" aria-label="Report an error">
      {targets.length > 1 && (
        <div className="pf-field"><label htmlFor={`${id}-t`}>What is wrong</label>
          <select id={`${id}-t`} value={target} onChange={(e) => setTarget(e.target.value)}>{targets.map((t) => <option key={t}>{t}</option>)}</select></div>
      )}
      <div className="pf-field"><label htmlFor={`${id}-m`}>What should it say?</label>
        <textarea id={`${id}-m`} rows={2} value={msg} aria-describedby={`${id}-e`} onChange={(e) => setMsg(e.target.value)} onBlur={() => setErr(msg.trim() && msg.trim().length < 5 ? "Add a few more words." : "")} />
        <FieldError id={`${id}-e`} text={err} /></div>
      <p className="small muted">Goes to {to}. The record changes once they fix it at the source.</p>
      <div className="pf-row"><button type="button" className="btn btn-primary small" onClick={send}>Send report</button><button type="button" className="btn small" onClick={() => setOpen(false)}>Cancel</button></div>
    </div>
  );
}

export function AboutTab() {
  const { b, act } = useProfile();
  const m = b.me;
  const facts: [string, string][] = [
    ["Name", m.name], ["Staff no.", m.id], ["Job title", m.title], ["Grade", m.level], ["Division", m.division], ["Department", m.department],
    ["Manager", m.manager ? `${m.manager.name}, ${m.manager.title}` : "None"], ["Location", m.location], ["Joined", String(m.hireYear)], ["Email", m.email],
  ];
  return (
    <>
      <SectionHead title="About me" desc="Your record from ERA, plus a short introduction in your own words." section="about" />
      <Card title={<><Icon name="lock" />From ERA</>} actions={<ReportError section="about" to="the HR data steward" targets={facts.map((f) => f[0])} />}>
        <dl className="pf-facts">{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v || "Not recorded"}</dd></div>)}</dl>
        <p className="small muted">These come from the HR system and are read-only here.</p>
      </Card>
      <Card title="In your own words">
        <InlineText label="Headline" value={b.about.headline} maxLength={120} placeholder="For example: Access network engineer who automates OLT testing"
          hint="One line people see next to your name. Saves when you leave the field." onCommit={(v) => act("about", "save", { headline: v })} />
        <InlineText label="About me" value={b.about.bio} multiline maxLength={1200} hint="Prefilled from your CV summary. Edit freely."
          onCommit={(v) => act("about", "save", { bio: v })} />
        <TagInput label="Languages" values={b.about.languages} suggestions={LANGS} placeholder="Type a language and press Enter"
          onChange={(v) => act("about", "save", { languages: v })} />
        <InlineText label="Where you prefer to work" value={b.about.locationPref} maxLength={80} placeholder={`For example: ${m.location}, or open to travel`}
          onCommit={(v) => act("about", "save", { locationPref: v })} />
      </Card>
    </>
  );
}

// ================================================================ My Projects
type Own = ProfileBundle["projects"]["own"][number];
interface Draft { id?: string; name: string; type: string; role: string; start: string; end: string; ongoing: boolean; effort: string; contribution: string; skills: Option[]; link: string }
const blank = (): Draft => ({ name: "", type: "", role: "", start: thisMonth(), end: "", ongoing: false, effort: "", contribution: "", skills: [], link: "" });
const ROLES = ["Lead", "Member", "Builder", "Analyst", "Adviser", "Coordinator", "Tester", "Trainer"];

function ProjectForm({ initial, onDone }: { initial: Draft; onDone: () => void }) {
  const { b, act } = useProfile();
  const [d, setD] = useState<Draft>(initial);
  const [more, setMore] = useState(!!(initial.contribution || initial.skills.length || initial.link));
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const id = useId();
  const summary = useRef<HTMLDivElement>(null);
  const set = (k: keyof Draft, v: unknown) => setD((x) => ({ ...x, [k]: v }));
  const check = (k: string, dd = d): string => {
    if (k === "name") return dd.name.trim() ? "" : "Give the project a name.";
    if (k === "type") return dd.type ? "" : "Choose a type.";
    if (k === "role") return dd.role.trim() ? "" : "Say what your role was.";
    if (k === "start") return dd.start ? "" : "Pick the month you started.";
    if (k === "end") return dd.ongoing || !dd.end || dd.end >= dd.start ? "" : "The end month cannot be before the start month.";
    return "";
  };
  const blur = (k: string) => setErrs((e) => ({ ...e, [k]: check(k) }));
  const save = async () => {
    const all = Object.fromEntries(["name", "type", "role", "start", "end"].map((k) => [k, check(k)]).filter(([, v]) => v));
    setErrs(all);
    if (Object.keys(all).length) { summary.current?.focus(); return; }
    setBusy(true);
    const ok = await act("projects", d.id ? "update" : "add", {
      id: d.id, name: d.name, type: d.type, role: d.role, start: d.start, end: d.ongoing ? "" : d.end, effort: d.effort,
      contribution: d.contribution, skills: d.skills.map((s) => s.id), link: d.link,
    });
    setBusy(false);
    if (ok) onDone();
  };
  const skillOpts = useMemo(() => b.catalog.skills.map((s) => ({ id: s.id, label: s.name, sub: s.family })), [b.catalog.skills]);
  const errList = Object.values(errs).filter(Boolean);
  return (
    <Card title={d.id ? "Edit project" : "Add a project"} className="pf-form-card">
      <form onSubmit={(e) => { e.preventDefault(); void save(); }} onKeyDown={(e) => { if (e.key === "Escape") onDone(); }} noValidate>
        {errList.length > 0 && (
          <div ref={summary} tabIndex={-1} className="pf-error-summary" role="alert"><b>Fix {errList.length} thing{errList.length > 1 ? "s" : ""} to save:</b>
            <ul>{errList.map((e) => <li key={e}>{e}</li>)}</ul></div>
        )}
        <div className="pf-grid2">
          <div className="pf-field"><label htmlFor={`${id}-n`}>Project or initiative name <span className="req">required</span></label>
            <input id={`${id}-n`} value={d.name} autoFocus maxLength={120} aria-invalid={!!errs.name} aria-describedby={`${id}-ne`}
              onChange={(e) => set("name", e.target.value)} onBlur={() => blur("name")} placeholder="For example: OLT auto-test POC" />
            <FieldError id={`${id}-ne`} text={errs.name ?? ""} /></div>
          <div className="pf-field"><label htmlFor={`${id}-r`}>Your role <span className="req">required</span></label>
            <input id={`${id}-r`} list={`${id}-roles`} value={d.role} maxLength={80} aria-invalid={!!errs.role} aria-describedby={`${id}-re`}
              onChange={(e) => set("role", e.target.value)} onBlur={() => blur("role")} placeholder="Lead, Member, Builder..." />
            <datalist id={`${id}-roles`}>{ROLES.map((r) => <option key={r} value={r} />)}</datalist>
            <FieldError id={`${id}-re`} text={errs.role ?? ""} /></div>
        </div>
        <fieldset className="pf-fieldset"><legend>Type <span className="req">required</span></legend>
          <div className="pf-seg">{PROJECT_TYPES.map((t) => (
            <button key={t} type="button" aria-pressed={d.type === t} onClick={() => { set("type", t); setErrs((e) => ({ ...e, type: "" })); }}>{t}</button>))}</div>
          <FieldError id={`${id}-te`} text={errs.type ?? ""} />
        </fieldset>
        <div className="pf-grid3">
          <div className="pf-field"><label htmlFor={`${id}-s`}>Started <span className="req">required</span></label>
            <input id={`${id}-s`} type="month" value={d.start} max={thisMonth()} onChange={(e) => set("start", e.target.value)} onBlur={() => blur("start")} /></div>
          <div className="pf-field"><label htmlFor={`${id}-e`}>Ended</label>
            <input id={`${id}-e`} type="month" value={d.ongoing ? "" : d.end} min={d.start} disabled={d.ongoing} aria-describedby={`${id}-ee`}
              onChange={(e) => set("end", e.target.value)} onBlur={() => blur("end")} />
            <label className="pf-check"><input type="checkbox" checked={d.ongoing} onChange={(e) => set("ongoing", e.target.checked)} />Still ongoing</label>
            <FieldError id={`${id}-ee`} text={errs.end ?? ""} /></div>
          <fieldset className="pf-fieldset"><legend>Effort</legend>
            <div className="pf-seg small">{EFFORTS.map((t) => <button key={t} type="button" aria-pressed={d.effort === t} onClick={() => set("effort", d.effort === t ? "" : t)}>{t}</button>)}</div>
          </fieldset>
        </div>
        <button type="button" className="btn btn-ghost small" aria-expanded={more} onClick={() => setMore(!more)}>
          <Icon name="chevron" className={`icon ${more ? "pf-rot" : ""}`} />{more ? "Fewer details" : "More details: contribution, skills used, link"}</button>
        {more && (
          <div className="pf-more">
            <div className="pf-field"><label htmlFor={`${id}-c`}>What you contributed</label>
              <textarea id={`${id}-c`} rows={3} maxLength={1200} value={d.contribution} onChange={(e) => set("contribution", e.target.value)}
                placeholder="What you did and what changed because of it" /></div>
            <Combobox label="Skills you used" options={skillOpts} exclude={new Set(d.skills.map((s) => s.id))} placeholder="Search skills"
              onPick={(o) => set("skills", [...d.skills, o])} />
            {d.skills.length > 0 && <div className="pf-tags pf-tags-static">{d.skills.map((s) => (
              <span key={s.id} className="pf-tag">{s.label}<button type="button" aria-label={`Remove ${s.label}`} onClick={() => set("skills", d.skills.filter((x) => x.id !== s.id))}><Icon name="x" /></button></span>))}</div>}
            <p className="small muted">Skills you used that are not on your profile yet are added as self-declared.</p>
            <div className="pf-field"><label htmlFor={`${id}-l`}>Link to an outcome or document</label>
              <input id={`${id}-l`} type="url" value={d.link} maxLength={300} onChange={(e) => set("link", e.target.value)} placeholder="https://" /></div>
          </div>
        )}
        <p className="small muted">Your manager confirms entries you add. Once confirmed, the project joins the project records and counts as evidence.</p>
        <div className="pf-row">
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Saving..." : d.id ? "Save changes" : "Add project"}</button>
          <button type="button" className="btn" onClick={onDone}>Cancel</button>
        </div>
      </form>
    </Card>
  );
}

export function ProjectsTab() {
  const { b, act, removeLater, pending } = useProfile();
  const [form, setForm] = useState<Draft | null>(null);
  const edit = (o: Own) => setForm({ id: o.id, name: o.name, type: o.type, role: o.role, start: o.start, end: o.end ?? "", ongoing: !o.end, effort: o.effort,
    contribution: o.contribution, skills: o.skills.map((s) => ({ id: s.id, label: s.name })), link: o.link });
  const own = b.projects.own.filter((o) => !pending.has(`proj:${o.id}`));
  const system = b.projects.system.filter((s) => !s.self);
  return (
    <>
      <SectionHead title="My Projects" desc="Projects from the project records, and work no system records: POCs, initiatives, taskforces, help across divisions, work before you joined." section="projects">
        {!form && <button type="button" className="btn btn-primary" onClick={() => setForm(blank())}><Icon name="plus" />Add a project</button>}
      </SectionHead>
      {form && <ProjectForm key={form.id ?? "new"} initial={form} onDone={() => setForm(null)} />}
      <Card title={<>Added by you <span className="pf-count-chip">{own.length}</span></>}>
        {own.length === 0 ? (
          <Empty icon="plus" title="Nothing added yet" text="Add a POC, taskforce or project from before you joined. It takes under a minute.">
            {!form && <button type="button" className="btn small" onClick={() => setForm(blank())}>Add your first one</button>}
          </Empty>
        ) : (
          <ul className="pf-list">{own.map((o) => (
            <li key={o.id} className="pf-item">
              <div className="pf-item-main">
                <div className="pf-item-top"><b>{o.name}</b><StatusBadge status={o.status} /></div>
                <p className="small muted">{o.type} · {o.role} · {fmtMonth(o.start)} to {fmtMonth(o.end)}{o.effort && ` · ${o.effort}`}</p>
                {o.contribution && <p className="small">{o.contribution}</p>}
                {o.skills.length > 0 && <div className="pf-chips">{o.skills.map((s) => <span key={s.id} className="chip">{s.name}</span>)}</div>}
                {o.status === "declined" && <p className="pf-note-bad small"><Icon name="alert" />{o.decidedBy} declined: {o.declineNote}. Edit and resubmit.</p>}
                {o.status === "confirmed" && <p className="small muted">Confirmed by {o.decidedBy}; now part of the project records.</p>}
              </div>
              <div className="pf-item-actions">
                {o.status !== "confirmed" && <button type="button" className="btn btn-ghost pf-icon-btn" aria-label={`Edit ${o.name}`} title="Edit" onClick={() => edit(o)}><Icon name="edit" /></button>}
                <RemoveButton label={o.name} onConfirm={() => removeLater(`proj:${o.id}`, `Removed ${o.name}`, () => act("projects", "remove", { id: o.id }))} />
              </div>
            </li>))}</ul>
        )}
      </Card>
      <Card title={<><Icon name="lock" />From project records <span className="pf-count-chip">{system.length + b.projects.system.filter((s) => s.self).length}</span></>}>
        {b.projects.system.length === 0 ? <Empty icon="brief" title="No projects on record" text="Nothing in the project register names you yet. Add your work above." /> : (
          <ul className="pf-list">{b.projects.system.map((s) => (
            <li key={s.assignmentId} className={`pf-item ${s.hidden ? "pf-dim" : ""}`}>
              <div className="pf-item-main">
                <div className="pf-item-top"><b>{s.name}</b>{s.self ? <span className="pf-badge pf-ok"><Icon name="check" />Self-reported, confirmed</span> : <Locked label="From project records" />}
                  {s.hidden && <span className="pf-badge"><Icon name="eyeoff" />Hidden from others</span>}</div>
                <p className="small muted">{s.role} · {fmtDate(s.start)} to {fmtDate(s.end)} · {s.manDays} days · {s.status}</p>
                {s.note && <p className="small">{s.note}</p>}
              </div>
              <div className="pf-item-actions pf-wrap">
                <button type="button" className="btn btn-ghost small" aria-pressed={s.hidden} onClick={() => act("projects", "hide", { projectId: s.projectId, hidden: !s.hidden })}>
                  <Icon name={s.hidden ? "eye" : "eyeoff"} />{s.hidden ? "Show" : "Hide"}</button>
                <button type="button" className="btn btn-ghost small" onClick={() => act("feedback", "request", { projectId: s.projectId })}><Icon name="chat" />Ask for feedback</button>
                {!s.self && <ReportError section="projects" to="the project owner" targets={[s.name]} />}
              </div>
            </li>))}</ul>
        )}
      </Card>
    </>
  );
}

// ================================================================ Skills
function AddSkillRow({ pick, onDone }: { pick: Option; onDone: () => void }) {
  const { act } = useProfile();
  const [lvl, setLvl] = useState(0);
  const [yr, setYr] = useState(thisYear);
  const id = useId();
  const add = async () => { if (lvl && await act("skills", "add", { skillId: pick.id, level: lvl, year: yr })) onDone(); };
  return (
    <div className="pf-add-skill" role="group" aria-label={`Add ${pick.label}`} onKeyDown={(e) => { if (e.key === "Escape") onDone(); }}>
      <div className="pf-item-top"><b>{pick.label}</b>{pick.sub && <span className="small muted">{pick.sub}</span>}</div>
      <LevelPicker value={lvl} onChange={setLvl} label={`How well you know ${pick.label}`} />
      <div className="pf-row">
        <div className="pf-field pf-inline"><label htmlFor={`${id}-y`}>Last used</label>
          <select id={`${id}-y`} value={yr} onChange={(e) => setYr(Number(e.target.value))}>{YEARS.map((y) => <option key={y}>{y}</option>)}</select></div>
        <button type="button" className="btn btn-primary" disabled={!lvl} onClick={add}>Add skill</button>
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
        {!lvl && <span className="small muted">Choose a level to add it.</span>}
      </div>
    </div>
  );
}

export function SkillsTab() {
  const { b, act, removeLater, pending, go } = useProfile();
  const [pick, setPick] = useState<Option | null>(null);
  const have = new Set([...b.skills.map((s) => s.skillId)]);
  const opts = useMemo(() => b.catalog.skills.map((s) => ({ id: s.id, label: s.name, sub: s.family })), [b.catalog.skills]);
  const skills = b.skills.filter((s) => !pending.has(`skill:${s.skillId}`));
  return (
    <>
      <SectionHead title="Skills" desc="What you can do and how well. Skills you add are self-declared until your manager confirms them." section="skills" />
      <Card>
        {pick ? <AddSkillRow pick={pick} onDone={() => setPick(null)} /> : (
          <Combobox label="Add a skill" options={opts} exclude={have} placeholder="Search 114 skills, for example Python" onPick={setPick}
            onCreate={(q) => act("skills", "suggest", { name: q })} createLabel={(q) => `"${q}" is not in the list: suggest it to HR`} />
        )}
        {b.suggested.length > 0 && !pick && (
          <div className="pf-suggest"><span className="small muted">Suggested from your projects:</span>
            {b.suggested.filter((s) => !have.has(s.skillId)).map((s) => (
              <button key={s.skillId} type="button" className="pf-chip-add" title={s.reason} onClick={() => setPick({ id: s.skillId, label: s.name, sub: s.reason })}><Icon name="plus" />{s.name}</button>))}
          </div>
        )}
      </Card>
      <Card title={<>Your skills <span className="pf-count-chip">{skills.length}</span></>}>
        {skills.length === 0 ? <Empty icon="star" title="No skills yet" text="Search above, or tap a suggestion from your projects." /> : (
          <ul className="pf-list pf-skill-list">{skills.map((s) => (
            <li key={s.skillId} className="pf-item pf-skill">
              <div className="pf-item-main">
                <div className="pf-item-top"><b>{s.name}</b><span className="small muted">{s.family}</span><SourceBadge source={s.source} />
                  {s.validation === "pending" && <span className="pf-badge pf-wait"><Icon name="clock" />Awaiting manager</span>}
                  {s.validation === "declined" && <span className="pf-badge pf-bad"><Icon name="alert" />Manager declined</span>}</div>
                <div className="pf-skill-controls">
                  <LevelPicker compact value={s.level} label={`${s.name} level`} onChange={(n) => n !== s.level && act("skills", "update", { skillId: s.skillId, level: n })} />
                  <span className="small pf-level-name">{levelLabel(s.level)}</span>
                  <label className="sr-only" htmlFor={`y-${s.skillId}`}>{s.name}: last used</label>
                  <select id={`y-${s.skillId}`} className="pf-mini-select" value={s.year} onChange={(e) => act("skills", "update", { skillId: s.skillId, year: Number(e.target.value) })}>
                    {(YEARS.includes(s.year) ? YEARS : [s.year, ...YEARS]).map((y) => <option key={y} value={y}>Last used {y}</option>)}</select>
                  <button type="button" className="link-btn small" onClick={() => go("evidence")}>{s.evidence ? `${s.evidence} evidence` : "Add evidence"}</button>
                </div>
              </div>
              <div className="pf-item-actions">
                <button type="button" className="btn btn-ghost pf-icon-btn" aria-pressed={s.wantGrow} aria-label={`Want to grow ${s.name}`} title="Want to grow"
                  onClick={() => act("skills", "update", { skillId: s.skillId, wantGrow: !s.wantGrow })}><Icon name="trend" /></button>
                <RemoveButton label={s.name} onConfirm={() => removeLater(`skill:${s.skillId}`, `Removed ${s.name}`, () => act("skills", "remove", { skillId: s.skillId }))} />
              </div>
            </li>))}</ul>
        )}
        <p className="small muted">Change a level with the number buttons or the arrow keys. A changed level goes to your manager to confirm.</p>
      </Card>
      <Card title="Skills you want to grow">
        <Combobox label="Add a skill you want to learn" options={opts} exclude={new Set([...have, ...b.growOnly.map((g) => g.id)])} placeholder="Search skills"
          onPick={(o) => act("skills", "grow", { skillId: o.id, wantGrow: true })} />
        <div className="pf-chips">
          {b.skills.filter((s) => s.wantGrow).map((s) => <span key={s.skillId} className="chip"><Icon name="trend" />{s.name} (have)</span>)}
          {b.growOnly.map((g) => <span key={g.id} className="pf-tag">{g.name}<button type="button" aria-label={`Stop growing ${g.name}`} onClick={() => act("skills", "grow", { skillId: g.id, wantGrow: false })}><Icon name="x" /></button></span>)}
          {!b.growOnly.length && !b.skills.some((s) => s.wantGrow) && <span className="small muted">None yet. Growth paths use these to suggest courses.</span>}
        </div>
      </Card>
    </>
  );
}

// ================================================================ Evidence
const EV_KINDS = [
  { id: "project", label: "Project" }, { id: "incident", label: "Incident" }, { id: "knowledge", label: "Knowledge item" },
  { id: "certification", label: "Certification" }, { id: "document", label: "Document" }, { id: "external", label: "Work outside our systems" },
];

export function EvidenceTab() {
  const { b, act, removeLater, pending } = useProfile();
  const [skillId, setSkillId] = useState(b.skills[0]?.skillId ?? "");
  const [kind, setKind] = useState("project");
  const [refId, setRefId] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [err, setErr] = useState("");
  const id = useId();
  const items: { id: string; name: string }[] = kind === "project" ? b.catalog.myProjects : kind === "incident" ? b.catalog.myIncidents : kind === "knowledge" ? b.catalog.myKnowledge
    : kind === "certification" ? b.certs.era.map((c) => ({ id: c.certId, name: c.name })) : kind === "document" ? b.documents.map((d) => ({ id: d.id, name: d.filename })) : [];
  const add = async () => {
    if (!skillId) { setErr("Pick the skill this proves."); return; }
    if (kind !== "external" && !refId) { setErr(items.length ? "Pick the item that shows this skill." : "You have nothing of this kind on record. Choose another kind."); return; }
    if (kind === "external" && note.trim().length < 5) { setErr("Describe the work, since it is not in any system."); return; }
    setErr("");
    if (await act("evidence", "add", { skillId, kind, refId: kind === "external" ? null : refId, note, date })) { setRefId(""); setNote(""); }
  };
  const own = b.evidence.own.filter((e) => !pending.has(`ev:${e.id}`));
  return (
    <>
      <SectionHead title="Evidence" desc="Link each skill to the work that proves it. Evidence raises confidence in your skills." section="evidence" />
      <Card title="Link evidence to a skill">
        {b.skills.length === 0 ? <Empty icon="star" title="Add a skill first" text="Evidence is linked to a skill on your profile." /> : (
          <div className="pf-evform">
            <div className="pf-grid2">
              <div className="pf-field"><label htmlFor={`${id}-s`}>Skill</label>
                <select id={`${id}-s`} value={skillId} onChange={(e) => setSkillId(e.target.value)}>{b.skills.map((s) => <option key={s.skillId} value={s.skillId}>{s.name}</option>)}</select></div>
              <div className="pf-field"><label htmlFor={`${id}-d`}>When</label>
                <input id={`${id}-d`} type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} /></div>
            </div>
            <fieldset className="pf-fieldset"><legend>Kind of evidence</legend>
              <div className="pf-seg small">{EV_KINDS.map((k) => <button key={k.id} type="button" aria-pressed={kind === k.id} onClick={() => { setKind(k.id); setRefId(""); setErr(""); }}>{k.label}</button>)}</div>
            </fieldset>
            {kind !== "external" && (
              <div className="pf-field"><label htmlFor={`${id}-r`}>Which one</label>
                <select id={`${id}-r`} value={refId} onChange={(e) => setRefId(e.target.value)} disabled={!items.length}>
                  <option value="">{items.length ? "Choose..." : "None on record"}</option>{items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></div>
            )}
            <div className="pf-field"><label htmlFor={`${id}-n`}>{kind === "external" ? "Describe the work" : "Note (optional)"}</label>
              <textarea id={`${id}-n`} rows={2} maxLength={600} value={note} onChange={(e) => setNote(e.target.value)} aria-describedby={`${id}-e`}
                placeholder={kind === "external" ? "For example: built the OTDR test rig at my previous employer, 2019" : "What this shows about the skill"} /></div>
            <FieldError id={`${id}-e`} text={err} />
            <div className="pf-row"><button type="button" className="btn btn-primary" onClick={add}>Link evidence</button></div>
          </div>
        )}
      </Card>
      <Card title={<>Linked by you <span className="pf-count-chip">{own.length}</span></>}>
        {own.length === 0 ? <Empty icon="link" title="No evidence linked yet" text="Pick a skill above and the project, incident or document that shows it." /> : (
          <ul className="pf-list">{own.map((e) => (
            <li key={e.id} className={`pf-item ${e.hidden ? "pf-dim" : ""}`}>
              <div className="pf-item-main">
                <div className="pf-item-top"><b>{e.skill}</b><span className="chip">{EV_KINDS.find((k) => k.id === e.kind)?.label ?? e.kind}</span>{e.hidden && <span className="pf-badge"><Icon name="eyeoff" />Hidden</span>}</div>
                <p className="small">{e.refLabel || e.note}</p>{e.refLabel && e.note && <p className="small muted">{e.note}</p>}
                <p className="small muted">{e.date}</p>
              </div>
              <div className="pf-item-actions">
                <button type="button" className="btn btn-ghost pf-icon-btn" aria-pressed={e.hidden} aria-label={e.hidden ? "Show to others" : "Hide from others"} title={e.hidden ? "Show" : "Hide"}
                  onClick={() => act("evidence", "hide", { id: e.id, hidden: !e.hidden })}><Icon name={e.hidden ? "eye" : "eyeoff"} /></button>
                <RemoveButton label="evidence" onConfirm={() => removeLater(`ev:${e.id}`, "Removed evidence", () => act("evidence", "remove", { id: e.id }))} />
              </div>
            </li>))}</ul>
        )}
      </Card>
      <Card title={<><Icon name="lock" />Found in your work records</>}>
        <p className="small muted">SkillBridge reads these automatically. They already count towards your skills.</p>
        {b.evidence.auto.length === 0 ? <p className="small muted">No work records name you yet.</p> : (
          <ul className="pf-list compact">{b.evidence.auto.map((e) => (
            <li key={`${e.kind}-${e.id}`} className="pf-item"><div className="pf-item-main"><div className="pf-item-top"><span className="chip">{e.kind}</span><span className="small muted">{e.date}</span></div><p className="small">{e.text}</p></div></li>))}</ul>
        )}
      </Card>
    </>
  );
}

// ================================================================ Documents
const DOC_KINDS = ["CV", "Certificate", "Portfolio", "Report"];

export function DocumentsTab() {
  const { b, act, upload, removeLater, pending, userId } = useProfile();
  const [kind, setKind] = useState("CV");
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const send = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    await upload(f, kind);
    setBusy(false);
    if (input.current) input.current.value = "";
  };
  const docs = b.documents.filter((d) => !pending.has(`doc:${d.id}`));
  return (
    <>
      <SectionHead title="Documents" desc="Upload your CV, certificates or reports. SkillBridge reads them and suggests skills for you to accept." section="documents" />
      <Card>
        <div className={`pf-drop ${drag ? "over" : ""} ${busy ? "busy" : ""}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); void send(e.dataTransfer.files[0]); }}>
          {busy ? <><span className="spinner" aria-hidden="true" /><p aria-live="polite"><b>Reading your document...</b> Finding skills, usually a few seconds.</p></> : (
            <>
              <Icon name="upload" className="icon pf-drop-i" />
              <p><b>Drop a file here</b> or <button type="button" className="link-btn" onClick={() => input.current?.click()}>choose a file</button></p>
              <p className="small muted">PDF, DOCX or TXT, up to 5 MB. Files stay private unless you share them. Gemini on Vertex AI reads them; nothing is used for model training.</p>
            </>
          )}
          <input ref={input} id={`${id}-f`} type="file" accept=".pdf,.docx,.txt" className="sr-only" aria-label="Choose a document to upload" onChange={(e) => void send(e.target.files?.[0])} />
        </div>
        <fieldset className="pf-fieldset"><legend>This document is a</legend>
          <div className="pf-seg small">{DOC_KINDS.map((k) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{k}</button>)}</div></fieldset>
      </Card>
      {docs.length === 0 ? <Card><Empty icon="doc" title="No documents yet" text="Upload your CV to get skill suggestions in seconds." /></Card> : docs.map((d) => {
        const open = d.suggestions.filter((s) => s.status === "suggested");
        return (
          <Card key={d.id} title={<><Icon name="doc" />{d.filename}</>} actions={
            <div className="pf-row">
              <a className="btn btn-ghost small" href={`/api/me/documents?id=${encodeURIComponent(d.id)}&as=${userId}`} target="_blank" rel="noreferrer"><Icon name="eye" />Open</a>
              <RemoveButton label={d.filename} onConfirm={() => removeLater(`doc:${d.id}`, `Deleted ${d.filename}`, () => act("documents", "remove", { docId: d.id }))} />
            </div>}>
            <p className="small muted">{d.kind} · {(d.size / 1024).toFixed(0)} KB · uploaded {d.uploadedAt.slice(0, 10)} · skills found by {d.ai === "gemini" ? "Gemini" : "matching the skills list"}</p>
            <Toggle label="Share with my manager" checked={d.shared} onChange={(v) => act("documents", "share", { docId: d.id, shared: v })} hint="Private to you by default." />
            {d.suggestions.length === 0 ? <p className="small muted">No skills from the list were found in this document.</p> : (
              <>
                <div className="pf-row-between"><h4>Suggested skills <span className="pf-count-chip">{open.length} to review</span></h4>
                  {open.length > 1 && <button type="button" className="btn small" onClick={async () => { for (const s of open) await act("documents", "suggestion", { docId: d.id, skillId: s.skillId, decision: "accept", level: s.level }); }}>
                    <Icon name="check" />Accept all {open.length}</button>}</div>
                <ul className="pf-list">{d.suggestions.map((s) => (
                  <li key={s.skillId} className={`pf-item ${s.status !== "suggested" ? "pf-dim" : ""}`}>
                    <div className="pf-item-main">
                      <div className="pf-item-top"><b>{s.name}</b>{s.have && <span className="chip">On your profile</span>}
                        {s.status === "accepted" && <span className="pf-badge pf-ok"><Icon name="check" />Accepted</span>}
                        {s.status === "rejected" && <span className="pf-badge"><Icon name="x" />Rejected</span>}</div>
                      {s.quote && <blockquote className="pf-quote">"{s.quote}"</blockquote>}
                    </div>
                    {s.status === "suggested" && (
                      <div className="pf-item-actions pf-col">
                        <LevelPicker compact value={s.level} label={`${s.name} level`} onChange={(n) => act("documents", "suggestion", { docId: d.id, skillId: s.skillId, decision: "accept", level: n })} />
                        <div className="pf-row">
                          <button type="button" className="btn btn-approve small" onClick={() => act("documents", "suggestion", { docId: d.id, skillId: s.skillId, decision: "accept", level: s.level })}><Icon name="check" />Accept at {levelLabel(s.level)}</button>
                          <button type="button" className="btn small" onClick={() => act("documents", "suggestion", { docId: d.id, skillId: s.skillId, decision: "reject" })}>Reject</button>
                        </div>
                      </div>
                    )}
                  </li>))}</ul>
              </>
            )}
          </Card>
        );
      })}
    </>
  );
}

// ================================================================ Certifications
const expiryState = (m: string) => {
  if (!m) return null;
  const end = new Date(`${m}-28`).getTime();
  const days = (end - Date.now()) / 86400000;
  return days < 0 ? "expired" : days < 90 ? "soon" : null;
};

export function CertsTab() {
  const { b, act, removeLater, pending } = useProfile();
  const [yr, setYr] = useState(thisYear);
  const [pickCert, setPickCert] = useState<Option | null>(null);
  const [own, setOwn] = useState({ name: "", issuer: "", issued: "", expiry: "" });
  const [err, setErr] = useState("");
  const id = useId();
  const have = new Set(b.certs.era.map((c) => c.certId));
  const opts = useMemo(() => b.catalog.certifications.map((c) => ({ id: c.id, label: c.name, sub: c.skill })), [b.catalog.certifications]);
  const addOwn = async () => {
    if (!own.name.trim()) { setErr("Give the certification a name."); return; }
    if (own.issued && own.expiry && own.expiry < own.issued) { setErr("Expiry cannot be before the issue date."); return; }
    setErr("");
    if (await act("certs", "addOwn", own)) setOwn({ name: "", issuer: "", issued: "", expiry: "" });
  };
  return (
    <>
      <SectionHead title="Certifications" desc="Certifications from ERA, plus any you hold that are not recorded yet." section="certs" />
      <Card title={<>On record <span className="pf-count-chip">{b.certs.era.length}</span></>}>
        {b.certs.era.length === 0 ? <p className="small muted">No certifications on record.</p> : (
          <ul className="pf-list compact">{b.certs.era.filter((c) => !pending.has(`cert:${c.certId}`)).map((c) => (
            <li key={c.certId} className="pf-item">
              <div className="pf-item-main"><div className="pf-item-top"><b>{c.name}</b>{c.self ? <SourceBadge source="self" /> : <Locked />}</div><p className="small muted">{c.skill} · {c.year}</p></div>
              {c.self && <div className="pf-item-actions"><RemoveButton label={c.name} onConfirm={() => removeLater(`cert:${c.certId}`, `Removed ${c.name}`, () => act("certs", "removeCatalog", { certId: c.certId }))} /></div>}
            </li>))}</ul>
        )}
        <div className="pf-addcert">
          {pickCert ? (
            <div className="pf-row">
              <b>{pickCert.label}</b>
              <label className="sr-only" htmlFor={`${id}-y`}>Year earned</label>
              <select id={`${id}-y`} value={yr} onChange={(e) => setYr(Number(e.target.value))}>{YEARS.map((y) => <option key={y} value={y}>Earned {y}</option>)}</select>
              <button type="button" className="btn btn-primary small" onClick={async () => { if (await act("certs", "addCatalog", { certId: pickCert.id, year: yr })) setPickCert(null); }}>Add</button>
              <button type="button" className="btn small" onClick={() => setPickCert(null)}>Cancel</button>
            </div>
          ) : <Combobox label="Add one from the certification list" options={opts} exclude={have} placeholder="Search certifications" onPick={setPickCert} />}
        </div>
      </Card>
      <Card title="Not in the list">
        <div className="pf-grid2">
          <div className="pf-field"><label htmlFor={`${id}-n`}>Certification name</label><input id={`${id}-n`} value={own.name} maxLength={120} onChange={(e) => setOwn({ ...own, name: e.target.value })} placeholder="For example: CCNP Enterprise" /></div>
          <div className="pf-field"><label htmlFor={`${id}-i`}>Issuer</label><input id={`${id}-i`} value={own.issuer} maxLength={120} onChange={(e) => setOwn({ ...own, issuer: e.target.value })} placeholder="For example: Cisco" /></div>
          <div className="pf-field"><label htmlFor={`${id}-d`}>Issued</label><input id={`${id}-d`} type="month" max={thisMonth()} value={own.issued} onChange={(e) => setOwn({ ...own, issued: e.target.value })} /></div>
          <div className="pf-field"><label htmlFor={`${id}-x`}>Expires</label><input id={`${id}-x`} type="month" min={own.issued || undefined} value={own.expiry} onChange={(e) => setOwn({ ...own, expiry: e.target.value })} /></div>
        </div>
        <FieldError id={`${id}-e`} text={err} />
        <div className="pf-row"><button type="button" className="btn btn-primary" onClick={addOwn}><Icon name="plus" />Add certification</button></div>
        {b.certs.own.length > 0 && (
          <ul className="pf-list compact">{b.certs.own.filter((c) => !pending.has(`pc:${c.id}`)).map((c) => {
            const st = expiryState(c.expiry);
            return (
              <li key={c.id} className="pf-item">
                <div className="pf-item-main"><div className="pf-item-top"><b>{c.name}</b><SourceBadge source="self" />
                  {st === "expired" && <span className="pf-badge pf-bad"><Icon name="alert" />Expired</span>}{st === "soon" && <span className="pf-badge pf-wait"><Icon name="clock" />Expires soon</span>}</div>
                  <p className="small muted">{[c.issuer, c.issued && `issued ${fmtMonth(c.issued)}`, c.expiry && `expires ${fmtMonth(c.expiry)}`].filter(Boolean).join(" · ")}</p></div>
                <div className="pf-item-actions"><RemoveButton label={c.name} onConfirm={() => removeLater(`pc:${c.id}`, `Removed ${c.name}`, () => act("certs", "removeOwn", { id: c.id }))} /></div>
              </li>);
          })}</ul>
        )}
      </Card>
    </>
  );
}
