// Impact records (PRD 10.1) and the value dashboard summary (PRD 10.3).
import { all, get, run } from "../db.ts";
import type { ImpactRecord, ImpactSummary, ValueEstimate } from "../types.ts";

export function impactSummary(): ImpactSummary {
  const records = all<ImpactRecord>("SELECT * FROM impact_records ORDER BY date DESC, id DESC");
  const sum = (k: keyof ImpactRecord) => records.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  const totals = { costAvoided: sum("cost_avoided_amt"), productivity: sum("productivity_amt"), recruitment: sum("recruitment_amt"), revenue: sum("revenue_amt"), total: 0 };
  totals.total = totals.costAvoided + totals.productivity + totals.recruitment + totals.revenue;
  const initiatives = all<{ id: string; name: string; allocation_amt: number; outcome: string }>("SELECT * FROM reinvestment_initiatives ORDER BY allocation_amt DESC");
  const hidden = get<{ n: number }>("SELECT COUNT(*) n FROM inferred_skills")?.n ?? 0;
  const gaps = get<{ n: number }>("SELECT COUNT(*) n FROM requisitions WHERE status = 'open'")?.n ?? 0;
  return {
    totals,
    records,
    initiatives,
    capability: {
      peopleActivated: sum("people_count"),
      hiddenSkills: hidden,
      projectsStaffed: records.length,
      gaps,
      reskilling: get<{ n: number }>("SELECT COUNT(*) n FROM enrolments WHERE status = 'in progress'")?.n ?? 0,
    },
  };
}

/** source: 'activated' (Activate Capability button) or 'agent' (an approved agent proposal). */
export function activate(opportunityId: string | null, title: string, personIds: string[], value: ValueEstimate, strategic: string, source = "activated"): ImpactRecord {
  const existing = get<{ n: number }>("SELECT MAX(CAST(substr(id, 5) AS INTEGER)) n FROM impact_records")?.n ?? 0;
  const id = `IMP-${String(existing + 1).padStart(3, "0")}`;
  const date = new Date().toISOString().slice(0, 10);
  run(`INSERT INTO impact_records (id, date, title, opportunity_id, people_count, cost_avoided_amt, productivity_amt, recruitment_amt, revenue_amt,
       customer_impact, strategic_value, source, person_ids) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, date, title, opportunityId, personIds.length, value.costAvoided, value.productivity, value.recruitmentAvoided, value.revenuePotential,
    value.revenuePotential ? "New customer value" : "Faster internal delivery", strategic, source, personIds.join(","));
  return get<ImpactRecord>("SELECT * FROM impact_records WHERE id = ?", id)!;
}

/** Demo reset: remove records created by Activate or by approved agent proposals so the demo can be run again. */
export function resetActivations(): number {
  const n = get<{ n: number }>("SELECT COUNT(*) n FROM impact_records WHERE source IN ('activated', 'agent')")?.n ?? 0;
  run("DELETE FROM impact_records WHERE source IN ('activated', 'agent')");
  return n;
}
