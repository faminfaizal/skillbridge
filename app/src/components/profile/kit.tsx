"use client";
// Shared building blocks for the My Profile tabs: the save context, pickers, the level control, source badges.
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "../Icon";
import { AUDIENCES, LEVELS, type Audience, type ProfileBundle, type TabId } from "../../lib/me/types";

// ---------------------------------------------------------------- context
export interface ProfileCtx {
  b: ProfileBundle;
  userId: string;
  /** Save one change. Resolves true on success; on failure the error shows in the save status and the caller keeps its input. */
  act: (section: string, action: string, payload?: Record<string, unknown>) => Promise<boolean>;
  upload: (file: File, kind: string) => Promise<boolean>;
  /** Hide an item now and remove it after 5 s unless the person presses Undo. */
  removeLater: (key: string, label: string, run: () => Promise<boolean>) => void;
  pending: Set<string>;
  go: (tab: TabId) => void;
  lastError: string;
}
export const Ctx = createContext<ProfileCtx | null>(null);
export function useProfile(): ProfileCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useProfile outside the profile page");
  return c;
}

// ---------------------------------------------------------------- layout pieces
export function SectionHead({ title, desc, section, children }: { title: string; desc: string; section?: string; children?: ReactNode }) {
  return (
    <header className="pf-head">
      <div className="pf-head-text">
        <h2 tabIndex={-1} data-tab-heading>{title}</h2>
        <p className="muted">{desc}</p>
      </div>
      <div className="pf-head-tools">
        {children}
        {section && <AudienceSelect section={section} />}
      </div>
    </header>
  );
}

export function AudienceSelect({ section }: { section: string }) {
  const { b, act } = useProfile();
  const id = useId();
  const value = b.privacy.sections[section] ?? "everyone";
  return (
    <div className="pf-audience">
      <label htmlFor={id}><Icon name="shield" />Who can see this</label>
      <select id={id} value={value} onChange={(e) => act("privacy", "audience", { section, audience: e.target.value as Audience })}>
        {AUDIENCES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
      </select>
    </div>
  );
}

export function Card({ title, children, actions, className = "" }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`pf-card ${className}`}>
      {(title || actions) && <div className="pf-card-h">{title && <h3>{title}</h3>}{actions && <div className="pf-card-actions">{actions}</div>}</div>}
      {children}
    </section>
  );
}

export function Empty({ icon = "spark", title, text, children }: { icon?: string; title: string; text: string; children?: ReactNode }) {
  return (
    <div className="pf-empty">
      <span className="pf-empty-i" aria-hidden="true"><Icon name={icon} /></span>
      <div><b>{title}</b><p className="muted small">{text}</p>{children && <div className="pf-empty-actions">{children}</div>}</div>
    </div>
  );
}

// ---------------------------------------------------------------- badges
const SOURCES: Record<string, { label: string; tone: string; icon: string }> = {
  declared: { label: "From ERA", tone: "era", icon: "shield" },
  cert: { label: "From certification", tone: "era", icon: "shield" },
  cv: { label: "From your CV", tone: "self", icon: "brief" },
  self: { label: "Self-declared", tone: "self", icon: "user" },
  validated: { label: "Confirmed by manager", tone: "ok", icon: "check" },
  confirmed: { label: "Confirmed AI suggestion", tone: "ok", icon: "check" },
};
export function SourceBadge({ source }: { source: string }) {
  const s = SOURCES[source] ?? { label: source, tone: "self", icon: "user" };
  return <span className={`pf-badge pf-${s.tone}`}><Icon name={s.icon} />{s.label}</span>;
}
export function StatusBadge({ status }: { status: "pending" | "confirmed" | "declined" | string }) {
  if (status === "pending") return <span className="pf-badge pf-wait"><Icon name="clock" />Awaiting confirmation</span>;
  if (status === "confirmed") return <span className="pf-badge pf-ok"><Icon name="check" />Confirmed</span>;
  if (status === "declined") return <span className="pf-badge pf-bad"><Icon name="alert" />Declined</span>;
  return <span className="pf-badge">{status}</span>;
}
export const Locked = ({ label = "From ERA" }: { label?: string }) => <span className="pf-badge pf-era"><Icon name="shield" />{label}</span>;

// ---------------------------------------------------------------- inputs
/** Level 1 to 5 as labelled buttons (a radio group with arrow-key support). */
export function LevelPicker({ value, onChange, label = "Level", compact = false }: { value: number; onChange: (n: number) => void; label?: string; compact?: boolean }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const key = (e: React.KeyboardEvent, n: number) => {
    const next = e.key === "ArrowRight" || e.key === "ArrowDown" ? Math.min(5, n + 1) : e.key === "ArrowLeft" || e.key === "ArrowUp" ? Math.max(1, n - 1) : 0;
    if (!next) return;
    e.preventDefault();
    onChange(next);
    refs.current[next - 1]?.focus();
  };
  const cur = LEVELS.find((l) => l.n === value);
  return (
    <div className={`pf-level ${compact ? "compact" : ""}`}>
      <div role="radiogroup" aria-label={label} className="pf-level-row">
        {LEVELS.map((l) => (
          <button key={l.n} ref={(el) => { refs.current[l.n - 1] = el; }} type="button" role="radio" aria-checked={value === l.n}
            tabIndex={value === l.n || (!value && l.n === 1) ? 0 : -1} title={l.hint} onClick={() => onChange(l.n)} onKeyDown={(e) => key(e, l.n)}>
            <span className="n">{l.n}</span>{!compact && <span className="t">{l.label}</span>}
          </button>
        ))}
      </div>
      {!compact && <p className="pf-level-hint small muted" aria-live="polite">{cur ? `${cur.label}: ${cur.hint}` : "Choose how well you know it"}</p>}
    </div>
  );
}

export interface Option { id: string; label: string; sub?: string }

/** Search-as-you-type picker (ARIA combobox). Optional "create" row when nothing matches. */
export function Combobox({ label, options, onPick, placeholder, exclude, createLabel, onCreate, autoFocus, hideLabel }: {
  label: string; options: Option[]; onPick: (o: Option) => void; placeholder?: string; exclude?: Set<string>;
  createLabel?: (q: string) => string; onCreate?: (q: string) => void; autoFocus?: boolean; hideLabel?: boolean;
}) {
  const id = useId();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    const pool = options.filter((o) => !exclude?.has(o.id));
    if (!t) return pool.slice(0, 8);
    const starts = pool.filter((o) => o.label.toLowerCase().startsWith(t));
    const rest = pool.filter((o) => !o.label.toLowerCase().startsWith(t) && `${o.label} ${o.sub ?? ""}`.toLowerCase().includes(t));
    return [...starts, ...rest].slice(0, 8);
  }, [q, options, exclude]);
  const canCreate = !!onCreate && q.trim().length >= 2 && !matches.some((m) => m.label.toLowerCase() === q.trim().toLowerCase());
  const total = matches.length + (canCreate ? 1 : 0);
  const choose = (i: number) => {
    if (i < matches.length) onPick(matches[i]);
    else if (canCreate) onCreate!(q.trim());
    setQ(""); setOpen(false); setHi(0);
  };
  return (
    <div className="pf-combo">
      <label htmlFor={id} className={hideLabel ? "sr-only" : ""}>{label}</label>
      <div className="pf-combo-in">
        <Icon name="search" />
        <input id={id} role="combobox" aria-expanded={open && total > 0} aria-controls={`${id}-list`} aria-autocomplete="list"
          aria-activedescendant={open && total ? `${id}-o${hi}` : undefined} value={q} placeholder={placeholder} autoComplete="off" autoFocus={autoFocus}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi((h) => Math.min(total - 1, h + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
            else if (e.key === "Enter" && open && total) { e.preventDefault(); choose(hi); }
            else if (e.key === "Escape") { setOpen(false); setQ(""); }
          }} />
      </div>
      {open && total > 0 && (
        <ul id={`${id}-list`} role="listbox" className="pf-combo-list">
          {matches.map((o, i) => (
            <li key={o.id} id={`${id}-o${i}`} role="option" aria-selected={i === hi} onMouseDown={(e) => { e.preventDefault(); choose(i); }} onMouseEnter={() => setHi(i)}>
              <span>{o.label}</span>{o.sub && <span className="small muted">{o.sub}</span>}
            </li>
          ))}
          {canCreate && (
            <li id={`${id}-o${matches.length}`} role="option" aria-selected={hi === matches.length} className="pf-create"
              onMouseDown={(e) => { e.preventDefault(); choose(matches.length); }}><Icon name="spark" />{createLabel ? createLabel(q.trim()) : `Add "${q.trim()}"`}</li>
          )}
        </ul>
      )}
    </div>
  );
}

/** Text field that saves when the person leaves it (Enter on one line, Escape reverts). */
export function InlineText({ label, value, onCommit, multiline, maxLength = 200, placeholder, hint }: {
  label: string; value: string; onCommit: (v: string) => Promise<boolean> | void; multiline?: boolean; maxLength?: number; placeholder?: string; hint?: string;
}) {
  const id = useId();
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => { if (v.trim() !== value.trim()) void onCommit(v.trim()); };
  const common = {
    id, value: v, maxLength, placeholder, "aria-describedby": hint ? `${id}-h` : undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Escape") { setV(value); (e.target as HTMLElement).blur(); }
      if (e.key === "Enter" && !multiline) { e.preventDefault(); (e.target as HTMLElement).blur(); }
    },
  };
  return (
    <div className="pf-field">
      <label htmlFor={id}>{label}</label>
      {multiline ? <textarea rows={4} {...common} /> : <input {...common} />}
      {hint && <p id={`${id}-h`} className="small muted">{hint}{multiline && <span className="pf-count"> · {v.length}/{maxLength}</span>}</p>}
    </div>
  );
}

/** Chips with remove, plus a box to add more (Enter or comma). Suggestions appear as one-tap chips. */
export function TagInput({ label, values, onChange, suggestions = [], placeholder }: { label: string; values: string[]; onChange: (v: string[]) => void; suggestions?: string[]; placeholder?: string }) {
  const id = useId();
  const [q, setQ] = useState("");
  const add = (t: string) => { const s = t.trim(); if (s && !values.some((v) => v.toLowerCase() === s.toLowerCase())) onChange([...values, s]); setQ(""); };
  const left = suggestions.filter((s) => !values.some((v) => v.toLowerCase() === s.toLowerCase())).slice(0, 8);
  return (
    <div className="pf-field">
      <label htmlFor={id}>{label}</label>
      <div className="pf-tags">
        {values.map((v) => (
          <span key={v} className="pf-tag">{v}<button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}><Icon name="x" /></button></span>
        ))}
        <input id={id} value={q} placeholder={placeholder} onChange={(e) => setQ(e.target.value.replace(",", ""))}
          onKeyDown={(e) => { if ((e.key === "Enter" || e.key === ",") && q.trim()) { e.preventDefault(); add(q); } if (e.key === "Backspace" && !q && values.length) onChange(values.slice(0, -1)); }}
          onBlur={() => q.trim() && add(q)} />
      </div>
      {left.length > 0 && <div className="pf-suggest" aria-label="Suggestions">{left.map((s) => <button type="button" key={s} className="pf-chip-add" onClick={() => add(s)}><Icon name="spark" />{s}</button>)}</div>}
    </div>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const id = useId();
  return (
    <div className="pf-toggle-row">
      <button id={id} type="button" role="switch" aria-checked={checked} className="pf-switch" onClick={() => onChange(!checked)}><span /></button>
      <label htmlFor={id}><b>{label}</b>{hint && <span className="small muted">{hint}</span>}</label>
    </div>
  );
}

/** Two-step delete inline: first press asks, second confirms. Removal itself is deferred with Undo. */
export function RemoveButton({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  const [ask, setAsk] = useState(false);
  useEffect(() => { if (!ask) return; const t = setTimeout(() => setAsk(false), 4000); return () => clearTimeout(t); }, [ask]);
  return ask
    ? <button type="button" className="btn btn-danger small" onClick={() => { setAsk(false); onConfirm(); }}>Remove?</button>
    : <button type="button" className="btn btn-ghost pf-icon-btn" aria-label={`Remove ${label}`} title="Remove" onClick={() => setAsk(true)}><Icon name="x" /></button>;
}

export function FieldError({ id, text }: { id: string; text: string }) {
  return text ? <p id={id} className="pf-error" role="alert"><Icon name="alert" />{text}</p> : null;
}

export const fmtMonth = (m: string | null) => {
  if (!m) return "now";
  const [y, mo] = m.split("-");
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(mo) - 1] ?? ""} ${y}`;
};
export const fmtDate = (d: string) => fmtMonth(d.slice(0, 7));
export const thisMonth = () => new Date().toISOString().slice(0, 7);
export const levelLabel = (n: number) => LEVELS.find((l) => l.n === n)?.label ?? `Level ${n}`;
