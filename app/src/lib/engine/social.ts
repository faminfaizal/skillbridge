// Social and environmental value ledger: CO2e avoided, jobs kept, volunteer hours, remote-region opportunity and
// downtime avoided, each with its basis. Owned by the value track (T3). Stub: an empty ledger.
import type { Model } from "./data.ts";

export interface SocialLine {
  key: "co2e" | "jobs" | "volunteer" | "remote" | "downtime";
  label: string;
  value: number;
  unit: string;
  seed: number;          // from the seeded history
  live: number;          // from approvals made in the app
  basis: string;         // how it is counted
}

export interface SocialLedger { lines: SocialLine[]; assumptions: string[] }

export function socialLedger(_m?: Model): SocialLedger {
  return { lines: [], assumptions: [] };
}

export async function socialStatement(l: SocialLedger): Promise<{ text: string; provider: string; grounded: boolean }> {
  return { text: l.lines.length ? "" : "No social or environmental value recorded yet.", provider: "template", grounded: true };
}
