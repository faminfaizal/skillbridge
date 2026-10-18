// Redeploy, don't retrench: when AI takes over a kind of work, find each exposed person's nearest internal destination
// and the smallest reskilling path. Owned by the value track (T3). Stub: a valid executive answer shape.
import type { Model } from "./data.ts";
import type { ExecBuilt } from "./exec.ts";

export function redeployBuilt(_m: Model): ExecBuilt {
  return {
    headline: "Redeployment analysis for roles exposed to automation is being prepared; no figures yet.",
    metrics: [
      { label: "People exposed", value: "0", tone: "risk" },
      { label: "Jobs preserved", value: "0", tone: "cost" },
      { label: "Cost avoided", value: "$0", tone: "rev" },
    ],
    table: { columns: [{ label: "Person" }, { label: "Destination" }], rows: [{ cells: ["None yet", "None yet"] }] },
    actions: [],
    assumptions: [],
    highlight: { nodeIds: [], edgeIds: [], danger: [] },
  };
}

/** Called after the redeploy answer is built: proposes the plan to the People Growth inbox. */
export function proposeRedeploy(_m: Model): boolean {
  return false;
}

/** Approval of a "redeploy" proposal (agents/actions.ts). */
export function approveRedeploy(_a: Record<string, any>, _inboxId: number): { outcome: string; changed: boolean } {
  return { outcome: "Approved; owner notified.", changed: false };
}
