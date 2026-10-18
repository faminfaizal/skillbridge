"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Icon } from "../components/Icon";
import { PersonPanel, ResultPanel, RiskPanel, TalentPanel } from "../components/Panels";
import { DiscoverPanel, ExecPanel } from "../components/Intel";
import NodePanel from "../components/NodePanel";
import SearchBox from "../components/SearchBox";
import Legend from "../components/Legend";
import AiStatus from "../components/AiStatus";
import ExploreMenu, { lensLabel, type Lens } from "../components/ExploreMenu";
import SignalPanel from "../components/SignalPanel";
import AgentsPanel, { type AgentsData } from "../components/AgentsPanel";
import AgentsButton from "../components/AgentsButton";
import ConciergePanel from "../components/ConciergePanel";
import ChallengeTeam, { draftChanged, initialDraft, type TeamDraft } from "../components/ChallengeTeam";
import CrisisPanel from "../components/CrisisPanel";
import CommunityPanel from "../components/CommunityPanel";
import type { GraphHighlight } from "../components/actPanels";
import { EMPTY_VIEW, type GraphView } from "../lib/graphView";
import { EXEC_QUESTIONS } from "../lib/questions";
import type { AskResult, Candidate, DiscoveryCard, DiscoveryResult, GraphData, HiddenTalentPerson, SignalItem, SignalKind, SignalResult, ValueEstimate, WhatIfResult } from "../lib/types";

const GraphCanvas = dynamic(() => import("../components/graph/GraphCanvas"), { ssr: false });
const Graph3D = dynamic(() => import("../components/graph/Graph3D"), {
  ssr: false,
  loading: () => <div className="stage-msg" role="status"><span className="spinner" aria-hidden="true" /> Loading 3D view</div>,
});

type ListKind = "answer" | "talent" | "risk" | "discover" | "agents" | "crisis" | "community" | SignalKind;
type Side = { kind: "none" } | { kind: ListKind } | { kind: "person"; id: string } | { kind: "node"; id: string };
const SIGNALS: SignalKind[] = ["bridges", "bottlenecks", "rising", "islands", "forgotten", "ghosts", "inclusion"];
const isSignal = (k: string): k is SignalKind => (SIGNALS as string[]).includes(k);
const ACT = ["crisis", "community"] as const;
const isAct = (k: string): k is "crisis" | "community" => (ACT as readonly string[]).includes(k);
const isList = (k: string): k is ListKind => k === "answer" || k === "talent" || k === "risk" || k === "discover" || k === "agents" || isAct(k) || isSignal(k);
type Opp = { id: string; title: string; demo_query: string | null };
const backLabel = (k: ListKind) => (k === "answer" ? "Back to results" : k === "agents" ? "Back to agents" : `Back to ${lensLabel(k).toLowerCase()}`);
const EXEC_SUGGEST = [EXEC_QUESTIONS.gaps, EXEC_QUESTIONS.external, EXEC_QUESTIONS.redeploy, EXEC_QUESTIONS.invest];

/** One id per browser for Concierge conversation memory (follow-up questions). */
function sessionId(): string {
  try {
    let id = localStorage.getItem("sb-session");
    if (!id) { id = crypto.randomUUID(); localStorage.setItem("sb-session", id); }
    return id;
  } catch {
    return "";
  }
}
const CONCIERGE_SUGGEST = ["Who is rising fast, and is anything waiting for my approval?", "What happens if Priya Nair leaves?"];

function cardView(c: DiscoveryCard): GraphView {
  const people = c.people.map((p) => p.id);
  return {
    ...EMPTY_VIEW, mode: "answer", nodeIds: c.nodeIds,
    stars: c.type === "hidden_expert" || c.type === "reskill" ? people : [],
    danger: c.type === "risk" ? [c.nodeIds[0], ...people] : [],
  };
}

/** Graph view for a people signal: gold stars for recognition lenses, red rings for risk lenses. */
function signalView(kind: SignalKind, items: SignalItem[]): GraphView {
  const people = items.flatMap((it) => it.people.map((p) => p.id));
  const risk = kind === "bottlenecks" || kind === "islands";
  // overview: just the listed people (and skills); one item: its whole neighbourhood
  const nodeIds = items.length === 1 ? items[0].nodeIds : [...items.map((it) => it.focusId), ...people];
  return {
    ...EMPTY_VIEW, mode: "answer", nodeIds: [...new Set(nodeIds)],
    stars: risk ? [] : people,
    danger: kind === "bottlenecks" ? people : kind === "islands" ? items.map((it) => it.focusId) : [],
  };
}

export default function Home() {
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [graphErr, setGraphErr] = useState("");
  const [query, setQuery] = useState("");
  const [asking, setAsking] = useState(false);
  const [askErr, setAskErr] = useState("");
  const [answer, setAnswer] = useState<AskResult | null>(null);
  const [side, setSide] = useState<Side>({ kind: "none" });
  const [returnTo, setReturnTo] = useState<ListKind | null>(null);
  const [view, setView] = useState<GraphView>(EMPTY_VIEW);
  const [talent, setTalent] = useState<HiddenTalentPerson[] | null>(null);
  const [whatif, setWhatif] = useState<WhatIfResult | null>(null);
  const [disc, setDisc] = useState<DiscoveryResult | null>(null);
  const [discErr, setDiscErr] = useState("");
  const [activeCard, setActiveCard] = useState<string | null>(null);
  const [sig, setSig] = useState<Partial<Record<SignalKind, SignalResult>>>({});
  const [sigErr, setSigErr] = useState("");
  const [activeSig, setActiveSig] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [hiddenTypes, setHiddenTypes] = useState<string[]>([]);   // legend switches, all on by default
  const toggleType = useCallback((t: string) => setHiddenTypes((h) => (h.includes(t) ? h.filter((x) => x !== t) : [...h, t])), []);
  const [challenge, setChallenge] = useState(false);
  const [teamDraft, setTeamDraft] = useState<TeamDraft | null>(null);
  const [activated, setActivated] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [dim, setDim] = useState<"2d" | "3d">("2d");
  const [agents, setAgents] = useState<AgentsData | null>(null);
  const [agentsErr, setAgentsErr] = useState("");
  const [simulating, setSimulating] = useState<string | null>(null);
  const [deciding, setDeciding] = useState(false);
  const graphVersion = useRef<number | null>(null);
  const lastRun = useRef<number>(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const nodeTypes = useMemo(() => new Map(graph?.nodes.map((n) => [n.id, n.type]) ?? []), [graph]);

  useEffect(() => {
    fetch("/api/graph").then((r) => (r.ok ? r.json() : Promise.reject())).then(setGraph).catch(() => setGraphErr("The capability graph is not ready. Run npm run precompute, then reload."));
    fetch("/api/opportunities").then((r) => r.json()).then((o: Opp[]) => setSuggestions(o.map((x) => x.demo_query).filter((q): q is string => !!q).slice(0, 4))).catch(() => {});
  }, []);

  // deep links for the demo: /?q=<request>, /?mode=talent|risk|discover, /?focus=<id>, add view=3d to any
  useEffect(() => {
    if (!graph) return;
    const sp = new URLSearchParams(window.location.search);
    const q = sp.get("q");
    const m = sp.get("mode");
    if (sp.get("view") === "3d") setDim("3d");
    const f = sp.get("focus");
    if (f) focusNode(f);
    else if (q) { setQuery(q); submit(q); }
    else if (m && (m === "talent" || m === "risk" || m === "discover" || isAct(m) || isSignal(m))) setMode(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(""), 4000); return () => clearTimeout(t); } }, [toast]);

  // ---- agents: poll fast while they work or the panel is open, slowly otherwise
  const loadAgents = useCallback(async () => {
    try {
      const r = await fetch("/api/agents", { cache: "no-store" });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error);
      setAgents(body);
      setAgentsErr("");
      // the Connectivity Agent rewrote the graph: reload it and ripple what changed
      if (graphVersion.current !== null && body.graphVersion !== graphVersion.current) {
        const run = (body as AgentsData).runs.find((x) => x.agent === "connectivity" && x.status === "done");
        const g = await fetch("/api/graph", { cache: "no-store" }).then((x) => x.json());
        setGraph(g);
        setDisc(null); setSig({}); setTalent(null);
        if (run && run.id !== lastRun.current) {
          lastRun.current = run.id;
          setView({ ...EMPTY_VIEW, mode: "answer", nodeIds: run.nodeIds, pulse: run.nodeIds });
          setToast(`Connectivity Agent: ${run.summary}`);
        }
      }
      graphVersion.current = body.graphVersion;
    } catch (e) {
      setAgentsErr((e as Error).message || "Agents unavailable.");
    }
  }, []);

  const agentsActive = !!agents && (agents.busy || agents.queued > 0 || !!simulating);
  useEffect(() => {
    loadAgents();
    const ms = agentsActive || side.kind === "agents" ? 1500 : 8000;
    const t = setInterval(() => { if (document.visibilityState === "visible") loadAgents(); }, ms);
    return () => clearInterval(t);
  }, [loadAgents, agentsActive, side.kind]);

  async function simulateData(id: string) {
    setSimulating(id);
    try {
      const r = await fetch("/api/agents/simulate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scenario: id }) });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error);
      setToast(`New records written: ${body.inserted.join(", ")}. Agents are reacting.`);
      await loadAgents();
    } catch (e) {
      setToast(`Could not simulate: ${(e as Error).message}`);
    } finally {
      setSimulating(null);
    }
  }

  async function decideProposal(id: number, decision: "approve" | "dismiss") {
    setDeciding(true);
    try {
      const r = await fetch(`/api/agents/inbox/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error);
      setToast(body.outcome);
      await loadAgents();
    } catch (e) {
      setToast(`Could not record the decision: ${(e as Error).message}`);
    } finally {
      setDeciding(false);
    }
  }

  async function resetAgentDemo() {
    if (!window.confirm("Remove all simulated records, agent proposals and their impact records?")) return;
    setSimulating("reset");
    try {
      const r = await fetch("/api/agents/reset", { method: "POST" });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error);
      setToast(`Agent demo reset (${body.removed} records removed).`);
      await loadAgents();
    } catch (e) {
      setToast(`Could not reset: ${(e as Error).message}`);
    } finally {
      setSimulating(null);
    }
  }

  function openAgents() {
    if (side.kind === "agents") { closeSide(); return; }
    setReturnTo(null);
    setSide({ kind: "agents" });
    setView(EMPTY_VIEW);
    loadAgents();
  }

  const answerView = useCallback((r: AskResult): GraphView => (r.kind === "exec"
    ? { ...EMPTY_VIEW, mode: "answer", nodeIds: r.highlight.nodeIds, edgeIds: r.highlight.edgeIds, danger: r.highlight.danger }
    : r.kind === "concierge"
      ? { ...EMPTY_VIEW, mode: "answer", nodeIds: r.highlight.nodeIds, stars: r.highlight.stars }
      : { mode: "answer", nodeIds: r.highlight.nodeIds, edgeIds: r.highlight.edgeIds, stars: r.team.filter((c) => c.hidden).map((c) => c.personId), danger: [], focusId: null }), []);

  async function submit(q: string) {
    if (!q.trim()) { setAskErr("Type what you are trying to achieve."); inputRef.current?.focus(); return; }
    setQuery(q);
    setAsking(true); setAskErr(""); setActivated(null); setTeamDraft(null); setChallenge(false);
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: q, sessionId: sessionId() || undefined }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Something went wrong.");
      setAnswer(body);
      setSide({ kind: "answer" });
      setReturnTo(null);
      setView(answerView(body));
      panelRef.current?.focus();
    } catch (e) {
      setAskErr((e as Error).message);
    } finally {
      setAsking(false);
    }
  }

  function focusNode(id: string) {
    const type = nodeTypes.get(id);
    if (isList(side.kind)) setReturnTo(side.kind);
    setSide(type === "person" ? { kind: "person", id } : { kind: "node", id });
    setView((v) => ({ ...v, mode: v.mode === "talent" ? "explore" : v.mode, focusId: id, nodeIds: [], edgeIds: [], stars: v.mode === "talent" ? [] : v.stars }));
  }

  function setMode(mode: Lens) {
    setWhatif(null);
    setReturnTo(null);
    if (isSignal(mode)) {
      setSide({ kind: mode });
      setActiveSig(null);
      setSigErr("");
      const cached = sig[mode];
      if (cached) { setView(signalView(mode, cached.items)); return; }
      setView({ ...EMPTY_VIEW, mode: "answer" });
      fetch(`/api/signals/${mode}`).then((r) => (r.ok ? r.json() : r.json().then((b) => Promise.reject(new Error(b.error)))))
        .then((r: SignalResult) => { setSig((s) => ({ ...s, [mode]: r })); setView(signalView(mode, r.items)); })
        .catch((e) => setSigErr((e as Error).message || "Could not load this view."));
      return;
    }
    if (mode === "talent") {
      setSide({ kind: "talent" });
      fetch("/api/hidden-talent").then((r) => r.json()).then((list: HiddenTalentPerson[]) => {
        setTalent(list);
        setView({ ...EMPTY_VIEW, mode: "talent", stars: list.slice(0, 3).map((p) => p.personId) });
      });
    } else if (isAct(mode)) {
      setSide({ kind: mode });
      setView(EMPTY_VIEW);
    } else if (mode === "risk") {
      setSide({ kind: "risk" });
      setView({ ...EMPTY_VIEW, mode: "risk" });
    } else if (mode === "discover") {
      setSide({ kind: "discover" });
      setActiveCard(null);
      const show = (r: DiscoveryResult) => setView({
        ...EMPTY_VIEW, mode: "answer", nodeIds: [...new Set(r.cards.flatMap((c) => c.nodeIds))],
        stars: r.cards.filter((c) => c.type === "hidden_expert").flatMap((c) => c.people.map((p) => p.id)),
        danger: r.cards.filter((c) => c.type === "risk").map((c) => c.nodeIds[0]),
      });
      if (disc) { show(disc); return; }
      setDiscErr("");
      fetch("/api/discover").then((r) => (r.ok ? r.json() : r.json().then((b) => Promise.reject(new Error(b.error)))))
        .then((r: DiscoveryResult) => { setDisc(r); show(r); })
        .catch((e) => setDiscErr((e as Error).message || "Could not scan the graph."));
    } else {
      setSide(answer ? { kind: "answer" } : { kind: "none" });
      setView(answer ? answerView(answer) : EMPTY_VIEW);
    }
  }

  function showCard(c: DiscoveryCard) {
    setActiveCard(c.id);
    setView(cardView(c));
  }

  function goBack() {
    if (!returnTo) return;
    if (returnTo === "answer" && answer) { setSide({ kind: "answer" }); setView(answerView(answer)); }
    else if (returnTo === "discover") { setSide({ kind: "discover" }); const c = disc?.cards.find((x) => x.id === activeCard); setView(c ? cardView(c) : { ...EMPTY_VIEW }); }
    else if (returnTo === "agents") { setSide({ kind: "agents" }); setView(EMPTY_VIEW); }
    else if (returnTo !== "answer") setMode(returnTo);
    setReturnTo(null);
  }

  async function runWhatIf(ids: string[]) {
    const r: WhatIfResult = await fetch("/api/whatif", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ removePersonIds: ids }) }).then((x) => x.json());
    setWhatif(r);
    setView({ ...EMPTY_VIEW, mode: "risk", nodeIds: r.highlight.nodeIds, danger: [...ids, ...r.systems.map((s) => s.id)] });
  }

  /** Activate the team chosen in Challenge Team. An adjusted team replaces the proposal in the results panel. */
  async function activateTeam(members: Candidate[], value: ValueEstimate, adjusted: boolean, threshold: number): Promise<boolean> {
    if (!answer || answer.kind !== "team") return false;
    try {
      const res = await fetch("/api/activate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunityId: answer.opportunityId, title: adjusted ? `${answer.opportunityTitle} (team adjusted)` : answer.opportunityTitle, personIds: members.map((c) => c.personId), value }),
      });
      const rec = await res.json();
      if (!res.ok) throw new Error(rec.error);
      setActivated(rec.id);
      if (adjusted) {
        // a role filled below the fill threshold keeps its gap card: that person still needs the reskilling path
        const next = { ...answer, team: members, value, adjusted: true, coverage: Math.round((members.length / answer.requirements.length) * 100) / 100,
          gaps: answer.gaps.filter((g) => !members.some((c) => c.role === g.role && c.score >= threshold)) };
        setAnswer(next);
        setView(answerView(next));
      }
      setTeamDraft(null);
      setToast(`Team activated: ${members.length} people${adjusted ? " (adjusted by you)" : ""}. Value added to the reinvestment dashboard.`);
      return true;
    } catch (e) {
      setToast(`Could not activate: ${(e as Error).message}`);
      return false;
    }
  }

  /** While challenging, the graph shows the draft team: the people, the opportunity and the skills they were asked for. */
  const previewTeam = useCallback((ids: string[]) => {
    if (!answer || answer.kind !== "team") return;
    const proposed = answer.team.map((c) => c.personId);
    if (ids.length === proposed.length && ids.every((id) => proposed.includes(id))) { setView(answerView(answer)); return; }
    const nodeIds = [...new Set([...(answer.opportunityId ? [answer.opportunityId] : []), ...ids, ...answer.requirements.flatMap((r) => r.must)])];
    const hidden = new Set(answer.team.filter((c) => c.hidden).map((c) => c.personId));
    setView({ ...EMPTY_VIEW, mode: "answer", nodeIds, stars: ids.filter((id) => hidden.has(id)) });
  }, [answer, answerView]);
  function closeSide() {
    setSide({ kind: "none" });
    setView(EMPTY_VIEW);
    setWhatif(null);
    setReturnTo(null);
  }

  const mode: Lens = side.kind === "talent" || side.kind === "risk" || side.kind === "discover" || isAct(side.kind) || isSignal(side.kind) ? side.kind
    : (side.kind === "person" || side.kind === "node") && returnTo && returnTo !== "answer" && returnTo !== "agents" ? returnTo : "explore";
  const wide = (side.kind === "answer" && answer?.kind !== "team") || side.kind === "discover" || side.kind === "agents" || isAct(side.kind);
  const sigKind = isSignal(side.kind) ? side.kind : null;

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="/" aria-label="AI SkillBridge home"><span className="logo" aria-hidden="true"><Icon name="network" /></span><span className="brand-name">AI SkillBridge</span></a>
        <SearchBox data={graph} onPick={focusNode} />
        <nav className="modes" aria-label="Graph lenses"><ExploreMenu value={mode} onChange={setMode} /></nav>
        <div className="seg" role="group" aria-label="View">
          <button className="btn btn-ghost" aria-pressed={dim === "2d"} onClick={() => setDim("2d")}>2D</button>
          <button className="btn btn-ghost" aria-pressed={dim === "3d"} onClick={() => setDim("3d")}>3D Fly</button>
        </div>
        <a className="btn" href="/profile"><Icon name="user" />My profile</a>
        <a className="btn" href="/value"><Icon name="chart" />Value dashboard</a>
        <AgentsButton data={agents} open={side.kind === "agents"} onClick={openAgents} />
        <AiStatus />
      </header>

      <main id="main" className="stage">
        {graph ? (
          dim === "3d" ? (
            <Graph3D data={graph} view={{ ...view, panel: side.kind !== "none" }} hiddenTypes={hiddenTypes} onNodeClick={focusNode}
              onStageClick={() => setView((v) => (v.focusId ? { ...v, focusId: null } : v))}
              onError={(msg) => { setDim("2d"); setToast(`3D view unavailable on this device (${msg}). Showing 2D.`); }} />
          ) : (
            <GraphCanvas data={graph} view={{ ...view, panel: side.kind !== "none" }} hiddenTypes={hiddenTypes} onNodeClick={focusNode} onStageClick={() => setView((v) => (v.focusId ? { ...v, focusId: null } : v))} />
          )
        ) : (
          <div className="stage-msg" role={graphErr ? "alert" : "status"}>{graphErr || <><span className="spinner" aria-hidden="true" /> Loading the capability graph</>}</div>
        )}

        <form className="ask" onSubmit={(e) => { e.preventDefault(); submit(query); }} role="search">
          <label htmlFor="ask-input" className="sr-only">What are you trying to achieve?</label>
          <Icon name="spark" />
          <input id="ask-input" ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="What are you trying to achieve? Or ask a strategic question."
            autoComplete="off" aria-describedby={askErr ? "ask-err" : undefined} maxLength={500} />
          <button className="btn btn-primary" type="submit" disabled={asking}>{asking ? <span className="spinner" aria-hidden="true" /> : <Icon name="arrow" />}Ask AI</button>
          {askErr && <p id="ask-err" className="ask-err" role="alert">{askErr}</p>}
        </form>
        {/* left rail: suggestions on top, legend pinned to the bottom; they share the column and never overlap */}
        <div className="rail">
          {side.kind === "none" && (
            <div className="suggest" aria-label="Example questions">
              {suggestions.length > 0 && <span className="suggest-h">Staff a piece of work</span>}
              {suggestions.map((s) => <button key={s} className="chip chip-btn" onClick={() => submit(s)}>{s}</button>)}
              <span className="suggest-h">Ask as an executive</span>
              {EXEC_SUGGEST.map((s) => <button key={s} className="chip chip-btn chip-exec" onClick={() => submit(s)}><Icon name="brief" />{s}</button>)}
              <span className="suggest-h">Ask the Concierge agent</span>
              {CONCIERGE_SUGGEST.map((s) => <button key={s} className="chip chip-btn chip-concierge" onClick={() => submit(s)}><Icon name="spark" />{s}</button>)}
            </div>
          )}
          <Legend dim={dim} hidden={hiddenTypes} onToggle={toggleType} />
        </div>

        {side.kind !== "none" && (
          <aside className={`side panel${wide ? " side-wide" : ""}`} aria-label="Details" tabIndex={-1} ref={panelRef}>
            <div className="side-top">
              {(side.kind === "person" || side.kind === "node") && returnTo && <button className="btn btn-ghost small" onClick={goBack}><Icon name="back" />{backLabel(returnTo)}</button>}
              <button className="btn btn-ghost icon-btn" onClick={closeSide} aria-label="Close panel"><Icon name="x" /></button>
            </div>
            {side.kind === "answer" && answer?.kind === "team" && <ResultPanel r={answer} onFocus={focusNode} onChallenge={() => { if (!teamDraft) setTeamDraft(initialDraft(answer)); setChallenge(true); }} activated={activated}
              adjusted={!!teamDraft && draftChanged(teamDraft, initialDraft(answer))} />}
            {side.kind === "answer" && answer?.kind === "exec" && <ExecPanel r={answer} onFocus={focusNode} onAsk={submit} />}
            {side.kind === "answer" && answer?.kind === "concierge" && <ConciergePanel r={answer} onFocus={focusNode} onAsk={submit}
              onLens={(l) => setMode(l as Lens)} onAgents={openAgents} />}
            {side.kind === "person" && <PersonPanel id={side.id} onFocus={focusNode} onAsk={submit} />}
            {side.kind === "node" && graph && <NodePanel id={side.id} data={graph} onFocus={focusNode} />}
            {side.kind === "talent" && <TalentPanel people={talent} onFocus={focusNode} />}
            {side.kind === "risk" && <RiskPanel onWhatIf={runWhatIf} result={whatif} onFocus={focusNode} />}
            {sigKind && <SignalPanel result={sig[sigKind] ?? null} error={sigErr} activeId={activeSig} onFocus={focusNode}
              onShow={(it) => { setActiveSig(it.id); setView(signalView(sigKind, [it])); }} />}
            {isAct(side.kind) && (() => {
              const act = {
                onFocus: focusNode, onAgents: openAgents, onToast: setToast, refreshAgents: loadAgents,
                onShow: (v: GraphHighlight) => setView({ ...EMPTY_VIEW, mode: "answer", nodeIds: v.nodeIds, stars: v.stars ?? [], danger: v.danger ?? [], pulse: v.pulse }),
              };
              return side.kind === "crisis" ? <CrisisPanel {...act} /> : <CommunityPanel {...act} />;
            })()}
            {side.kind === "discover" && <DiscoverPanel result={disc} error={discErr} activeId={activeCard} onShow={showCard} onFocus={focusNode} onAsk={submit} />}
            {side.kind === "agents" && <AgentsPanel data={agents} error={agentsErr} simulating={simulating} deciding={deciding}
              onSimulate={simulateData} onDecide={decideProposal} onReset={resetAgentDemo}
              onShow={(ids) => setView({ ...EMPTY_VIEW, mode: "answer", nodeIds: ids, pulse: ids })} />}
          </aside>
        )}

        {challenge && teamDraft && answer?.kind === "team" && (
          <ChallengeTeam r={answer} draft={teamDraft} onDraft={setTeamDraft} onPreview={previewTeam}
            onClose={() => setChallenge(false)} onActivate={activateTeam} />
        )}
        {toast && <div className="toast" role="status" aria-live="polite">{toast}</div>}
      </main>
    </div>
  );
}
