"use client";
// My Constellation tab: the person's own graph with type filters, an outer-ring toggle, a detail card for the
// selected node, and the same connections as a grouped list (the text alternative to the graph).
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "../Icon";
import { ShapeGlyph } from "../ShapeGlyph";
import { SHAPES, type EntityType } from "../../lib/shapes";
import type { Constellation, CNode } from "../../lib/me/constellation";
import { Card, SectionHead, Toggle, useProfile } from "./kit";

const ConstellationCanvas = dynamic(() => import("./ConstellationCanvas"), { ssr: false, loading: () => <div className="skeleton pf-cons-skel" /> });

const ORDER: CNode["type"][] = ["skill", "project", "person", "system", "incident", "knowledge", "org", "problem", "department", "division"];
const LABEL: Record<string, string> = {
  skill: "Skills", project: "Projects", person: "People", system: "Systems", incident: "Incidents", knowledge: "Knowledge",
  org: "Customers and partners", problem: "Problem types", department: "Department", division: "Division",
};
const TAB_LABEL: Record<string, string> = { skills: "Skills", projects: "My Projects", connections: "Connections", impact: "My impact", evidence: "Evidence" };

export function ConstellationTab() {
  const { b, userId, go } = useProfile();
  const [c, setC] = useState<Constellation | null>(null);
  const [err, setErr] = useState("");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [outer, setOuter] = useState(true);
  const [sel, setSel] = useState<string | null>(null);
  const version = b.history[0]?.at ?? "";

  useEffect(() => {
    let live = true;
    setErr("");
    fetch("/api/me/constellation", { headers: { "x-demo-user": userId } }).then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Could not load your constellation.");
      if (live) setC(j);
    }).catch((e) => live && setErr((e as Error).message));
    return () => { live = false; };
  }, [userId, version]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of c?.nodes ?? []) if (n.ring > 0 && (outer || n.ring === 1)) m.set(n.type, (m.get(n.type) ?? 0) + 1);
    return ORDER.filter((t) => m.has(t)).map((t) => ({ t, n: m.get(t)! }));
  }, [c, outer]);
  const node = c?.nodes.find((n) => n.id === sel) ?? null;
  const links = node && c ? c.edges.filter((e) => e.source === node.id || e.target === node.id).map((e) => {
    const other = c.nodes.find((n) => n.id === (e.source === node.id ? e.target : e.source));
    return { e, other };
  }) : [];
  const toggle = (t: string) => setHidden((h) => { const n = new Set(h); if (n.has(t)) n.delete(t); else n.add(t); return n; });
  const ring1 = c?.nodes.filter((n) => n.ring === 1).length ?? 0;
  const ring2 = c?.nodes.filter((n) => n.ring === 2).length ?? 0;
  const profileOnly = c?.nodes.filter((n) => n.profileOnly).length ?? 0;

  return (
    <>
      <SectionHead title="My Constellation" desc="Your own part of the capability graph: everything you are linked to, and what that work touches. Click any star to see how it connects to you." />
      {err && <p className="pf-error" role="alert"><Icon name="alert" />{err}</p>}
      <Card>
        <div className="pf-cons-tools">
          <div className="pf-cons-filters" role="group" aria-label="Show or hide node types">
            {counts.map(({ t, n }) => (
              <button key={t} type="button" className="pf-cons-chip" aria-pressed={!hidden.has(t)} onClick={() => toggle(t)}>
                <ShapeGlyph type={t as EntityType} size={13} />{LABEL[t]}<span className="num">{n}</span>
              </button>
            ))}
          </div>
          <Toggle label="Outer ring" hint="Customers, problem types and systems your work touches" checked={outer} onChange={setOuter} />
        </div>
        <div className="pf-cons-grid">
          {c ? <ConstellationCanvas data={c} hidden={hidden} showOuter={outer} selected={sel} onSelect={setSel} /> : !err && <div className="skeleton pf-cons-skel" />}
          <aside className="pf-cons-side" aria-live="polite">
            {node ? (
              <div className="pf-cons-detail">
                <div className="pf-item-top"><ShapeGlyph type={node.type as EntityType} size={18} color={node.ring === 0 ? "#38bdf8" : undefined} /><b>{node.label}</b></div>
                <span className="small muted">{SHAPES[node.type as EntityType]?.label ?? node.type}{node.ring === 2 ? " · outer ring" : node.ring === 1 ? " · linked to you" : ""}</span>
                {node.profileOnly && <span className="pf-badge pf-ai"><Icon name="user" />From your profile, not yet in the graph</span>}
                {node.private && <span className="pf-badge"><Icon name="eyeoff" />Private: opted out of discovery</span>}
                {node.detail.filter(Boolean).length > 0 && <ul className="pf-cons-facts">{node.detail.filter(Boolean).map((d, i) => <li key={i}>{d}</li>)}</ul>}
                {links.length > 0 && (
                  <>
                    <h4>Links</h4>
                    <ul className="pf-cons-links">{links.slice(0, 12).map(({ e, other }) => (
                      <li key={e.id}><span className={`pf-line ${e.style}`} aria-hidden="true" />
                        <span><span className="small">{e.rel}</span>{other && other.id !== b.me.id && <> · <button type="button" className="link-btn small" onClick={() => setSel(other.id)}>{other.label}</button></>}</span></li>))}
                      {links.length > 12 && <li className="small muted">and {links.length - 12} more</li>}</ul>
                  </>
                )}
                <div className="pf-row">
                  {node.tab && node.ring > 0 && <button type="button" className="btn small" onClick={() => go(node.tab!)}><Icon name="arrow" />Open {TAB_LABEL[node.tab] ?? node.tab}</button>}
                  <button type="button" className="btn btn-ghost small" onClick={() => setSel(null)}>Clear</button>
                </div>
              </div>
            ) : (
              <div className="pf-cons-detail">
                <b>You are at the centre</b>
                <p className="small">{ring1} direct connections{outer ? `, ${ring2} more one step out` : ""}.</p>
                {profileOnly > 0 && <p className="small">{profileOnly} come from your profile and join the graph once confirmed or processed.</p>}
                <ul className="pf-cons-legend">
                  <li><span className="pf-line solid" aria-hidden="true" />From records</li>
                  <li><span className="pf-line inferred" aria-hidden="true" />AI-suggested skill</li>
                  <li><span className="pf-line profile" aria-hidden="true" />From your profile</li>
                </ul>
                <p className="small muted">Scroll or pinch to zoom, drag to move. {c?.updatedAt ? `Graph updated ${c.updatedAt.slice(0, 16).replace("T", " ")}.` : ""}</p>
              </div>
            )}
          </aside>
        </div>
      </Card>
      {c && (
        <Card>
          <details className="pf-details">
            <summary>All {ring1 + (outer ? ring2 : 0)} connections as a list</summary>
            <div className="pf-cons-list">
              {ORDER.map((t) => {
                const items = c.nodes.filter((n) => n.type === t && n.ring > 0 && (outer || n.ring === 1) && !hidden.has(t));
                if (!items.length) return null;
                return (
                  <section key={t}>
                    <h4><ShapeGlyph type={t as EntityType} size={13} />{LABEL[t]} <span className="pf-count-chip">{items.length}</span></h4>
                    <ul>{items.map((n) => (
                      <li key={n.id}><button type="button" className="link-btn" onClick={() => { setSel(n.id); window.scrollTo({ top: 0, behavior: "smooth" }); }}>{n.label}</button>
                        <span className="small muted"> · {n.rel}{n.ring === 2 ? " (outer ring)" : ""}</span></li>))}</ul>
                  </section>
                );
              })}
            </div>
          </details>
        </Card>
      )}
    </>
  );
}
