"use client";
// My Profile shell: demo "Viewing as" switcher, left tab menu, save status, Undo toasts, hash routing per tab.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../Icon";
import AiStatus from "../AiStatus";
import type { ProfileBundle, TabId } from "../../lib/me/types";
import { Ctx, type ProfileCtx } from "./kit";
import { AboutTab, CertsTab, DocumentsTab, EvidenceTab, ProjectsTab, SkillsTab } from "./TabsMe";
import { ConnectionsTab, FeedbackTab } from "./TabsPeople";
import { AvailabilityTab, GrowthTab, SuggestionsTab } from "./TabsGrowth";
import { DataTab, ImpactTab, PrivacyTab, TeamTab } from "./TabsControl";
import { ConstellationTab } from "./TabConstellation";

interface DemoUser { id: string; name: string; title: string; why: string }
interface Tab { id: TabId; label: string; icon: string; render: () => JSX.Element | null }

const GROUPS: { label: string; tabs: Tab[] }[] = [
  { label: "Me", tabs: [
    { id: "about", label: "About me", icon: "user", render: () => <AboutTab /> },
    { id: "projects", label: "My Projects", icon: "brief", render: () => <ProjectsTab /> },
    { id: "skills", label: "Skills", icon: "star", render: () => <SkillsTab /> },
    { id: "evidence", label: "Evidence", icon: "link", render: () => <EvidenceTab /> },
    { id: "documents", label: "Documents", icon: "doc", render: () => <DocumentsTab /> },
    { id: "certs", label: "Certifications", icon: "shield", render: () => <CertsTab /> },
  ] },
  { label: "People", tabs: [
    { id: "connections", label: "Connections", icon: "users", render: () => <ConnectionsTab /> },
    { id: "feedback", label: "Peer feedback", icon: "chat", render: () => <FeedbackTab /> },
  ] },
  { label: "Growth", tabs: [
    { id: "suggestions", label: "AI suggestions", icon: "spark", render: () => <SuggestionsTab /> },
    { id: "growth", label: "Interests and growth", icon: "trend", render: () => <GrowthTab /> },
    { id: "availability", label: "Availability", icon: "clock", render: () => <AvailabilityTab /> },
  ] },
  { label: "Control", tabs: [
    { id: "privacy", label: "Privacy", icon: "eye", render: () => <PrivacyTab /> },
    { id: "data", label: "My data", icon: "download", render: () => <DataTab /> },
    { id: "impact", label: "My impact", icon: "coin", render: () => <ImpactTab /> },
    { id: "constellation", label: "My Constellation", icon: "network", render: () => <ConstellationTab /> },
  ] },
];
const TEAM_GROUP = { label: "Manager", tabs: [{ id: "team" as TabId, label: "Team validation", icon: "check", render: () => <TeamTab /> }] };
const ALL_IDS = new Set<string>([...GROUPS.flatMap((g) => g.tabs.map((t) => t.id)), "team"]);
const KEY = "sb-demo-user";

type Status = { kind: "idle" | "saving" | "saved" | "error"; text: string };
interface Toast { key: string; text: string; undo?: () => void }

export default function ProfileApp() {
  const [users, setUsers] = useState<DemoUser[]>([]);
  const [userId, setUserId] = useState("");
  const [b, setB] = useState<ProfileBundle | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [tab, setTab] = useState<TabId>("about");
  const [status, setStatus] = useState<Status>({ kind: "idle", text: "" });
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, { t: ReturnType<typeof setTimeout>; run: () => Promise<boolean> }>());
  const main = useRef<HTMLElement>(null);
  const firstTab = useRef(true);

  // Demo users and the remembered choice (?as= wins, then localStorage)
  useEffect(() => {
    fetch("/api/me/users").then((r) => r.json()).then((u: DemoUser[]) => {
      setUsers(u);
      let pick = new URLSearchParams(location.search).get("as") ?? "";
      if (!u.some((x) => x.id === pick)) { try { pick = localStorage.getItem(KEY) ?? ""; } catch { pick = ""; } }
      setUserId(u.some((x) => x.id === pick) ? pick : u[0]?.id ?? "");
    }).catch(() => setLoadErr("Could not load the demo users. Check that the SkillBridge server is running."));
  }, []);

  const load = useCallback((id: string) => {
    setB(null); setLoadErr("");
    fetch("/api/me", { headers: { "x-demo-user": id } }).then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Could not load the profile.");
      setB(j);
    }).catch((e) => setLoadErr((e as Error).message));
  }, []);
  useEffect(() => {
    if (!userId) return;
    try { localStorage.setItem(KEY, userId); } catch { /* private window */ }
    const u = new URL(location.href); u.searchParams.set("as", userId); history.replaceState(null, "", u);
    load(userId);
  }, [userId, load]);

  // Tab from the URL hash; move focus to the tab heading on change (not on first load)
  useEffect(() => {
    const read = () => { const h = location.hash.slice(1); if (ALL_IDS.has(h)) setTab(h as TabId); };
    read();
    addEventListener("hashchange", read);
    return () => removeEventListener("hashchange", read);
  }, []);
  useEffect(() => {
    if (firstTab.current) { firstTab.current = false; return; }
    requestAnimationFrame(() => (main.current?.querySelector("[data-tab-heading]") as HTMLElement | null)?.focus());
  }, [tab]);
  const go = useCallback((t: TabId) => { location.hash = t; setTab(t); }, []);

  const toast = useCallback((t: Toast, ms = 4500) => {
    setToasts((x) => [...x.filter((y) => y.key !== t.key), t]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.key !== t.key)), ms);
  }, []);

  const act = useCallback<ProfileCtx["act"]>(async (section, action, payload = {}) => {
    setStatus({ kind: "saving", text: "Saving..." });
    try {
      const r = await fetch("/api/me", { method: "POST", headers: { "content-type": "application/json", "x-demo-user": userId }, body: JSON.stringify({ section, action, ...payload }) });
      const j = await r.json();
      if (!r.ok) { setStatus({ kind: "error", text: j.error ?? "Could not save." }); return false; }
      setB(j.bundle);
      setStatus({ kind: "saved", text: j.message });
      return true;
    } catch {
      setStatus({ kind: "error", text: "Could not reach the server. Your change was not saved; try again." });
      return false;
    }
  }, [userId]);

  const upload = useCallback<ProfileCtx["upload"]>(async (file, kind) => {
    if (file.size > 5 * 1024 * 1024) { setStatus({ kind: "error", text: "That file is over 5 MB. Upload a smaller copy." }); return false; }
    setStatus({ kind: "saving", text: `Reading ${file.name}...` });
    const fd = new FormData(); fd.append("file", file); fd.append("kind", kind);
    try {
      const r = await fetch("/api/me/documents", { method: "POST", headers: { "x-demo-user": userId }, body: fd });
      const j = await r.json();
      if (!r.ok) { setStatus({ kind: "error", text: j.error ?? "Upload failed." }); return false; }
      setB(j.bundle);
      setStatus({ kind: "saved", text: j.message });
      return true;
    } catch {
      setStatus({ kind: "error", text: "Could not reach the server. Try the upload again." });
      return false;
    }
  }, [userId]);

  const removeLater = useCallback<ProfileCtx["removeLater"]>((key, label, run) => {
    setPending((p) => new Set(p).add(key));
    const drop = () => setPending((p) => { const n = new Set(p); n.delete(key); return n; });
    const t = setTimeout(async () => { timers.current.delete(key); await run(); drop(); }, 5000);
    timers.current.set(key, { t, run });
    toast({ key, text: label, undo: () => { clearTimeout(t); timers.current.delete(key); drop(); setToasts((x) => x.filter((y) => y.key !== key)); } }, 5000);
  }, [toast]);

  // Switching user flushes pending deletes so they are not lost
  const switchUser = (id: string) => {
    timers.current.forEach(({ t, run }) => { clearTimeout(t); void run(); });
    timers.current.clear();
    setPending(new Set()); setToasts([]); setStatus({ kind: "idle", text: "" });
    setUserId(id);
  };

  const groups = useMemo(() => (b?.team ? [...GROUPS, TEAM_GROUP] : GROUPS), [b?.team]);
  const current = groups.flatMap((g) => g.tabs).find((t) => t.id === tab) ?? GROUPS[0].tabs[0];
  const ctx = useMemo<ProfileCtx | null>(() => (b ? { b, userId, act, upload, removeLater, pending, go, lastError: status.kind === "error" ? status.text : "" } : null),
    [b, userId, act, upload, removeLater, pending, go, status]);
  const who = users.find((u) => u.id === userId);

  return (
    <div className="pf-page">
      <header className="topbar pf-topbar">
        <a className="brand" href="/" aria-label="AI SkillBridge home"><span className="logo" aria-hidden="true"><Icon name="network" /></span><span>AI SkillBridge</span></a>
        <span className="pf-demo" role="note"><Icon name="alert" />Demo sign-in: no authentication yet</span>
        <div className="pf-viewas">
          <label htmlFor="viewas">Viewing as</label>
          <select id="viewas" value={userId} onChange={(e) => switchUser(e.target.value)} disabled={!users.length}>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}, {u.title}</option>)}
          </select>
        </div>
        <a className="btn btn-ghost" href="/"><Icon name="back" />Graph</a>
        <AiStatus />
      </header>

      {loadErr && <div className="pf-load-err" role="alert"><Icon name="alert" />{loadErr} <button type="button" className="btn small" onClick={() => userId && load(userId)}>Try again</button></div>}

      <div className="pf-shell">
        <aside className="pf-side" aria-label="Profile sections">
          {b ? (
            <div className="pf-me">
              <span className="pf-avatar lg" aria-hidden="true">{b.me.name.split(" ").map((x) => x[0]).slice(0, 2).join("")}</span>
              <div><b>{b.me.name}</b><span className="small muted">{b.me.title}</span><span className="small muted">{b.me.department}</span></div>
            </div>
          ) : <div className="skeleton" style={{ height: 64 }} />}
          {b && (
            <div className="pf-complete">
              <div className="pf-row-between"><span className="small">Profile {b.completeness.pct}% complete</span></div>
              <div className="bar" role="progressbar" aria-valuenow={b.completeness.pct} aria-valuemin={0} aria-valuemax={100} aria-label="Profile completeness"><i style={{ width: `${b.completeness.pct}%` }} /></div>
              {b.completeness.next && <button type="button" className="pf-next" onClick={() => go(b.completeness.next!.tab)}><Icon name="arrow" />{b.completeness.next.text}</button>}
            </div>
          )}
          <nav className="pf-nav">
            {groups.map((g) => (
              <div key={g.label} className="pf-nav-group">
                <span className="pf-nav-h">{g.label}</span>
                <ul>{g.tabs.map((t) => {
                  const badge = b?.badges[t.id];
                  return (
                    <li key={t.id}>
                      <a href={`#${t.id}`} aria-current={t.id === current.id ? "page" : undefined} onClick={(e) => { e.preventDefault(); go(t.id); }}>
                        <Icon name={t.icon} /><span>{t.label}</span>
                        {badge?.attention ? <span className="pf-dot" aria-label={`${badge.attention} need attention`}>{badge.attention}</span>
                          : badge?.count ? <span className="pf-num">{badge.count}</span> : null}
                      </a>
                    </li>
                  );
                })}</ul>
              </div>
            ))}
          </nav>
        </aside>

        <main id="main" ref={main} className="pf-main" aria-busy={!b}>
          <div className={`pf-status ${status.kind}`} role="status" aria-live="polite">
            {status.kind === "saving" && <><span className="spinner sm" aria-hidden="true" />{status.text}</>}
            {status.kind === "saved" && <><Icon name="check" />Saved: {status.text}</>}
            {status.kind === "error" && <><Icon name="alert" />{status.text}</>}
            {status.kind === "idle" && who && <span className="muted small">{who.why}</span>}
          </div>
          {ctx ? <Ctx.Provider value={ctx}><div className="pf-tab" key={`${userId}-${current.id}`}>{current.render()}</div></Ctx.Provider>
            : !loadErr && <div className="pf-tab"><div className="skeleton" style={{ height: 40, width: "40%" }} /><div className="skeleton" style={{ height: 220, marginTop: 16 }} /><div className="skeleton" style={{ height: 160, marginTop: 16 }} /></div>}
        </main>
      </div>

      <div className="pf-toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.key} className="pf-toast">{t.text}{t.undo && <button type="button" className="btn small" onClick={t.undo}>Undo</button>}</div>
        ))}
      </div>
    </div>
  );
}
