// Human decisions on agent proposals. Approving is the only way an agent's proposal changes data or money:
// bids and held purchases become impact records; recognition, SME roles and confirmed skills become new records,
// which the database triggers feed back to the Connectivity Agent.
import { get, run } from "../db.ts";
import { money } from "../format.ts";
import { bumpDataVersion } from "../cacheVersion.ts";
import { activate } from "../engine/impact.ts";
import { valueForOpportunity, type OpportunityRow } from "../engine/value.ts";
import { tick } from "./runner.ts";
import { ensureAgentTables, today } from "./store.ts";

export function decide(id: number, decision: "approve" | "dismiss"): { status: string; outcome: string } {
  ensureAgentTables();
  const row = get<{ id: number; status: string; action: string; title: string }>("SELECT id, status, action, title FROM agent_inbox WHERE id = ?", id);
  if (!row) throw new Error("Proposal not found.");
  if (row.status !== "pending") throw new Error(`Already ${row.status}.`);
  if (decision === "dismiss") {
    run("UPDATE agent_inbox SET status = 'dismissed', decided_at = ?, outcome = 'Dismissed' WHERE id = ?", new Date().toISOString(), id);
    return { status: "dismissed", outcome: "Dismissed" };
  }
  const a = JSON.parse(row.action) as Record<string, any>;
  let outcome = "Approved; owner notified.";
  let changed = false;
  if (a.type === "activate") {
    const o = get<OpportunityRow>("SELECT * FROM opportunities WHERE id = ?", a.opportunityId);
    if (!o) throw new Error("Opportunity no longer exists.");
    const rec = activate(o.id, a.title, a.personIds, valueForOpportunity(o), "Revenue growth", "agent");
    outcome = `Impact record ${rec.id}: team of ${a.personIds.length} activated, ${money(rec.cost_avoided_amt + rec.productivity_amt + rec.revenue_amt)} recorded.`;
  } else if (a.type === "hold_purchase") {
    run("UPDATE purchase_requests SET status = 'held' WHERE id = ?", a.prId);
    const rec = activate(null, `Held ${a.prId}: ${a.skill} staffed internally`, a.personIds,
      { costAvoided: a.costAvoided, productivity: 0, revenuePotential: 0, recruitmentAvoided: 0, assumptions: [], estimated: false }, "Avoided consultancy", "agent");
    outcome = `Purchase held. Impact record ${rec.id}: ${money(a.costAvoided)} external cost avoided.`;
  } else if (a.type === "sme_role" && a.systemId) {
    run("INSERT OR IGNORE INTO system_roles (system_id, person_id, role) VALUES (?, ?, 'sme (via SkillBridge)')", a.systemId, a.personId);
    run("INSERT INTO change_events (kind, entity_id, person_ids, payload, source, created_at) VALUES ('system_role', ?, ?, '{}', 'approval', ?)",
      `${a.systemId}:${a.personId}`, a.personId, new Date().toISOString());
    outcome = "Added as SME on the system; the graph now shows the link.";
    changed = true;
  } else if (a.type === "recognise") {
    run("INSERT INTO visibility_signals (id, person_id, kind, date) VALUES (?, ?, 'Manager recognition via SkillBridge', ?)", `SIM-VIS-${id}`, a.personId, today());
    outcome = "Recognition recorded; their visibility rises in Hidden Talent.";
    changed = true;
  } else if (a.type === "confirm_skill") {
    run("INSERT OR IGNORE INTO person_skills (person_id, skill_id, level, source, last_used_year) VALUES (?, ?, 3, 'confirmed', ?)", a.personId, a.skillId, Number(today().slice(0, 4)));
    outcome = "Skill confirmed on the profile (level 3).";
    changed = true;
  }
  run("UPDATE agent_inbox SET status = 'approved', decided_at = ?, outcome = ? WHERE id = ?", new Date().toISOString(), outcome, id);
  bumpDataVersion();
  if (changed) void tick(true);
  return { status: "approved", outcome };
}
