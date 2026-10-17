// People Growth Agent: reacts to the graph diff with recognition and growth proposals for managers to approve.
// Only people who opted in to visibility are ever proposed.
import { get } from "../db.ts";
import { data } from "../engine/data.ts";
import { scorePerson } from "../engine/match.ts";
import { openOpportunities } from "../engine/portfolio.ts";
import { signals } from "../engine/signals.ts";
import { draft } from "./draft.ts";
import type { GraphDiff } from "./snapshot.ts";
import { finishRun, propose, startRun, type Step } from "./store.ts";
import type { SignalItem } from "../types.ts";

const SYSTEM = "You write a short note (2 or 3 sentences) from SkillBridge to a manager, proposing an action about one of their people. " +
  "Warm, specific and plain; recognition, never judgement or scoring.";

interface Candidate { kind: string; personId: string; title: string; finding: string; evidence: string[]; action: Record<string, unknown>; nodeIds: string[]; key: string; fallback: string }

export async function runPeople(d: GraphDiff, touched: Set<string>): Promise<number | null> {
  const m = data();
  const visible = (id: string) => m.people.get(id)?.consent_visibility === 1;
  const name = (id: string) => m.people.get(id)?.name ?? id;
  const first = (id: string) => name(id).split(" ")[0];
  // react to people whose own records changed; a lens shifting only because time passed is not news
  const relevant = (kind: "ghosts" | "rising" | "forgotten") => {
    const changed = new Set([...d.signals[kind].added, ...d.signals[kind].changed.map((c) => c.item)].map((it) => it.id));
    return signals(kind).items.filter((it) => touched.has(it.id) && changed.has(it.id) || (kind === "forgotten" && d.signals[kind].added.some((a) => a.id === it.id)));
  };
  const cands: Candidate[] = [];
  // newly inferred skills first: the clearest sign of what the Connectivity Agent just learned
  for (const s of d.inferred.filter((x) => visible(x.personId))) {
    const skill = m.skills.get(s.skillId)?.name ?? s.skillId;
    const ev = m.inferred.get(s.personId)?.get(s.skillId);
    cands.push({ kind: "confirm_skill", personId: s.personId, title: `Confirm ${name(s.personId)}'s new skill: ${skill}`, finding: `newly inferred skill ${skill}`,
      evidence: [ev?.rationale ?? `${skill} found in recent work records`, `Confidence ${Math.round((ev?.confidence ?? 0) * 100)}%`],
      action: { type: "confirm_skill", personId: s.personId, skillId: s.skillId }, nodeIds: [s.personId, s.skillId], key: `people:confirm:${s.personId}:${s.skillId}`,
      fallback: `${first(s.personId)}'s recent work shows ${skill}, which is not on their profile yet. Confirm it so ${first(s.personId)} is found for ${skill} work.` });
  }

  for (const it of relevant("ghosts")) {
    const systemId = it.nodeIds.find((x) => x.startsWith("SYS-"));
    cands.push({ kind: "on_record", personId: it.id, title: `Put ${it.title}'s work on the record`, finding: "off-chart contributor",
      evidence: it.facts.slice(0, 4), action: { type: "sme_role", personId: it.id, systemId }, nodeIds: it.nodeIds,
      key: `people:on_record:${it.id}:${systemId}`,
      fallback: `${it.title} keeps fixing systems outside their formal role (${it.facts[1] ?? it.metric}). Add them as an SME on ${get<{ name: string }>("SELECT name FROM systems WHERE id = ?", systemId ?? "")?.name ?? "that system"} so this work counts in their record.` });
  }
  for (const it of relevant("rising")) cands.push(recognise(it));
  for (const it of relevant("forgotten")) {
    // the open role where this expert would score best
    let best = { title: "", role: "", score: 0, id: "" };
    for (const o of openOpportunities()) for (const r of o.roles) {
      const s = scorePerson(it.id, r, m).score;
      if (s > best.score) best = { title: o.title, role: r.role, score: s, id: o.id };
    }
    cands.push({ kind: "re_engage", personId: it.id, title: `Re-engage ${it.title} on ${best.title || "open work"}`, finding: "expert whose activity faded",
      evidence: [...it.facts.slice(0, 3), ...(best.id ? [`Best open role: ${best.role} on ${best.title} (${Math.round(best.score * 100)}% match)`] : [])],
      action: { type: "note", personId: it.id, opportunityId: best.id }, nodeIds: [...it.nodeIds, ...(best.id ? [best.id] : [])], key: `people:re_engage:${it.id}`,
      fallback: `${it.title} has a strong track record but no active work. Invite them as ${best.role || "a reviewer"} on ${best.title || "an open opportunity"}.` });
  }
  const todo = cands.filter((c) => visible(c.personId)).slice(0, 4);
  if (!todo.length) return null;

  const runId = startRun("people", `Graph diff: ${todo.map((c) => c.finding).join(", ")}`);
  const steps: Step[] = [{ tool: "Read graph diff", detail: `${todo.length} people-related change${todo.length === 1 ? "" : "s"}`, ms: 0 }];
  let provider = "template", made = 0;
  for (const c of todo) {
    const p = m.people.get(c.personId)!;
    const manager = p.manager_id ? m.people.get(p.manager_id) : undefined;
    const t = Date.now();
    const note = await draft(SYSTEM, { person: p.name, title: p.title, manager: manager?.name ?? "their manager", finding: c.finding, evidence: c.evidence, proposed_action: c.title }, c.fallback);
    steps.push({ tool: "Draft manager note", detail: c.title, ms: Date.now() - t, ai: true });
    if (note.provider !== "template") provider = note.provider;
    if (propose({ agent: "people", runId, kind: c.kind, title: c.title, detail: note.text, evidence: c.evidence, valueAmt: 0, nodeIds: c.nodeIds,
      approver: manager ? `${manager.name} (manager)` : "Line manager", action: c.action, dedupeKey: c.key, provider: note.provider })) made++;
  }
  finishRun(runId, "done", steps, `${made} proposal${made === 1 ? "" : "s"} sent to managers.`, provider, todo.flatMap((c) => c.nodeIds));
  return made;
}

function recognise(it: SignalItem): Candidate {
  return {
    kind: "recognise", personId: it.id, title: `Recognise ${it.title}'s rising contribution`, finding: "rising contribution",
    evidence: it.facts.slice(0, 3), action: { type: "recognise", personId: it.id }, nodeIds: it.nodeIds, key: `people:recognise:${it.id}:${it.metric}`,
    fallback: `${it.title}'s contribution is rising (${it.metric} a month). A short public thank-you now keeps the momentum.`,
  };
}
