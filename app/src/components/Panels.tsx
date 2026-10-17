"use client";
// Side-panel views: Ask results, person profile ("dive in"), Hidden Talent, Risk / what-if.
import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { aiLabel, pct, money } from "../lib/format";
import type { AskResponse, Candidate, GrowthPaths, HiddenTalentPerson, ReskillOption, WhatIfResult } from "../lib/types";

// ---------------------------------------------------------------- shared
function ScoreBars({ c }: { c: Candidate }) {
  const rows: [string, number][] = [
    ["Skill alignment", c.breakdown.skill], ["Project experience", c.breakdown.project], ["Domain relevance", c.breakdown.domain],
    ["Recency", c.breakdown.recency], ["Adjacent capability", c.breakdown.adjacent],
  ];
  return (
    <dl className="bars">
      {rows.map(([k, v]) => (
        <div key={k} className="bars-row">
          <dt>{k}</dt>
          <dd><span className="bar"><i style={{ width: `${Math.round(v * 100)}%` }} /></span><b className="num">{Math.round(v * 100)}</b></dd>
        </div>
      ))}
    </dl>
  );
}

function CandidateCard({ c, onFocus, index }: { c: Candidate; onFocus: (id: string) => void; index: number }) {
  const [open, setOpen] = useState(c.hidden);
  return (
    <li className={`cand rise${c.hidden ? " cand-hidden" : ""}`} style={{ animationDelay: `${index * 40}ms` }}>
      <div className="cand-head">
        <button className="cand-name" onClick={() => onFocus(c.personId)} aria-label={`Show ${c.name} in the graph`}>
          <span className="avatar" aria-hidden="true">{c.hidden ? <Icon name="star" /> : <Icon name="user" />}</span>
          <span>
            <strong>{c.name}</strong>
            <span className="muted">{c.role} · {c.department}, {c.location}</span>
          </span>
        </button>
        <span className="score num" aria-label={`Match ${pct(c.score)}`}>{pct(c.score)}</span>
      </div>
      <div className="chips">
        {c.hidden && <span className="chip chip-inferred"><Icon name="spark" />Found via evidence, not job title</span>}
        {c.solvedSimilar && <span className="chip"><Icon name="check" />Solved a similar problem</span>}
        <span className="chip">{c.availabilityPct}% available</span>
      </div>
      <button className="btn btn-ghost why-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        Why this person? <Icon name="arrow" />
      </button>
      {open && (
        <div className="why rise">
          <ScoreBars c={c} />
          <div className="chips">
            {c.capabilities.map((cap) => (
              <span key={cap.skillId} className={`chip${cap.source === "inferred" ? " chip-inferred" : cap.source === "none" ? " chip-gap" : ""}`}
                title={cap.source === "adjacent" ? `Transferable from ${cap.via}` : cap.source}>
                {cap.skill} {Math.round(cap.value * 100)}%{cap.source === "inferred" ? " · inferred" : cap.source === "adjacent" ? ` · via ${cap.via}` : ""}
              </span>
            ))}
          </div>
          {c.evidence.length > 0 && (
            <ul className="evidence">
              {c.evidence.slice(0, 4).map((e) => (
                <li key={e.id}><span className="ev-kind">{e.kind}</span> {e.text} <span className="muted num">{e.date?.slice(0, 7)}</span></li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------- reskilling intelligence (PRD 8.5)
const STEP_ICON: Record<string, string> = { short: "grad", assignment: "zap", mentoring: "user" };

function ReskillCard({ o, onFocus }: { o: ReskillOption; onFocus: (id: string) => void }) {
  return (
    <li className="reskill-card">
      <div className="row-between">
        <span><button className="link-btn" onClick={() => onFocus(o.personId)}>{o.name}</button><span className="muted small"> · {o.title}</span></span>
        <b className="num" aria-label={`${pct(o.readiness)} ready today, ${pct(o.projected)} after the path`}>{pct(o.readiness)} <span className="muted">to</span> {pct(o.projected)}</b>
      </div>
      <dl className="bars">
        {o.skills.map((s) => (
          <div key={s.skillId} className="bars-row">
            <dt title={s.via ? `Today via ${s.via}` : undefined}>{s.skill}</dt>
            <dd>
              <span className="bar bar-grow" aria-hidden="true"><i className="after" style={{ width: `${Math.round(s.after * 100)}%` }} /><i style={{ width: `${Math.round(s.now * 100)}%` }} /></span>
              <b className="num">{Math.round(s.now * 100)}{s.after > s.now ? <span className="muted"> to {Math.round(s.after * 100)}</span> : null}</b>
            </dd>
          </div>
        ))}
      </dl>
      <ol className="path steps" aria-label="Smallest learning path">
        {o.path.map((p) => (
          <li key={p.id} className="chip">
            <Icon name={STEP_ICON[p.kind] ?? "grad"} />
            {p.mentorId ? <>Pair with <button className="link-btn" onClick={() => onFocus(p.mentorId!)}>{p.name.replace(/^Pair with /, "").replace(/ on live .*/, "")}</button> on {p.skill}</> : p.name} · {p.weeks}w
          </li>
        ))}
      </ol>
      <div className="reskill-sum">
        <span><Icon name="clock" /><b className="num">{o.weeks} weeks</b> · {o.costAmt ? money(o.costAmt) : "no course fees"} · ready by {o.readyBy}</span>
        {o.contrast && <span className="muted small">Instead of {o.contrast.name}: {o.contrast.weeks} weeks, {money(o.contrast.costAmt)}</span>}
        <span className="reskill-value"><Icon name="coin" /><b className="num">{money(o.valueAmt)}</b> hiring cost avoided</span>
      </div>
      <details className="small muted">
        <summary>How this is calculated</summary>
        <p>{o.valueBasis}. Each short course adds about 15 points to a skill, mentoring 20 and a stretch assignment 25; the path stops once a skill reaches 80%.</p>
      </details>
    </li>
  );
}

// ---------------------------------------------------------------- results
export function ResultPanel({ r, onFocus, onChallenge, adjusted, activated }: {
  r: AskResponse; onFocus: (id: string) => void; onChallenge: () => void; adjusted: boolean; activated: string | null;
}) {
  const [showAssumptions, setShowAssumptions] = useState(false);
  return (
    <div className="panel-body">
      <div className="eyebrow">{r.opportunityId ? `Matched opportunity ${r.opportunityId}` : "Answer"}</div>
      <h2 className="panel-title">{r.opportunityTitle}</h2>
      <div className="chips">
        <span className="chip">Internal coverage {pct(r.coverage)}</span>
        <span className="chip">{r.team.length} people · {r.gaps.length} gap{r.gaps.length === 1 ? "" : "s"}</span>
        <span className="chip" title="Which AI service answered">AI: {aiLabel(r.provider)}</span>
        {r.adjusted && <span className="chip chip-adjusted"><Icon name="users" />Team adjusted by you</span>}
      </div>
      <p className="narrative">{r.adjusted && <span className="muted small">Summary of the AI proposal: </span>}{r.narrative}</p>

      <section aria-labelledby="value-h" className="value-tiles">
        <h3 id="value-h" className="sr-only">Value</h3>
        <div className="tile" style={{ ["--c" as string]: "var(--cost)" }}><span className="eyebrow">Cost avoided</span><b className="num">{money(r.value.costAvoided)}</b></div>
        <div className="tile" style={{ ["--c" as string]: "var(--prod)" }}><span className="eyebrow">Productivity</span><b className="num">{money(r.value.productivity)}</b></div>
        <div className="tile" style={{ ["--c" as string]: "var(--rev)" }}><span className="eyebrow">Revenue potential</span><b className="num">{r.value.revenuePotential ? money(r.value.revenuePotential) : "None"}</b></div>
      </section>
      <button className="btn btn-ghost small" aria-expanded={showAssumptions} onClick={() => setShowAssumptions(!showAssumptions)}>
        {showAssumptions ? "Hide" : "Show"} how this is calculated
      </button>
      {showAssumptions && <ul className="assumptions">{r.value.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>}

      <h3 className="section-h">Team from inside</h3>
      {r.team.length === 0 ? <p className="muted">Nobody inside matches well enough yet. See the gaps below.</p> : (
        <ul className="cands">{r.team.map((c, i) => <CandidateCard key={c.personId} c={c} onFocus={onFocus} index={i} />)}</ul>
      )}

      {r.gaps.length > 0 && <h3 className="section-h">Capability gaps</h3>}
      {r.gaps.map((g) => (
        <div key={g.role} className="gap rise">
          <div className="gap-head"><Icon name="alert" /><strong>{g.role}</strong><span className="chips">{g.skills.map((s) => <span key={s} className="chip chip-gap">{s}</span>)}</span></div>
          {g.reskill.length ? (
            <>
              <p className="muted">Closest internal people, ready with targeted reskilling instead of hiring:</p>
              <ul className="reskill">{g.reskill.map((o) => <ReskillCard key={o.personId} o={o} onFocus={onFocus} />)}</ul>
            </>
          ) : <p className="muted">No one is close yet: source externally or build the skill over time.</p>}
        </div>
      ))}

      <div className="activate-row">
        {activated ? (
          <p className="activated" role="status"><Icon name="check" /> Activated as {activated}. <a href="/value">See it in the value dashboard</a></p>
        ) : (
          <>
            <button className="btn btn-primary activate" onClick={onChallenge} aria-haspopup="dialog">
              <Icon name="users" /> Challenge Team
            </button>
            <p className="muted small activate-hint">{adjusted ? "You have unsaved changes to this team. " : ""}See the team match score, swap anyone, then activate.</p>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- person
type Profile = {
  id: string; name: string; title: string; department: string; location: string; hireYear: number; availabilityPct: number; consent: boolean;
  manager: { id: string; name: string; title: string } | null;
  declared: { skillId: string; skill: string; level: number }[];
  inferred: { skillId: string; skill: string; confidence: number; rationale: string; model: string; evidence: { id: string; kind: string; text: string; date: string }[] }[];
  projects: { id: string; name: string; status: string; role: string; note: string; end: string }[];
  systems: { id: string; name: string; role: string }[];
  incidentsResolved: number; knowledge: { id: string; title: string; reuse_count: number }[]; recognition: number;
  growth: GrowthPaths;
};

function Growth({ g, onAsk }: { g: GrowthPaths; onAsk: (q: string) => void }) {
  if (!g.readyNow.length && !g.nearlyReady.length) return null;
  return (
    <>
      <h3 className="section-h">Growth paths</h3>
      {g.readyNow.length > 0 && (
        <ul className="plain">
          {g.readyNow.map((x) => (
            <li key={`${x.opportunityId}-${x.role}`}>
              <span className="chip chip-ready"><Icon name="check" />Ready now</span> {x.role} on <button className="link-btn" onClick={() => onAsk(x.title)}>{x.title}</button>
              <span className="muted small num"> · {pct(x.score)} match</span>
            </li>
          ))}
        </ul>
      )}
      {g.nearlyReady.map((x) => (
        <div key={`${x.opportunityId}-${x.role}`} className="card growth rise">
          <div className="row-between"><span>{x.role} on <button className="link-btn" onClick={() => onAsk(x.title)}>{x.title}</button></span><b className="num">{pct(x.readiness)} ready</b></div>
          <div className="path">{x.steps.map((s) => <span key={s} className="chip"><Icon name="grad" />{s}</span>)}</div>
          <p className="muted small">{x.weeks} weeks · {x.costAmt ? money(x.costAmt) : "no course fees"}</p>
        </div>
      ))}
    </>
  );
}

export function PersonPanel({ id, onFocus, onAsk }: { id: string; onFocus: (id: string) => void; onAsk: (q: string) => void }) {
  const [p, setP] = useState<Profile | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    setP(null); setErr("");
    fetch(`/api/person/${id}`).then((r) => (r.ok ? r.json() : Promise.reject(r.statusText))).then(setP).catch(() => setErr("Could not load this profile."));
  }, [id]);
  if (err) return <div className="panel-body"><p role="alert">{err}</p></div>;
  if (!p) return <div className="panel-body"><div className="skeleton" style={{ height: 24, width: "60%" }} /><div className="skeleton" style={{ height: 120, marginTop: 16 }} /></div>;
  return (
    <div className="panel-body">
      <div className="eyebrow">Contribution constellation</div>
      <h2 className="panel-title">{p.name}</h2>
      <p className="muted">{p.title} · {p.department}, {p.location} · since {p.hireYear}</p>
      {p.manager && <p className="muted small">Reports to <button className="link-btn" onClick={() => onFocus(p.manager!.id)}>{p.manager.name}</button></p>}
      <div className="chips"><span className="chip">{p.availabilityPct}% available</span><span className="chip">{p.incidentsResolved} incidents resolved</span><span className="chip">{p.recognition} peer recognitions</span></div>
      {!p.consent && <p className="note"><Icon name="shield" /> This person opted out of visibility. Shown only in aggregate views.</p>}

      {p.inferred.length > 0 && (
        <>
          <h3 className="section-h">Hidden capability (AI-inferred, with evidence)</h3>
          <ul className="inferred">
            {p.inferred.map((s) => (
              <li key={s.skillId} className="card">
                <div className="row-between"><span className="chip chip-inferred"><Icon name="spark" />{s.skill}</span><b className="num">{pct(s.confidence)} confidence</b></div>
                <p className="small">{s.rationale}</p>
                <ul className="evidence">{s.evidence.slice(0, 3).map((e) => <li key={e.id}><span className="ev-kind">{e.kind}</span> {e.text}</li>)}</ul>
              </li>
            ))}
          </ul>
        </>
      )}
      {p.consent && <Growth g={p.growth} onAsk={onAsk} />}
      <h3 className="section-h">Declared skills</h3>
      <div className="chips">{p.declared.map((s) => <span key={s.skillId} className="chip">{s.skill} · {s.level}/5</span>)}</div>
      <h3 className="section-h">Projects ({p.projects.length})</h3>
      <ul className="plain">{p.projects.map((x) => <li key={x.id}><button className="link-btn" onClick={() => onFocus(x.id)}>{x.name}</button> <span className="muted small">{x.status} · {x.note}</span></li>)}</ul>
      {p.systems.length > 0 && <><h3 className="section-h">Systems</h3><div className="chips">{p.systems.map((s) => <button key={s.id} className="chip chip-btn" onClick={() => onFocus(s.id)}>{s.name} · {s.role}</button>)}</div></>}
      {p.knowledge.length > 0 && <><h3 className="section-h">Knowledge shared</h3><ul className="plain">{p.knowledge.map((k) => <li key={k.id}>{k.title} <span className="muted small">reused {k.reuse_count}×</span></li>)}</ul></>}
    </div>
  );
}

// ---------------------------------------------------------------- hidden talent
export function TalentPanel({ people, onFocus }: { people: HiddenTalentPerson[] | null; onFocus: (id: string) => void }) {
  if (!people) return <div className="panel-body"><div className="skeleton" style={{ height: 200 }} /></div>;
  const top = people[0];
  return (
    <div className="panel-body">
      <div className="eyebrow">Discover hidden talent</div>
      <h2 className="panel-title">High contribution, low visibility</h2>
      <p className="note"><Icon name="shield" /> Only people who opted in to visibility. For recognition and career visibility, never performance scoring.</p>
      {top && (
        <div className="card spotlight rise">
          <div className="row-between"><strong><Icon name="star" /> {top.name}</strong><span className="chip chip-inferred">Hidden contributor</span></div>
          <p className="muted small">{top.title} · {top.department}, {top.location}</p>
          <ul className="facts">
            <li>High contribution across <b>{top.projects} projects</b></li>
            <li>Cross-team dependency: <b>{top.crossTeamDependency}</b></li>
            <li>Management visibility: <b>{top.visibility < 30 ? "low" : "medium"}</b></li>
            <li>Critical knowledge areas: <b>{top.criticalKnowledgeAreas}</b></li>
            <li>Recent contribution: <b>{top.trend === "rising" ? "increasing" : top.trend}</b></li>
          </ul>
          <button className="btn small" onClick={() => onFocus(top.personId)}>Dive into {top.name.split(" ")[0]}'s network</button>
        </div>
      )}
      <ul className="talent">
        {people.slice(1).map((p) => (
          <li key={p.personId}>
            <button className="link-btn" onClick={() => onFocus(p.personId)}>{p.name}</button>
            <span className="muted small"> {p.title}</span>
            <div className="cv"><span>Contribution</span><span className="bar"><i style={{ width: `${p.contribution}%` }} /></span><span>Visibility</span><span className="bar dim"><i style={{ width: `${p.visibility}%` }} /></span></div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- risk
type Risk = { systemId: string; name: string; share: number; people: { id: string; name: string; retirementRisk: number; hireYear: number }[] };

export function RiskPanel({ onWhatIf, result, onFocus }: { onWhatIf: (ids: string[]) => void; result: WhatIfResult | null; onFocus: (id: string) => void }) {
  const [risks, setRisks] = useState<Risk[] | null>(null);
  useEffect(() => { fetch("/api/risks").then((r) => r.json()).then(setRisks).catch(() => setRisks([])); }, []);
  if (!risks) return <div className="panel-body"><div className="skeleton" style={{ height: 160 }} /></div>;
  return (
    <div className="panel-body">
      <div className="eyebrow">Dependency risk</div>
      <h2 className="panel-title">Where are we over-dependent on individuals?</h2>
      {risks.length === 0 && <p className="muted">No system depends on fewer than three people.</p>}
      {risks.map((r) => (
        <div key={r.systemId} className="card rise">
          <div className="row-between"><strong>{r.name}</strong><b className="num danger">{pct(r.share)}</b></div>
          <p className="muted small">of incident work handled by {r.people.length} people:</p>
          <ul className="plain">
            {r.people.map((p) => (
              <li key={p.id}><button className="link-btn" onClick={() => onFocus(p.id)}>{p.name}</button>
                <span className="muted small"> joined {p.hireYear}{p.retirementRisk ? " · retirement within 2 years" : ""}</span></li>
            ))}
          </ul>
          <button className="btn small" onClick={() => onWhatIf(r.people.map((p) => p.id))}><Icon name="alert" /> What if these {r.people.length} leave?</button>
        </div>
      ))}
      {result && (
        <div className="card whatif rise" role="status">
          <strong>Blast radius</strong>
          <ul className="plain">
            {result.systems.map((s) => <li key={s.id}>{s.name}: loses {pct(s.coverageLost)} of its expertise, {s.remainingExperts} expert{s.remainingExperts === 1 ? "" : "s"} left</li>)}
          </ul>
          <p className="small">{result.customers.length} customer accounts depend on the affected systems. Start knowledge transfer now.</p>
        </div>
      )}
    </div>
  );
}
