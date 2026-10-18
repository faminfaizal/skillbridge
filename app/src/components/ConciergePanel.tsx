"use client";
// Concierge agent answer: the reply, the tools it chose and what each returned, links into the graph and lenses.
// Follow-up answers show how many earlier questions of the conversation the agent used.
import { Icon } from "./Icon";
import { aiLabel } from "../lib/format";
import type { ConciergeAnswer, ConciergeRef } from "../lib/types";

const TOOL_LABEL: Record<string, string> = {
  find_people: "Find people", get_person: "Person profile", staff_request: "Staff a request", executive_question: "Executive answer",
  people_signal: "People signals", opportunities: "Opportunity board", agent_inbox: "Agent inbox", agent_activity: "Agent activity",
  what_if: "What-if", value_dashboard: "Value dashboard",
};

function Answer({ text }: { text: string }) {
  const blocks: { list: boolean; lines: string[] }[] = [];
  for (const raw of text.split(/\n+/)) {
    const line = raw.trim();
    if (!line) continue;
    const item = /^([-*•]|\d+\.)\s+/.test(line);
    const clean = line.replace(/^([-*•]|\d+\.)\s+/, "").replace(/\*\*/g, "");
    const last = blocks[blocks.length - 1];
    if (item && last?.list) last.lines.push(clean);
    else blocks.push({ list: item, lines: [clean] });
  }
  return (
    <div className="concierge-answer">
      {blocks.map((b, i) => (b.list ? <ul key={i}>{b.lines.map((l) => <li key={l}>{l}</li>)}</ul> : <p key={i}>{b.lines[0]}</p>))}
    </div>
  );
}

export default function ConciergePanel({ r, onFocus, onAsk, onLens, onAgents }: {
  r: ConciergeAnswer; onFocus: (id: string) => void; onAsk: (q: string) => void; onLens: (lens: string) => void; onAgents: () => void;
}) {
  const open = (ref: ConciergeRef) => (ref.kind === "lens" ? onLens(ref.id) : ref.kind === "agents" ? onAgents() : onFocus(ref.id));
  const toolSteps = r.steps.filter((s) => TOOL_LABEL[s.tool]);
  return (
    <div className="panel-body">
      <div className="eyebrow"><Icon name="brief" /> Concierge agent</div>
      <h2 className="panel-title">{r.query}</h2>
      <div className="chips">
        <span className="chip" title="How the answer was produced">
          <Icon name="spark" />{r.mode === "tool-calling" ? `Tool calling · ${aiLabel(r.provider)}` : `Planned · ${r.provider === "template" ? "rules" : aiLabel(r.provider)}`}
        </span>
        <span className="chip">{toolSteps.length} tool call{toolSteps.length === 1 ? "" : "s"}</span>
        <span className={`chip${r.grounded ? " chip-ready" : " chip-gap"}`}><Icon name={r.grounded ? "check" : "alert"} />{r.grounded ? "Every figure from the tools" : "Rebuilt from tool results"}</span>
        {r.memory && r.memory.turns > 0 && (
          <span className="chip chip-memory" title={r.memory.source === "firestore" ? "Conversation memory restored from Firestore" : "Conversation memory from this session"}>
            <Icon name="chat" />Remembers {r.memory.turns} earlier question{r.memory.turns === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <Answer text={r.answer} />

      {r.refs.length > 0 && (
        <>
          <h3 className="section-h">Open</h3>
          <div className="chips">
            {r.refs.map((ref) => (
              <button key={`${ref.kind}:${ref.id}`} className={`chip chip-btn${ref.kind === "lens" || ref.kind === "agents" ? " chip-exec" : ""}`} onClick={() => open(ref)}>
                <Icon name={ref.kind === "person" ? "user" : ref.kind === "agents" ? "spark" : ref.kind === "lens" ? "network" : "arrow"} />{ref.label}
              </button>
            ))}
          </div>
        </>
      )}

      <details className="concierge-steps" open>
        <summary>How I answered ({r.elapsedMs} ms)</summary>
        <ol className="steps-list">
          {r.steps.map((s, i) => (
            <li key={i}>
              <span className={`step-tool${s.ai ? " ai" : ""}`}>{s.ai && <Icon name="spark" />}{TOOL_LABEL[s.tool] ?? s.tool}</span>
              {s.args && s.args !== "{}" && <code className="step-args">{s.args}</code>}
              <span className="muted"> {s.result}</span>{s.ms > 0 && <span className="muted num"> · {s.ms} ms</span>}
            </li>
          ))}
        </ol>
      </details>

      {r.followUps.length > 0 && (
        <>
          <h3 className="section-h">Ask next</h3>
          <div className="chips">{r.followUps.map((q) => <button key={q} className="chip chip-btn" onClick={() => onAsk(q)}>{q}</button>)}</div>
        </>
      )}
      <p className="note"><Icon name="shield" /> Read-only agent: it calls SkillBridge tools and cannot approve or change anything. Decisions go through the Agents inbox.</p>
    </div>
  );
}
