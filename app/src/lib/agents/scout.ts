// Opportunity Scout: reacts to new opportunities, consultancy purchase requests and new discovery findings.
// Figures come from team formation and the value formulas; the AI drafts the case; a human approves.
import { get } from "../db.ts";
import { money, pct } from "../format.ts";
import { data } from "../engine/data.ts";
import { capability } from "../engine/match.ts";
import { staffed } from "../engine/portfolio.ts";
import { valueForOpportunity, type OpportunityRow } from "../engine/value.ts";
import { draft } from "./draft.ts";
import type { GraphDiff } from "./snapshot.ts";
import { finishRun, propose, startRun, today, type ChangeEvent, type Step } from "./store.ts";

const SYSTEM = "You write a short brief (2 or 3 sentences) from SkillBridge to a head of sales or procurement. Lead with the recommendation, " +
  "then the figures that justify it, then who would do the work.";

export async function runScout(events: ChangeEvent[], d: GraphDiff): Promise<number | null> {
  const opps = events.filter((e) => e.kind === "opportunity");
  const prs = events.filter((e) => e.kind === "purchase_request");
  const findings = d.cards.filter((c) => c.type === "revenue" || c.type === "external_spend" || c.type === "capacity").slice(0, 2);
  if (!opps.length && !prs.length && !findings.length) return null;
  const m = data();
  const trigger = [opps.length && `${opps.length} new opportunity`, prs.length && `${prs.length} purchase request`, findings.length && `${findings.length} new finding`].filter(Boolean).join(", ");
  const runId = startRun("scout", trigger as string, [...opps, ...prs].map((e) => e.id));
  const steps: Step[] = [];
  let provider = "template", made = 0;
  const nodes: string[] = [];

  for (const e of opps) {
    const o = get<OpportunityRow & { org_id: string | null }>("SELECT * FROM opportunities WHERE id = ?", e.entity_id);
    if (!o) continue;
    let t = Date.now();
    const team = staffed(o.id);
    const v = valueForOpportunity(o, m);
    steps.push({ tool: "Team formation", detail: `${o.title}: ${team.team.length} people, ${pct(team.coverage)} covered, ${team.gaps.length} gap${team.gaps.length === 1 ? "" : "s"}`, ms: Date.now() - t });
    const evidence = [
      ...team.team.map((c) => `${c.role}: ${c.name}, ${c.department} (${pct(c.score)})`),
      ...team.gaps.map((g) => `Gap: ${g.role}${g.reskill[0] ? `, ${g.reskill[0].name} ${pct(g.reskill[0].readiness)} ready in ${g.reskill[0].weeks} weeks` : ""}`),
      `Value: ${money(v.costAvoided)} external cost avoided, ${money(v.productivity)} productivity, ${money(v.revenuePotential)} revenue potential`,
    ];
    t = Date.now();
    const note = await draft(SYSTEM, { opportunity: o.title, coverage: pct(team.coverage), team: evidence, recommendation: team.coverage >= 0.99 ? "bid with the internal team" : "bid, closing the gap by reskilling" },
      `Bid on ${o.title} with an internal team: ${pct(team.coverage)} of the roles are covered today. ${money(v.revenuePotential)} revenue potential and ${money(v.costAvoided)} of external cost avoided.`);
    steps.push({ tool: "Draft bid case", detail: o.title, ms: Date.now() - t, ai: true });
    if (note.provider !== "template") provider = note.provider;
    const ids = [o.id, ...team.team.map((c) => c.personId)];
    nodes.push(...ids);
    if (propose({ agent: "scout", runId, kind: "bid", title: `Bid from inside: ${o.title}`, detail: note.text, evidence, valueAmt: v.costAvoided + v.productivity + v.revenuePotential,
      nodeIds: ids, approver: "Head of Enterprise Sales", action: { type: "activate", opportunityId: o.id, title: o.title, personIds: team.team.map((c) => c.personId) },
      dedupeKey: `scout:bid:${o.id}`, provider: note.provider })) made++;
  }

  for (const e of prs) {
    const pr = get<{ id: string; vendor_org_id: string; skill_id: string; days: number; cost_amt: number; description: string }>("SELECT * FROM purchase_requests WHERE id = ?", e.entity_id);
    if (!pr) continue;
    let t = Date.now();
    const skill = m.skills.get(pr.skill_id)?.name ?? pr.skill_id;
    const vendor = get<{ name: string }>("SELECT name FROM organisations WHERE id = ?", pr.vendor_org_id)?.name ?? pr.vendor_org_id;
    const now = today();
    const free = [...m.people.values()]
      .filter((p) => p.level !== "C" && p.consent_visibility === 1 && capability(m, p.id, pr.skill_id).value >= 0.8)
      .map((p) => ({ p, alloc: (m.assignments.get(p.id) ?? []).filter((a) => a.start_date <= now && a.end_date >= now).reduce((s, a) => s + a.allocation_pct, 0) }))
      .filter((x) => x.alloc < 60)
      .sort((a, b) => a.alloc - b.alloc || capability(m, b.p.id, pr.skill_id).value - capability(m, a.p.id, pr.skill_id).value);
    steps.push({ tool: "Capability and allocation check", detail: `${skill}: ${free.length} internal expert${free.length === 1 ? "" : "s"} under 60% allocated`, ms: Date.now() - t });
    if (!free.length) continue;
    const lead = free[0].p;
    const internal = pr.days * 8 * lead.loaded_rate_amt;
    const avoided = Math.max(0, pr.cost_amt - internal);
    const evidence = [
      `${pr.id}: ${vendor}, ${pr.days} days of ${skill}, ${money(pr.cost_amt)}`,
      ...free.slice(0, 3).map((x) => `${x.p.name}, ${x.p.title}: ${x.alloc}% allocated, ${pct(capability(m, x.p.id, pr.skill_id).value)} ${skill}`),
      `Internal cost: ${pr.days} days x 8 h x $${lead.loaded_rate_amt}/h = ${money(internal)}`,
    ];
    t = Date.now();
    const note = await draft(SYSTEM, { purchase_request: pr.description, vendor, cost: money(pr.cost_amt), internal_experts: evidence.slice(1, 4), internal_cost: money(internal), saving: money(avoided), recommendation: "hold the purchase and staff it internally" },
      `Hold ${pr.id}: ${free.length} internal ${skill} expert${free.length === 1 ? " is" : "s are"} under 60% allocated. Staffing it with ${lead.name} costs ${money(internal)} against ${money(pr.cost_amt)} from ${vendor}, saving ${money(avoided)}.`);
    steps.push({ tool: "Draft purchase hold", detail: pr.id, ms: Date.now() - t, ai: true });
    if (note.provider !== "template") provider = note.provider;
    const ids = [pr.skill_id, pr.vendor_org_id, ...free.slice(0, 3).map((x) => x.p.id)];
    nodes.push(...ids);
    if (propose({ agent: "scout", runId, kind: "hold_purchase", title: `Hold purchase: ${skill} consultants (${money(pr.cost_amt)})`, detail: note.text, evidence, valueAmt: avoided,
      nodeIds: ids, approver: "Head of Procurement", action: { type: "hold_purchase", prId: pr.id, personIds: free.slice(0, 2).map((x) => x.p.id), costAvoided: avoided, skill, cost: pr.cost_amt },
      dedupeKey: `scout:pr:${pr.id}`, provider: note.provider })) made++;
  }

  for (const c of findings) {
    nodes.push(...c.nodeIds);
    if (propose({ agent: "scout", runId, kind: "finding", title: c.title, detail: c.detail, evidence: c.evidence.slice(0, 4), valueAmt: c.valueAmt, nodeIds: c.nodeIds,
      approver: "Head of Strategy", action: { type: "note" }, dedupeKey: `scout:card:${c.id}:${c.metric}`, provider: "rules" })) made++;
  }
  steps.push({ tool: "Opportunity discovery", detail: `${findings.length} new or changed finding${findings.length === 1 ? "" : "s"} on the board`, ms: 0 });
  finishRun(runId, "done", steps, `${made} proposal${made === 1 ? "" : "s"} for sales and procurement.`, provider, nodes);
  return made;
}
