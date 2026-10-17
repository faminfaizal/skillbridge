// Risk Sentinel: reacts when a system's expertise concentrates further, someone becomes overloaded, or a new knowledge
// island appears. The AI drafts a three-step plan; the system owner or department head approves.
import { all } from "../db.ts";
import { pct } from "../format.ts";
import { data } from "../engine/data.ts";
import { whatIf } from "../engine/whatif.ts";
import { draft } from "./draft.ts";
import type { GraphDiff } from "./snapshot.ts";
import { finishRun, propose, startRun, type Step } from "./store.ts";

const SYSTEM = "You write a three-step plan (one sentence per step, numbered 1 to 3) from SkillBridge to a system owner or department head, " +
  "to reduce dependence on a few people. Practical: pairing, runbooks, rotation. Recognition, never blame.";

export async function runSentinel(d: GraphDiff): Promise<number | null> {
  const loads = [...d.signals.bottlenecks.added, ...d.signals.bottlenecks.changed.map((c) => c.item)].slice(0, 2);
  const islands = d.signals.islands.added.slice(0, 1);
  if (!d.risks.length && !loads.length && !islands.length) return null;
  const m = data();
  const trigger = [d.risks.length && `${d.risks.length} concentration rise`, loads.length && `${loads.length} overloaded connector`, islands.length && "new knowledge island"].filter(Boolean).join(", ");
  const runId = startRun("sentinel", trigger as string);
  const steps: Step[] = [];
  let provider = "template", made = 0;
  const nodes: string[] = [];

  for (const r of d.risks) {
    let t = Date.now();
    const w = whatIf(r.people.map((p) => p.id));
    steps.push({ tool: "What-if blast radius", detail: `${r.name}: ${w.systems.length} systems and ${w.customers.length} customers if ${r.people.length} people leave`, ms: Date.now() - t });
    const owner = all<{ name: string }>("SELECT p.name FROM system_roles r JOIN people p ON p.id = r.person_id WHERE r.system_id = ? AND r.role = 'owner'", r.systemId)[0]?.name;
    const kis = all<{ title: string; reuse_count: number }>(`SELECT title, reuse_count FROM knowledge_items WHERE system_id = ? ORDER BY reuse_count DESC LIMIT 2`, r.systemId);
    const evidence = [
      `${r.name}: ${pct(r.before)} to ${pct(r.after)} of incident work now with ${r.people.length} people`,
      ...r.people.map((p) => `${p.name}${p.retirementRisk ? " (retires within 2 years)" : ""}`),
      `If they leave: ${w.systems.length} systems and ${w.customers.length} customer accounts affected`,
      ...kis.map((k) => `Runbook to build on: "${k.title}" (reused ${k.reuse_count} times)`),
    ];
    t = Date.now();
    const note = await draft(SYSTEM, { system: r.name, concentration_before: pct(r.before), concentration_now: pct(r.after), people: r.people.map((p) => p.name), customers_exposed: w.customers.length, runbooks: kis.map((k) => k.title) },
      `1. Pair two engineers with ${r.people.map((p) => p.name.split(" ")[0]).join(", ")} on the next ${r.name} incidents. 2. Turn ${kis[0] ? `"${kis[0].title}"` : "their fixes"} into the team runbook. 3. Rotate the on-call so at least five people handle ${r.name} this quarter.`);
    steps.push({ tool: "Draft knowledge-transfer plan", detail: r.name, ms: Date.now() - t, ai: true });
    if (note.provider !== "template") provider = note.provider;
    const ids = [r.systemId, ...r.people.map((p) => p.id), ...w.customers.map((c) => c.id)];
    nodes.push(...ids);
    if (propose({ agent: "sentinel", runId, kind: "transfer_plan", title: `Knowledge-transfer plan: ${r.name} (${pct(r.after)} on ${r.people.length} people)`, detail: note.text,
      evidence, valueAmt: 0, nodeIds: ids, approver: owner ? `${owner} (system owner)` : "System owner", action: { type: "note", systemId: r.systemId },
      dedupeKey: `sentinel:risk:${r.systemId}:${Math.round(r.after * 100)}`, provider: note.provider })) made++;
  }

  for (const it of loads) {
    const p = m.people.get(it.id);
    const manager = p?.manager_id ? m.people.get(p.manager_id) : undefined;
    const t = Date.now();
    const note = await draft(SYSTEM, { person: it.title, load_flags: it.facts.slice(0, -1) },
      `1. Name a deputy for ${it.title}'s busiest system. 2. Move one active project to a colleague with capacity. 3. Review the load again in four weeks.`);
    steps.push({ tool: "Draft load-sharing plan", detail: it.title, ms: Date.now() - t, ai: true });
    if (note.provider !== "template") provider = note.provider;
    nodes.push(...it.nodeIds);
    if (propose({ agent: "sentinel", runId, kind: "share_load", title: `Share ${it.title}'s load (${it.metric})`, detail: note.text, evidence: it.facts.slice(0, -1), valueAmt: 0,
      nodeIds: it.nodeIds, approver: manager ? `${manager.name} (manager)` : "Line manager", action: { type: "note", personId: it.id },
      dedupeKey: `sentinel:load:${it.id}:${it.metric}:${it.facts.length}`, provider: note.provider })) made++;
  }

  for (const it of islands) {
    nodes.push(...it.nodeIds);
    if (propose({ agent: "sentinel", runId, kind: "island", title: `Open a ${it.title} clinic: ${it.subtitle.toLowerCase()}`, detail: it.facts.join(" "), evidence: it.facts,
      valueAmt: 0, nodeIds: it.nodeIds, approver: "Department head", action: { type: "note" }, dedupeKey: `sentinel:island:${it.id}`, provider: "rules" })) made++;
  }
  steps.unshift({ tool: "Read graph diff", detail: trigger as string, ms: 0 });
  finishRun(runId, "done", steps, `${made} risk proposal${made === 1 ? "" : "s"} raised.`, provider, nodes);
  return made;
}
