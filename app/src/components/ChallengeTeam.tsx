"use client";
// Challenge Team: review the proposed team, see how it fits together, swap anyone (AI's next best or a named person), then activate.
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { pct, money } from "../lib/format";
import type { AskResponse, Candidate, TeamEvaluation, ValueEstimate } from "../lib/types";

export type SlotSource = "ai" | "next" | "manager" | "empty";
export interface TeamDraft { ids: (string | null)[]; sources: SlotSource[]; passed: string[][] }

export function initialDraft(r: AskResponse): TeamDraft {
  const ids = r.requirements.map((req) => r.team.find((c) => c.role === req.role)?.personId ?? null);
  return { ids, sources: ids.map((id) => (id ? "ai" : "empty")), passed: ids.map(() => []) };
}

const SOURCE_LABEL: Record<SlotSource, string> = { ai: "AI proposal", next: "AI next best", manager: "Chosen by you", empty: "" };
const PARTS: { key: keyof TeamEvaluation["fit"]["parts"]; label: string; help: string }[] = [
  { key: "roleFit", label: "Role fit", help: "How well each person fits their role (an unfilled role counts as 0)" },
  { key: "coverage", label: "Skill coverage", help: "Required skills that someone on the team holds at 60% or more" },
  { key: "complementarity", label: "Complementarity", help: "Members who bring a skill no one else on the team holds as strongly" },
  { key: "availability", label: "Availability", help: "Free time per member; 50% or more counts as fully available" },
];
const BREAKDOWN: [keyof Candidate["breakdown"], string][] = [["skill", "Skill"], ["project", "Projects"], ["domain", "Domain"], ["recency", "Recency"], ["adjacent", "Adjacent"]];

async function post<T>(body: object): Promise<T> {
  const res = await fetch("/api/team", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error ?? "Something went wrong.");
  return j as T;
}

function Gauge({ score, delta }: { score: number; delta: number | null }) {
  const c = 2 * Math.PI * 54;
  return (
    <div className="ct-gauge" role="img" aria-label={`Team match ${pct(score)}`}>
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <defs><linearGradient id="ctGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="var(--accent)" /><stop offset="1" stopColor="var(--accent-2)" /></linearGradient></defs>
        <circle cx="60" cy="60" r="54" className="ct-ring-bg" />
        <circle cx="60" cy="60" r="54" className="ct-ring" style={{ strokeDasharray: c, strokeDashoffset: c * (1 - score) }} />
      </svg>
      <div className="ct-gauge-v">
        <b className="num">{Math.round(score * 100)}<small>%</small></b>
        <span>Team match</span>
        {delta !== null && delta !== 0 && <em className={delta > 0 ? "up" : "down"}>{delta > 0 ? "+" : ""}{delta} pts vs AI proposal</em>}
        {delta === 0 && <em>AI proposal</em>}
      </div>
    </div>
  );
}

function PersonPicker({ slot, role, requirements, ids, onPick, onCancel }: {
  slot: number; role: string; requirements: AskResponse["requirements"]; ids: (string | null)[]; onPick: (c: Candidate) => void; onCancel: () => void;
}) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Candidate[] | null>(null);
  const [err, setErr] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    if (q.trim().length < 2) { setRes(null); setErr(""); return; }
    const t = setTimeout(() => {
      post<Candidate[]>({ mode: "search", requirements, personIds: ids, slot, q })
        .then((r) => { setRes(r); setErr(""); }).catch((e) => setErr((e as Error).message));
    }, 220);
    return () => clearTimeout(t);
  }, [q, slot, requirements, ids]);
  const id = `ct-search-${slot}`;
  return (
    <div className="ct-picker" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onCancel(); } }}>
      <label htmlFor={id} className="small muted">Name someone for {role}</label>
      <div className="ct-picker-in"><Icon name="search" /><input id={id} ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type at least 2 letters" autoComplete="off" />
        <button className="btn btn-ghost small" onClick={onCancel}>Cancel</button></div>
      {err && <p className="small danger" role="alert">{err}</p>}
      {res && (res.length ? (
        <ul className="ct-results" aria-label={`People matching ${q}`}>
          {res.map((c) => (
            <li key={c.personId}>
              <button onClick={() => onPick(c)}>
                <span><b>{c.name}</b><span className="muted small"> {c.title} · {c.department}</span></span>
                <span className={`num ct-score-chip${c.score < 0.7 ? " low" : ""}`}>{pct(c.score)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="small muted" role="status">No one by that name is available for this team.</p>)}
    </div>
  );
}

function SlotCard({ slot, role, skills, member, source, fit, names, busy, picking, onNext, onPick, onClear, onRevert, canRevert, children }: {
  slot: number; role: string; skills: string[]; member: Candidate | null; source: SlotSource; fit: TeamEvaluation["fit"] | null;
  names: Map<string, string>; busy: boolean; picking: boolean; onNext: () => void; onPick: () => void; onClear: () => void; onRevert: () => void; canRevert: boolean;
  children?: React.ReactNode;
}) {
  const brings = member && fit ? fit.brings[member.personId] ?? [] : [];
  const mates = member && fit ? fit.pairs.filter((p) => p.a === member.personId || p.b === member.personId) : [];
  const warn = member && fit ? fit.warnings.filter((w) => w.personId === member.personId) : [];
  return (
    <li className={`ct-slot${member ? "" : " empty"}${source === "manager" || source === "next" ? " changed" : ""}`} aria-label={`${role}: ${member ? member.name : "unfilled"}`}>
      <div className="ct-slot-h">
        <span className="eyebrow">{role}</span>
        {source !== "empty" && <span className={`ct-src ${source}`}>{SOURCE_LABEL[source]}</span>}
      </div>
      {member ? (
        <>
          <div className="ct-person">
            <span className={`avatar${member.hidden ? " star" : ""}`} aria-hidden="true">{member.hidden ? <Icon name="star" /> : <Icon name="user" />}</span>
            <span className="ct-who"><b>{member.name}</b><span className="muted small">{member.title} · {member.department}</span></span>
            <span className={`ct-score num${member.score < (fit?.threshold ?? 0.7) ? " low" : ""}`} aria-label={`Individual match ${pct(member.score)}`}>{pct(member.score)}</span>
          </div>
          <dl className="ct-mini">
            {BREAKDOWN.map(([k, label]) => (
              <div key={k}><dt>{label}</dt><dd><span className="bar"><i style={{ width: `${Math.round(member.breakdown[k] * 100)}%` }} /></span><b className="num">{Math.round(member.breakdown[k] * 100)}</b></dd></div>
            ))}
          </dl>
          <div className="chips">
            {member.hidden && <span className="chip chip-inferred"><Icon name="spark" />Hidden talent</span>}
            <span className="chip">{member.availabilityPct}% available</span>
            {brings.length > 0 && <span className="chip chip-brings" title="Covered skills this person holds best on the team">Brings {brings.join(", ")}</span>}
            {mates.length > 0 && <span className="chip" title={mates.flatMap((p) => p.projects).join("; ")}>Worked with {mates.map((p) => names.get(p.a === member.personId ? p.b : p.a)).join(", ")}</span>}
          </div>
          {warn.map((w) => <p key={w.text} className="ct-warn small"><Icon name="alert" />{w.text}</p>)}
        </>
      ) : (
        <div className="ct-empty">
          <p className="small">Unfilled. Needs {skills.join(", ")}.</p>
          <p className="muted small">The best internal match is below the fill threshold. Pick someone to reskill, or leave it open to source externally.</p>
        </div>
      )}
      {picking ? children : (
        <div className="ct-actions">
          <button className="btn small" onClick={onNext} disabled={busy}>{busy ? <span className="spinner" aria-hidden="true" /> : <Icon name="spark" />}{member ? "AI: next best" : "AI: best available"}</button>
          <button className="btn small" onClick={onPick}><Icon name="search" />Choose person</button>
          {member && <button className="btn btn-ghost small" onClick={onClear} aria-label={`Leave ${role} unfilled`}><Icon name="x" />Leave open</button>}
          {canRevert && <button className="btn btn-ghost small" onClick={onRevert}><Icon name="reset" />Undo</button>}
        </div>
      )}
    </li>
  );
}

export default function ChallengeTeam({ r, draft, onDraft, onClose, onActivate, onPreview }: {
  r: AskResponse; draft: TeamDraft; onDraft: (d: TeamDraft) => void; onClose: () => void;
  onActivate: (members: Candidate[], value: ValueEstimate, adjusted: boolean, threshold: number) => Promise<boolean>; onPreview: (personIds: string[]) => void;
}) {
  const base = useRef(initialDraft(r)).current;
  const [evaln, setEval] = useState<TeamEvaluation | null>(null);
  const [aiScore, setAiScore] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const [busySlot, setBusySlot] = useState<number | null>(null);
  const [picking, setPicking] = useState<number | null>(null);
  const [activating, setActivating] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<Element | null>(null);

  // the AI proposal's score, once, for the delta
  useEffect(() => {
    post<TeamEvaluation>({ mode: "evaluate", requirements: r.requirements, personIds: base.ids, hasOpportunity: !!r.opportunityId })
      .then((e) => setAiScore(e.fit.score)).catch(() => setAiScore(null));
  }, [r, base]);

  useEffect(() => {
    let live = true;
    post<TeamEvaluation>({ mode: "evaluate", requirements: r.requirements, personIds: draft.ids, hasOpportunity: !!r.opportunityId })
      .then((e) => { if (live) { setEval(e); setErr(""); } }).catch((e) => live && setErr((e as Error).message));
    onPreview(draft.ids.filter((x): x is string => !!x));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.ids, r]);

  // focus in on open, back to the trigger on close; Escape closes; Tab stays inside
  useEffect(() => {
    returnFocus.current = document.activeElement;
    dialogRef.current?.querySelector<HTMLElement>("h2")?.focus();
    return () => { (returnFocus.current as HTMLElement | null)?.focus?.(); };
  }, []);
  const onKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key !== "Tab" || !dialogRef.current) return;
    const f = [...dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), input, [tabindex='0'], a[href]")];
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  }, [onClose]);

  function setSlot(i: number, id: string | null, source: SlotSource, passed?: string[]) {
    const ids = [...draft.ids]; ids[i] = id;
    const sources = [...draft.sources]; sources[i] = source;
    const p = draft.passed.map((x) => [...x]); if (passed) p[i] = passed;
    onDraft({ ids, sources, passed: p });
  }

  async function next(i: number) {
    setBusySlot(i); setErr("");
    const cur = draft.ids[i];
    const passed = cur ? [...draft.passed[i], cur] : draft.passed[i];
    try {
      const c = await post<Candidate>({ mode: "next", requirements: r.requirements, personIds: draft.ids.map((x, k) => (k === i ? null : x)), slot: i, exclude: passed });
      setSlot(i, c.personId, "next", passed);
    } catch (e) { setErr((e as Error).message); } finally { setBusySlot(null); }
  }

  const fit = evaln?.fit ?? null;
  const members = evaln ? evaln.slots.filter((c): c is Candidate => !!c) : [];
  const names = new Map(members.map((c) => [c.personId, c.name]));
  const value = evaln?.value ?? r.value;
  const changed = draft.ids.some((id, i) => id !== base.ids[i]);
  const delta = fit && aiScore !== null ? Math.round(fit.score * 100) - Math.round(aiScore * 100) : null;

  async function activate() {
    setActivating(true);
    const ok = await onActivate(members, value, changed, fit?.threshold ?? 0.7);
    setActivating(false);
    if (ok) onClose();
  }

  return (
    <div className="ct-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ct-dialog panel" role="dialog" aria-modal="true" aria-labelledby="ct-title" ref={dialogRef} onKeyDown={onKey}>
        <header className="ct-head">
          <div>
            <div className="eyebrow">Challenge the team</div>
            <h2 id="ct-title" tabIndex={-1}>{r.opportunityTitle}</h2>
            <p className="muted small">Swap anyone: let AI offer the next best match, or name a person. The team score updates as you go.</p>
          </div>
          <button className="btn btn-ghost icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </header>

        <div className="ct-body">
          {err && <p className="ct-error" role="alert"><Icon name="alert" />{err}</p>}
          <section className="ct-top" aria-label="Team match">
            {fit ? <Gauge score={fit.score} delta={delta} /> : <div className="skeleton ct-gauge" />}
            <div className="ct-parts">
              {PARTS.map((p) => (
                <div key={p.key} className="ct-part" title={p.help}>
                  <div className="row-between"><span>{p.label} <span className="muted small">· {fit ? Math.round(fit.weights[p.key] * 100) : 0}% of score</span></span><b className="num">{fit ? pct(fit.parts[p.key]) : "…"}</b></div>
                  <span className="bar"><i style={{ width: `${fit ? Math.round(fit.parts[p.key] * 100) : 0}%` }} /></span>
                  <span className="muted small">{p.help}</span>
                </div>
              ))}
            </div>
            <div className="ct-flags" aria-live="polite">
              <div className="row-between"><span className="eyebrow">Watch-outs</span><span className="muted small num">{evaln ? `${members.length} of ${r.requirements.length} roles filled` : ""}</span></div>
              {fit && !fit.warnings.filter((w) => !w.personId).length && !fit.notes.length && <p className="small ct-ok"><Icon name="check" />Every role filled and every required skill covered.</p>}
              {fit?.warnings.filter((w) => !w.personId).map((w) => <p key={w.text} className="ct-warn small"><Icon name="alert" />{w.text}</p>)}
              {fit?.notes.map((n) => <p key={n} className="small muted ct-note"><Icon name="user" />{n}</p>)}
            </div>
          </section>

          <h3 className="section-h">The team{evaln ? ` (${members.length} of ${r.requirements.length} roles)` : ""}</h3>
          <ul className="ct-slots">
            {r.requirements.map((req, i) => !evaln ? (
              <li key={req.role} className="ct-slot" aria-busy="true">
                <div className="ct-slot-h"><span className="eyebrow">{req.role}</span></div>
                <div className="skeleton" style={{ height: 40 }} /><div className="skeleton" style={{ height: 28 }} />
                <span className="sr-only">Scoring this role</span>
              </li>
            ) : (
              <SlotCard key={req.role} slot={i} role={req.role} skills={req.must.map((s) => fit?.skills.find((x) => x.skillId === s)?.skill ?? s)}
                member={evaln?.slots[i] ?? null} source={draft.sources[i]} fit={fit} names={names} busy={busySlot === i} picking={picking === i}
                onNext={() => next(i)} onPick={() => setPicking(i)} onClear={() => setSlot(i, null, "empty")}
                onRevert={() => setSlot(i, base.ids[i], base.sources[i], [])} canRevert={draft.ids[i] !== base.ids[i]}>
                <PersonPicker slot={i} role={req.role} requirements={r.requirements} ids={draft.ids}
                  onPick={(c) => { setSlot(i, c.personId, "manager"); setPicking(null); }} onCancel={() => setPicking(null)} />
              </SlotCard>
            ))}
          </ul>

          {fit && members.length > 0 && (
            <>
              <h3 className="section-h">How they match together</h3>
              <p className="muted small">Each required skill against each member. The strongest holder is highlighted; a row with nobody at 60% or more is a gap.</p>
              <div className="table-wrap ct-matrix-wrap" role="region" aria-label="Skill coverage by member" tabIndex={0}>
                <table className="ct-matrix">
                  <thead><tr><th scope="col">Skill</th>{members.map((c) => <th key={c.personId} scope="col" title={c.name}>{c.name.split(" ")[0]}</th>)}<th scope="col">Best</th></tr></thead>
                  <tbody>
                    {fit.skills.map((s) => (
                      <tr key={s.skillId} className={s.best < 0.6 ? "uncovered" : ""}>
                        <th scope="row">{s.skill}</th>
                        {members.map((c) => {
                          const v = s.byPerson[c.personId] ?? 0;
                          return <td key={c.personId} className={`num${v === s.best && v >= 0.6 ? " best" : ""}`} style={{ ["--v" as string]: v }}>{v ? Math.round(v * 100) : "·"}</td>;
                        })}
                        <td className="num"><b>{Math.round(s.best * 100)}</b></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="small muted ct-pairs">{fit.pairs.length
                ? <>Worked together before: {fit.pairs.map((p) => `${names.get(p.a)} and ${names.get(p.b)} (${p.projects[0]})`).join("; ")}.</>
                : "No two members have shared a project yet."}</p>
            </>
          )}
        </div>

        <footer className="ct-foot">
          <div className="ct-value">
            <span><span className="eyebrow">Cost avoided</span><b className="num">{money(value.costAvoided)}</b></span>
            <span><span className="eyebrow">Productivity</span><b className="num">{money(value.productivity)}</b></span>
            <span><span className="eyebrow">Revenue potential</span><b className="num">{value.revenuePotential ? money(value.revenuePotential) : "None"}</b></span>
          </div>
          <div className="ct-buttons">
            {changed && <button className="btn btn-ghost" onClick={() => onDraft(base)}><Icon name="reset" />Reset to AI proposal</button>}
            <button className="btn btn-primary" onClick={activate} disabled={activating || !members.length || !evaln}>
              {activating ? <span className="spinner" aria-hidden="true" /> : <Icon name="zap" />} Activate Team{members.length ? ` (${members.length})` : ""}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
