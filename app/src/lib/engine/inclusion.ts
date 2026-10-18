// Inclusion lens (opportunity equity): does opportunity reach people outside headquarters, in remote regions and off
// the org chart? Owned by the value track (T3). Stub: headcount share per location only.
import type { Model } from "./data.ts";
import type { SignalItem } from "../types.ts";
import { isRemote } from "./geo.ts";

export function inclusionItems(m: Model, _offChart: SignalItem[]): SignalItem[] {
  const people = [...m.people.values()].filter((p) => p.level !== "C");
  const total = people.length || 1;
  const byLoc = new Map<string, number>();
  for (const p of people) byLoc.set(p.location_id, (byLoc.get(p.location_id) ?? 0) + 1);
  return [...byLoc.entries()].sort((a, b) => b[1] - a[1]).map(([loc, n], i) => ({
    id: `INC-${loc}`,
    title: m.locations.get(loc) ?? loc,
    subtitle: isRemote(loc) ? "Remote region" : "Office",
    metric: `${Math.round((n / total) * 100)}%`,
    metricLabel: "of headcount",
    facts: [`${n} people`],
    people: [],
    focusId: loc,
    nodeIds: [],
    score: n / total + i * 0,
  }));
}
