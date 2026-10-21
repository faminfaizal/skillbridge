"use client";
// Job vacancy to fill: describe a post (an existing one, typed details or an uploaded job description), check what was
// read, and get an internal shortlist from the deterministic match engine. Nothing is stored and nobody is contacted.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";
import { aiLabel, pct } from "../lib/format";
import { GRADES, gradeLabel } from "../lib/grades";
import type { ActPanelProps } from "./actPanels";
import type { Position, Provider, VacancyInput, VacancyMatch, VacancyResult } from "../lib/types";

type Mode = "post" | "type" | "upload";
type SkillRef = { id: string; name: string; family: string };
type ReadInfo = { provider: Provider; read: "document" | "scan"; unmapped: string[] };

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = ".pdf,.docx,.txt,.png,.jpg,.jpeg,.webp";
const MODES: { id: Mode; label: string; icon: string }[] = [
  { id: "post", label: "Existing post", icon: "brief" },
  { id: "type", label: "Type details", icon: "edit" },
  { id: "upload", label: "Upload job description", icon: "upload" },
];
const BLANK: VacancyInput = { title: "", level: null, responsibilities: [], competencies: [], must: [], nice: [] };
// Kept across remounts, so "Back to job vacancy to fill" from a person returns to the same shortlist.
type Drafts = { type: VacancyInput; upload: VacancyInput }; // each tab keeps its own draft
let memo: { mode: Mode; drafts: Drafts; readInfo: ReadInfo | null; result: VacancyResult | null } = { mode: "post", drafts: { type: BLANK, upload: BLANK }, readInfo: null, result: null };

function readiness(c: VacancyMatch): { label: string; cls: string } {
  if (c.readyNow) return { label: "Ready now", cls: "vac-ready" };
  if (!c.gaps.length) return { label: "Nearly ready", cls: "vac-near" };
  return { label: "Ready with development", cls: "vac-dev" };
}

async function call<T>(init: RequestInit & { url?: string }): Promise<T> {
  const r = await fetch(init.url ?? "/api/vacancy", init);
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(b.error ?? "Something went wrong. Try again.");
  return b as T;
}

export default function VacancyPanel({ onFocus, onShow, onToast }: ActPanelProps) {
  const id = useId();
  const [mode, setMode] = useState<Mode>(memo.mode);
  const [skills, setSkills] = useState<SkillRef[]>([]);
  const [drafts, setDrafts] = useState<Drafts>(memo.drafts);
  const which: keyof Drafts = mode === "upload" ? "upload" : "type";
  const draft = drafts[which];
  const setDraft = (v: VacancyInput) => setDrafts((d) => ({ ...d, [which]: v }));
  const [readInfo, setReadInfo] = useState<ReadInfo | null>(memo.readInfo);
  const [result, setResult] = useState<VacancyResult | null>(memo.result);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [showBasis, setShowBasis] = useState(false);

  useEffect(() => {
    call<{ skills: SkillRef[] }>({}).then((b) => setSkills(b.skills)).catch(() => {});
    if (memo.result) show(memo.result);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { memo = { mode, drafts, readInfo, result }; }, [mode, drafts, readInfo, result]);
  const nameOf = useMemo(() => new Map(skills.map((s) => [s.id, s.name])), [skills]);

  function show(r: VacancyResult) {
    setResult(r);
    const people = r.shortlist.map((c) => c.personId);
    onShow({ nodeIds: [...people, ...r.vacancy.must], stars: r.shortlist.filter((c) => c.hidden).map((c) => c.personId), pulse: people.slice(0, 3) });
  }

  async function run(body: object) {
    setBusy(true); setErr("");
    try {
      show(await call<VacancyResult>({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  async function read(body: FormData) {
    setBusy(true); setErr(""); setResult(null);
    try {
      const r = await call<{ parsed: VacancyInput } & ReadInfo>({ method: "POST", body });
      setDrafts((d) => ({ ...d, upload: { ...BLANK, ...r.parsed } }));
      setReadInfo({ provider: r.provider, read: r.read, unmapped: r.unmapped });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  function switchMode(m: Mode) { setMode(m); setErr(""); setResult(null); }

  return (
    <div className="panel-body">
      <div className="eyebrow"><Icon name="brief" /> Act</div>
      <h2 className="panel-title">Job vacancy to fill</h2>
      <p className="muted small">Describe the post and SkillBridge ranks the closest internal people, with the evidence for each. Scout and offer interviews without advertising the post.</p>

      <div className="vac-tabs" role="tablist" aria-label="How to describe the vacancy">
        {MODES.map((m) => (
          <button key={m.id} role="tab" id={`${id}-${m.id}`} aria-selected={mode === m.id} aria-controls={`${id}-panel`} className={`vac-tab${mode === m.id ? " on" : ""}`}
            onClick={() => switchMode(m.id)}><Icon name={m.icon} />{m.label}</button>
        ))}
      </div>

      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${mode}`} className="vac-pane">
        {mode === "post" && <PostSearch busy={busy} onPick={(p) => void run({ positionId: p.id })} />}
        {mode === "upload" && !readInfo && <Upload busy={busy} onFile={(f) => { const d = new FormData(); d.set("file", f); void read(d); }}
          onSample={() => { const d = new FormData(); d.set("sample", "true"); void read(d); }} />}
        {(mode === "type" || (mode === "upload" && readInfo)) && (
          <Editor draft={draft} setDraft={setDraft} skills={skills} nameOf={nameOf} readInfo={mode === "upload" ? readInfo : null} busy={busy}
            onReset={mode === "upload" ? () => { setReadInfo(null); setDraft(BLANK); setResult(null); } : undefined}
            onMatch={() => void run({ title: draft.title, level: draft.level, responsibilities: draft.responsibilities, competencies: draft.competencies, must: draft.must, nice: draft.nice })} />
        )}
      </div>
      {err && <p className="intake-err small" role="alert">{err}</p>}

      {result && (
        <Shortlist r={result} nameOf={nameOf} onFocus={onFocus} onToast={onToast} showBasis={showBasis} setShowBasis={setShowBasis} />
      )}
    </div>
  );
}

function PostSearch({ busy, onPick }: { busy: boolean; onPick: (p: Position) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Position[] | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) { setHits(null); return; }
    const t = setTimeout(() => {
      call<{ positions: Position[] }>({ url: `/api/vacancy?q=${encodeURIComponent(q.trim())}` }).then((b) => setHits(b.positions)).catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="intake">
      <label className="intake-field"><span className="eyebrow">Find the post</span>
        <input className="intake-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Post title, post number or the holder's name, for example Priya Nair" maxLength={80} />
      </label>
      <p className="small muted">The post is treated as vacant: its required skills are used and its current holder is left out.</p>
      {hits && hits.length === 0 && <p className="small muted">No post matches. Try another title or name.</p>}
      {hits && hits.length > 0 && (
        <ul className="vac-posts">
          {hits.map((p) => (
            <li key={p.id} className="card">
              <div className="row-between"><b>{p.title}</b><span className="muted small">{p.id}</span></div>
              <p className="small muted">{gradeLabel(p.level)} · {p.unit} · {p.holder ? `held by ${p.holder}` : "holder keeps their profile private"}</p>
              <div className="chips">{p.skills.filter((s) => s.must).map((s) => <span key={s.skillId} className="chip">{s.skill}</span>)}</div>
              <button className="btn btn-primary small" disabled={busy} onClick={() => onPick(p)}><Icon name="search" />{busy ? "Matching..." : "Find matches for this post"}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Upload({ busy, onFile, onSample }: { busy: boolean; onFile: (f: File) => void; onSample: () => void }) {
  const id = useId();
  const [drag, setDrag] = useState(false);
  const [err, setErr] = useState("");
  function pick(f: File | undefined | null) {
    setErr("");
    if (!f) return;
    const ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
    if (!ACCEPT.split(",").includes(ext)) { setErr("Use a PDF, DOCX, TXT or an image (PNG, JPG, WebP)."); return; }
    if (f.size > MAX_BYTES) { setErr("That file is over 5 MB. Upload a smaller copy."); return; }
    onFile(f);
  }
  return (
    <div className="intake" aria-busy={busy}>
      <div className={`intake-drop ${drag ? "over" : ""}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}>
        <Icon name="upload" />
        <span className="small muted">{busy ? "Reading the job description..." : <>Drop a job description or position profile, or <label htmlFor={`${id}-f`} className="link-btn">choose a file</label> (PDF, DOCX, TXT or a scan, 5 MB)</>}</span>
        <input id={`${id}-f`} type="file" accept={ACCEPT} className="sr-only" aria-label="Choose a job description" disabled={busy} onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      {err && <p className="intake-err small" role="alert">{err}</p>}
      <p className="small muted">Gemini reads the document; every skill it finds is mapped onto SkillBridge&apos;s own skills list, and you can correct it before matching.</p>
      <div className="intake-actions"><button type="button" className="btn small" onClick={onSample} disabled={busy}><Icon name="doc" />Try the sample position profile</button></div>
    </div>
  );
}

function Editor({ draft, setDraft, skills, nameOf, readInfo, busy, onMatch, onReset }: {
  draft: VacancyInput; setDraft: (v: VacancyInput) => void; skills: SkillRef[]; nameOf: Map<string, string>; readInfo: ReadInfo | null;
  busy: boolean; onMatch: () => void; onReset?: () => void;
}) {
  const id = useId();
  const [pick, setPick] = useState("");
  const [pickErr, setPickErr] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const has = (s: string) => draft.must.includes(s) || draft.nice.includes(s);

  function add(must: boolean) {
    setPickErr("");
    const s = skills.find((x) => x.name.toLowerCase() === pick.trim().toLowerCase());
    if (!s) { setPickErr("Choose a skill from the list."); return; }
    if (has(s.id)) { setPickErr(`${s.name} is already added.`); return; }
    setDraft(must ? { ...draft, must: [...draft.must, s.id] } : { ...draft, nice: [...draft.nice, s.id] });
    setPick("");
    input.current?.focus();
  }
  const remove = (s: string) => setDraft({ ...draft, must: draft.must.filter((x) => x !== s), nice: draft.nice.filter((x) => x !== s) });
  const flip = (s: string) => setDraft(draft.must.includes(s)
    ? { ...draft, must: draft.must.filter((x) => x !== s), nice: [...draft.nice, s] }
    : { ...draft, nice: draft.nice.filter((x) => x !== s), must: [...draft.must, s] });

  const chip = (s: string, must: boolean) => (
    <span key={s} className={`chip vac-skill${must ? " must" : ""}`}>
      <button type="button" className="link-btn" onClick={() => flip(s)} title={must ? "Make nice to have" : "Make required"} aria-label={`${nameOf.get(s) ?? s}: ${must ? "required, make nice to have" : "nice to have, make required"}`}>{nameOf.get(s) ?? s}</button>
      <button type="button" className="vac-x" onClick={() => remove(s)} aria-label={`Remove ${nameOf.get(s) ?? s}`}><Icon name="x" /></button>
    </span>
  );

  return (
    <form className="intake" onSubmit={(e) => { e.preventDefault(); if (draft.must.length + draft.nice.length) onMatch(); }}>
      {readInfo && (
        <div className="chips">
          <span className="chip" title="Which service read the job description">Read by: {aiLabel(readInfo.provider)} ({readInfo.read})</span>
          {onReset && <button type="button" className="link-btn small" onClick={onReset}>Read another file</button>}
        </div>
      )}
      <label className="intake-field"><span className="eyebrow">Post name</span>
        <input className="intake-input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="For example: Network Analytics Lead" maxLength={120} />
      </label>
      <label className="intake-field"><span className="eyebrow">Grade (optional)</span>
        <select className="intake-input" value={draft.level ?? ""} onChange={(e) => setDraft({ ...draft, level: e.target.value || null })}>
          <option value="">Not set: compare at each person&apos;s own grade</option>
          {GRADES.map((g) => <option key={g.code} value={g.code}>{g.label}</option>)}
        </select>
      </label>
      <label className="intake-field"><span className="eyebrow">Responsibilities (one per line, shown but not scored)</span>
        <textarea className="intake-input intake-text" rows={3} value={(draft.responsibilities ?? []).join("\n")} maxLength={2000}
          onChange={(e) => setDraft({ ...draft, responsibilities: e.target.value.split("\n").slice(0, 8) })} placeholder="For example: Build data pipelines for network telemetry" />
      </label>

      <div className="intake-field">
        <span className="eyebrow">Skills</span>
        <div className="vac-pick">
          <input ref={input} className="intake-input" list={`${id}-skills`} value={pick} onChange={(e) => setPick(e.target.value)} placeholder="Type a skill, for example Python"
            aria-label="Skill to add" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(true); } }} />
          <datalist id={`${id}-skills`}>{skills.map((s) => <option key={s.id} value={s.name} />)}</datalist>
          <button type="button" className="btn small" onClick={() => add(true)}><Icon name="plus" />Required</button>
          <button type="button" className="btn btn-ghost small" onClick={() => add(false)}>Nice to have</button>
        </div>
        {pickErr && <p className="intake-err small" role="alert">{pickErr}</p>}
        <div className="vac-skill-group"><span className="small muted">Required</span><div className="chips">{draft.must.length ? draft.must.map((s) => chip(s, true)) : <span className="small muted">None yet</span>}</div></div>
        <div className="vac-skill-group"><span className="small muted">Nice to have</span><div className="chips">{draft.nice.length ? draft.nice.map((s) => chip(s, false)) : <span className="small muted">None</span>}</div></div>
        <p className="small muted">Select a skill to move it between required and nice to have.</p>
        {readInfo && readInfo.unmapped.length > 0 && <p className="small muted">Not in the skills list, so not scored: {readInfo.unmapped.join(", ")}.</p>}
        {(draft.competencies ?? []).length > 0 && <p className="small muted">Competencies asked for: {draft.competencies!.join(", ")}.</p>}
      </div>

      <div className="intake-actions">
        <button type="submit" className="btn btn-primary small" disabled={busy || !(draft.must.length + draft.nice.length)}><Icon name="search" />{busy ? "Matching..." : "Find matches"}</button>
        {!(draft.must.length + draft.nice.length) && <span className="small muted">Add at least one skill to match.</span>}
      </div>
    </form>
  );
}

function Shortlist({ r, nameOf, onFocus, onToast, showBasis, setShowBasis }: {
  r: VacancyResult; nameOf: Map<string, string>; onFocus: (id: string) => void; onToast: (m: string) => void; showBasis: boolean; setShowBasis: (b: boolean) => void;
}) {
  const v = r.vacancy;
  const ready = r.shortlist.filter((c) => c.readyNow).length;

  function copy() {
    const lines = [
      `Internal shortlist: ${v.titleShown}${v.level ? ` (${gradeLabel(v.level)})` : ""}`,
      `Required: ${v.must.map((s) => nameOf.get(s) ?? s).join(", ")}`,
      "",
      ...r.shortlist.map((c, i) => `${i + 1}. ${c.name}, ${c.post} (${c.unit}, ${c.location}): match ${pct(c.score)}, ${readiness(c).label.toLowerCase()}${c.gaps.length ? `; gaps: ${c.gaps.join(", ")}${c.weeks ? ` (about ${c.weeks} weeks)` : ""}` : ""}`),
      "",
      "Not advertised. Ranked by the SkillBridge match engine on skills and work evidence.",
    ];
    navigator.clipboard?.writeText(lines.join("\n")).then(() => onToast("Shortlist copied."), () => onToast("Could not copy. Select the text instead."));
  }

  return (
    <section className="vac-result rise" aria-label="Internal shortlist">
      <div className="decision">
        <span className="eyebrow">Shortlist{v.positionId ? ` · ${v.positionId}` : ""}</span>
        <p><b>{v.titleShown}</b>{v.level ? ` · ${gradeLabel(v.level)}` : ""}</p>
        <div className="chips">{v.must.map((s) => <button key={s} className="chip chip-btn" onClick={() => onFocus(s)}>{nameOf.get(s) ?? s}</button>)}</div>
        <p className="small muted">{r.shortlist.length} people, {ready} ready now.</p>
      </div>
      <div className="intake-actions">
        <button className="btn small" onClick={copy} disabled={!r.shortlist.length}><Icon name="copy" />Copy shortlist</button>
      </div>
      {r.shortlist.length === 0 && <p className="small">Nobody who shares their profile has these skills yet. Try fewer required skills.</p>}
      <ol className="vac-list">
        {r.shortlist.map((c) => {
          const rd = readiness(c);
          return (
            <li key={c.personId} className="card vac-card">
              <div className="row-between">
                <button className="link-btn" onClick={() => onFocus(c.personId)}><b>{c.name}</b></button>
                <b className="num">{pct(c.score)}</b>
              </div>
              <p className="small muted">{c.post} · {gradeLabel(c.level)} · {c.unit}, {c.location}</p>
              <div className="chips">
                <span className={`chip ${rd.cls}`}>{rd.label}</span>
                <span className="chip">{c.move === "lateral" ? "Lateral move" : c.move === "step up" ? "Step up" : c.move === "stretch" ? "Stretch move" : "Step down"}</span>
                <span className="chip">{c.availabilityPct}% free</span>
                {c.hidden && <span className="chip chip-inferred"><Icon name="star" />Hidden talent</span>}
              </div>
              <div className="chips">
                {c.skills.filter((s) => s.must).map((s) => (
                  <span key={s.skillId} className={`chip${s.met ? " post-met" : " chip-gap"}`} title={`${pct(s.value)} capability`}><Icon name={s.met ? "check" : "minus"} />{s.skill}</span>
                ))}
              </div>
              {!c.readyNow && c.gaps.length > 0 && <p className="small">To close: {c.gaps.join(", ")}{c.weeks ? `, about ${c.weeks} weeks of learning` : ""}.</p>}
              <details className="vac-why">
                <summary className="small">Why this person</summary>
                <p className="small muted">Skills {pct(c.breakdown.skill)} · Projects {pct(c.breakdown.project)} · Context {pct(c.breakdown.domain)} · Recency {pct(c.breakdown.recency)} · Related skills {pct(c.breakdown.adjacent)}</p>
                <ul className="evidence">{c.evidence.map((e) => <li key={e.id}><span className="ev-kind">{e.kind}</span> {e.text}</li>)}</ul>
              </details>
            </li>
          );
        })}
      </ol>
      {r.privateCount > 0 && <p className="small muted"><Icon name="lock" /> {r.privateCount} more {r.privateCount === 1 ? "person scores as high but keeps a" : "people score as high but keep their"} profile private: counted, not named.</p>}
      <button className="btn btn-ghost small" aria-expanded={showBasis} onClick={() => setShowBasis(!showBasis)}>{showBasis ? "Hide" : "Show"} how this is calculated</button>
      {showBasis && <ul className="assumptions">{r.basis.map((b) => <li key={b}>{b}</li>)}</ul>}
    </section>
  );
}
