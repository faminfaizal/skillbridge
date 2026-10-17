"use client";
// "Growth" tabs: AI suggestions, Interests and growth, Availability.
import { useEffect, useId, useState } from "react";
import { Icon } from "../Icon";
import { money } from "../../lib/format";
import { Card, Empty, InlineText, LevelPicker, SectionHead, TagInput, Toggle, levelLabel, useProfile } from "./kit";

// ================================================================ AI suggestions
function SuggestionCard({ s }: { s: ReturnType<typeof useProfile>["b"]["suggestions"][number] }) {
  const { act } = useProfile();
  const [lvl, setLvl] = useState(3);
  return (
    <li className="pf-sugg">
      <div className="pf-item-top"><b>{s.name}</b><span className="pf-badge pf-ai"><Icon name="spark" />AI suggestion</span></div>
      <div className="pf-conf"><span className="small muted">Confidence</span><div className="bar" role="img" aria-label={`${Math.round(s.confidence * 100)}% confidence`}><i style={{ width: `${s.confidence * 100}%` }} /></div>
        <span className="small num">{Math.round(s.confidence * 100)}%</span></div>
      {s.rationale && <p className="small">{s.rationale}</p>}
      {s.evidence.length > 0 && (
        <details className="pf-details"><summary>Based on {s.evidence.length} work record{s.evidence.length > 1 ? "s" : ""}</summary>
          <ul className="pf-list compact">{s.evidence.map((e, i) => <li key={i} className="pf-item"><div className="pf-item-main"><div className="pf-item-top"><span className="chip">{e.kind}</span><span className="small muted">{e.date}</span></div><p className="small">{e.text}</p></div></li>)}</ul>
        </details>
      )}
      <LevelPicker value={lvl} onChange={setLvl} label={`Your level in ${s.name}`} />
      <div className="pf-row">
        <button type="button" className="btn btn-approve" onClick={() => act("suggestions", "decide", { skillId: s.skillId, decision: "confirm", level: lvl })}><Icon name="check" />Yes, add at {levelLabel(lvl)}</button>
        <button type="button" className="btn" onClick={() => act("suggestions", "decide", { skillId: s.skillId, decision: "decline" })}>Not me</button>
      </div>
    </li>
  );
}

export function SuggestionsTab() {
  const { b } = useProfile();
  return (
    <>
      <SectionHead title="AI suggestions" desc="Skills Gemini noticed in your work records but that are not on your profile. Nothing is added until you say yes." />
      {b.suggestions.length === 0
        ? <Card><Empty icon="spark" title="Nothing to review" text="When your work shows a skill you have not listed, it appears here for you to confirm." /></Card>
        : <ul className="pf-sugg-list">{b.suggestions.map((s) => <SuggestionCard key={s.skillId} s={s} />)}</ul>}
    </>
  );
}

// ================================================================ Interests and growth
export function GrowthTab() {
  const { b, act } = useProfile();
  const g = b.growth;
  const roleIdeas = [...new Set([...g.paths.readyNow.map((r) => r.role), ...g.paths.nearlyReady.map((r) => r.role)])];
  const families = [...new Set(b.catalog.skills.map((s) => s.family))];
  return (
    <>
      <SectionHead title="Interests and growth" desc="What you want to do next. Managers and HR see this to offer projects, mentoring and courses." section="growth" />
      <Card title="Your direction">
        <TagInput label="Interests" values={g.interests} suggestions={[...b.skills.filter((s) => s.wantGrow).map((s) => s.name), ...families]}
          placeholder="Type an interest and press Enter" onChange={(v) => act("growth", "save", { interests: v })} />
        <InlineText label="Career goal" value={g.goals} multiline maxLength={800} placeholder="For example: lead network automation for the access network within two years"
          hint="A sentence or two. Saves when you leave the field." onCommit={(v) => act("growth", "save", { goals: v })} />
        <TagInput label="Roles you are aiming for" values={g.targetRoles} suggestions={roleIdeas} placeholder="Type a role and press Enter"
          onChange={(v) => act("growth", "save", { targetRoles: v })} />
      </Card>
      <Card title={<><Icon name="trend" />Growth paths for you</>}>
        <p className="small muted">From open roles in current opportunities, matched against your skills.</p>
        {g.paths.readyNow.length === 0 && g.paths.nearlyReady.length === 0 && <p className="small muted">No open roles match you closely right now. Adding skills and evidence improves matching.</p>}
        {g.paths.readyNow.length > 0 && (<><h4>Ready now</h4><ul className="pf-list compact">{g.paths.readyNow.slice(0, 6).map((r) => (
          <li key={`${r.opportunityId}-${r.role}`} className="pf-item"><div className="pf-item-main"><div className="pf-item-top"><b>{r.role}</b><span className="pf-badge pf-ok">{Math.round(r.score * 100)}% match</span></div><p className="small muted">{r.title}</p></div></li>))}</ul></>)}
        {g.paths.nearlyReady.length > 0 && (<><h4>Nearly ready</h4><ul className="pf-list compact">{g.paths.nearlyReady.slice(0, 6).map((r) => (
          <li key={`${r.opportunityId}-${r.role}`} className="pf-item"><div className="pf-item-main">
            <div className="pf-item-top"><b>{r.role}</b><span className="pf-badge pf-wait">{Math.round(r.readiness * 100)}% ready</span><span className="small muted">{r.weeks} weeks · {money(r.costAmt)}</span></div>
            <p className="small muted">{r.title}</p><p className="small">{r.steps.join(" → ")}</p></div></li>))}</ul></>)}
      </Card>
    </>
  );
}

// ================================================================ Availability
export function AvailabilityTab() {
  const { b, act } = useProfile();
  const a = b.availability;
  const [pct, setPct] = useState(a.pct);
  useEffect(() => setPct(a.pct), [a.pct]);
  const id = useId();
  return (
    <>
      <SectionHead title="Availability" desc="How much time you could give to other work. Used when managers form teams; you approve every request." section="availability" />
      <Card title="Time for work outside your team">
        <div className="pf-field">
          <label htmlFor={`${id}-p`}>Available for other work</label>
          <div className="pf-range"><input id={`${id}-p`} type="range" min={0} max={100} step={5} value={pct} aria-valuetext={`${pct}%`}
            onChange={(e) => setPct(Number(e.target.value))} onMouseUp={() => pct !== a.pct && act("availability", "save", { pct })}
            onKeyUp={() => pct !== a.pct && act("availability", "save", { pct })} onTouchEnd={() => pct !== a.pct && act("availability", "save", { pct })} />
            <output htmlFor={`${id}-p`} className="num">{pct}%</output></div>
          <p className="small muted">About {Math.round((pct / 100) * 20)} days a month. Saves when you let go of the slider.</p>
        </div>
      </Card>
      <Card title="Open to">
        <Toggle label="Short projects and gigs" hint="Cross-team projects up to a few months." checked={a.openProjects} onChange={(v) => act("availability", "save", { openProjects: v })} />
        <Toggle label="SME requests" hint="Answer questions or review work in your skills." checked={a.openSme} onChange={(v) => act("availability", "save", { openSme: v })} />
        <Toggle label="Mentoring" hint="Guide someone growing into your skills." checked={a.openMentoring} onChange={(v) => act("availability", "save", { openMentoring: v })} />
        <div className="pf-field pf-narrow"><label htmlFor={`${id}-u`}>Available until (optional)</label>
          <input id={`${id}-u`} type="date" value={a.until} min={new Date().toISOString().slice(0, 10)} onChange={(e) => act("availability", "save", { until: e.target.value })} /></div>
      </Card>
    </>
  );
}
