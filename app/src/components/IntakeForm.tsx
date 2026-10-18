"use client";
// Shared intake for the "Act" panels: pasted text and/or a photo of the report (PNG, JPEG or WebP, 4 MB), read by Gemini.
import { useId, useRef, useState } from "react";
import { Icon } from "./Icon";

export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const TYPES = ["image/png", "image/jpeg", "image/webp"];

export interface IntakeValue { text: string; file: File | null; org: string }

export function IntakeForm({ label, placeholder, submitLabel, busy, withOrg, onSubmit, onSample, sampleLabel }: {
  label: string; placeholder: string; submitLabel: string; busy: boolean; withOrg?: boolean;
  onSubmit: (v: IntakeValue) => void; onSample?: () => void; sampleLabel?: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [org, setOrg] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [err, setErr] = useState("");

  function pick(f: File | undefined | null) {
    setErr("");
    if (!f) return;
    if (!TYPES.includes(f.type)) { setErr("Use a PNG, JPEG or WebP photo."); return; }
    if (f.size > MAX_PHOTO_BYTES) { setErr("The photo is over 4 MB."); return; }
    setFile(f);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() && !file) { setErr("Paste the text or add a photo."); return; }
    onSubmit({ text: text.trim(), file, org: org.trim() });
  }

  return (
    <form className="intake" onSubmit={submit} aria-busy={busy}>
      {withOrg && (
        <label className="intake-field">
          <span className="eyebrow">Organisation</span>
          <input className="intake-input" value={org} onChange={(e) => setOrg(e.target.value)} placeholder="For example: Outback Growers Co-op" maxLength={120} disabled={busy} />
        </label>
      )}
      <label className="intake-field" htmlFor={`${id}-t`}><span className="eyebrow">{label}</span></label>
      <textarea id={`${id}-t`} className="intake-input intake-text" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} maxLength={6000} disabled={busy} />
      <div className={`intake-drop ${drag ? "over" : ""}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}>
        <Icon name="upload" />
        {file ? (
          <span className="small">{file.name} ({Math.max(1, Math.round(file.size / 1024))} KB) <button type="button" className="link-btn" onClick={() => setFile(null)} disabled={busy}>Remove</button></span>
        ) : (
          <span className="small muted">Drop a photo of the report, or <label htmlFor={`${id}-f`} className="link-btn">choose one</label> (PNG, JPEG or WebP, 4 MB)</span>
        )}
        <input ref={input} id={`${id}-f`} type="file" accept={TYPES.join(",")} className="sr-only" aria-label="Choose a photo" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      {err && <p className="intake-err small" role="alert">{err}</p>}
      <div className="intake-actions">
        <button type="submit" className="btn btn-primary small" disabled={busy}><Icon name="zap" />{busy ? "Reading..." : submitLabel}</button>
        {onSample && <button type="button" className="btn small" onClick={onSample} disabled={busy}><Icon name="doc" />{sampleLabel ?? "Use the sample"}</button>}
      </div>
    </form>
  );
}

/** Multipart body for the intake routes. */
export function intakeForm(v: IntakeValue): FormData {
  const f = new FormData();
  f.set("text", v.text);
  if (v.org) f.set("org", v.org);
  if (v.file) f.set("file", v.file);
  return f;
}
