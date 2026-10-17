"use client";
// Top-bar indicator: is Gemini connected and live? Green = Gemini on Vertex AI live,
// grey = offline (answers from the golden cache; numbers still come from the engine). Click for details.
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import type { AiStatus as Status } from "../lib/llm";

const LABEL: Record<Status["overall"], string> = { live: "AI live", fallback: "AI fallback", cache: "AI offline" };
const STATE_TEXT: Record<string, string> = { live: "Live", down: "Unreachable", disabled: "Disabled", unconfigured: "Not configured" };
const POLL_MS = 60_000;

export default function AiStatus() {
  const [s, setS] = useState<Status | null>(null);
  const [err, setErr] = useState(false);
  const [checking, setChecking] = useState(false);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);

  const load = useCallback(async (force = false) => {
    setChecking(true);
    try {
      const r = await fetch(`/api/ai-status${force ? "?refresh=1" : ""}`, { cache: "no-store" });
      if (!r.ok) throw new Error();
      setS(await r.json());
      setErr(false);
    } catch {
      setErr(true);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const overall = err ? "cache" : s?.overall;
  const live = s?.providers.find((p) => p.state === "live");
  const label = !s && !err ? "Checking AI" : LABEL[overall ?? "cache"];

  return (
    <div className="ai-status" ref={wrap}>
      <button ref={btn} className={`btn btn-ghost ai-pill ai-${overall ?? "checking"}`} aria-expanded={open} aria-controls="ai-status-panel"
        onClick={() => setOpen(!open)} aria-label={`${label}${live ? `: ${live.label}${live.latencyMs ? `, ${live.latencyMs} ms` : ""}` : ""}. Show AI connection details`}>
        <span className="ai-dot" aria-hidden="true" />
        <span>{label}</span>
      </button>
      <span className="sr-only" aria-live="polite">{s ? label : ""}</span>
      {open && (
        <div id="ai-status-panel" className="ai-panel panel rise" role="region" aria-label="AI connection details">
          <div className="eyebrow">AI connection</div>
          {err && <p className="small" role="alert">Could not reach the SkillBridge server.</p>}
          {s && (
            <>
              <ul className="ai-list">
                {s.providers.map((p) => (
                  <li key={p.id}>
                    <span className={`ai-dot ai-${p.state === "live" ? "live" : p.state === "down" ? "down" : "off"}`} aria-hidden="true" />
                    <span className="ai-name">
                      <b>{p.label}</b>
                      <span className="muted">{p.model}</span>
                      {p.detail && <span className="muted ai-detail">{p.detail}</span>}
                    </span>
                    <span className="num">{STATE_TEXT[p.state]}{p.latencyMs ? ` · ${p.latencyMs} ms` : ""}</span>
                  </li>
                ))}
                <li>
                  <span className="ai-dot ai-off" aria-hidden="true" />
                  <span className="ai-name"><b>Golden cache</b><span className="muted">Answers to scripted questions, used if Gemini is down</span></span>
                  <span className="num">{s.cachedAnswers} saved</span>
                </li>
              </ul>
              <p className="muted small">
                {s.mode === "cache-first" ? "Cache-first mode: scripted questions answer from the cache. " : ""}
                Scores and money figures always come from the engine, never the model. Checked {new Date(s.checkedAt).toLocaleTimeString("en-US")}.
              </p>
            </>
          )}
          <button className="btn small" onClick={() => load(true)} disabled={checking}>
            {checking ? <span className="spinner" aria-hidden="true" /> : <Icon name="reset" />}Check now
          </button>
        </div>
      )}
    </div>
  );
}
