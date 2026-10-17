// What the lenses say right now, and what changed since the last agent run. The Connectivity Agent hands this diff
// to the other agents, so each one reacts only to what is new.
import { all } from "../db.ts";
import { discover } from "../engine/discover.ts";
import { SIGNAL_KINDS, signals } from "../engine/signals.ts";
import { concentrationRisks } from "../engine/whatif.ts";
import type { DiscoveryCard, SignalItem, SignalKind } from "../types.ts";

export interface Snapshot {
  at: string;
  signals: Record<string, Record<string, string>>;   // kind -> item id -> fingerprint
  risks: Record<string, number>;                       // system id -> concentration share
  cards: Record<string, string>;                       // discovery card id -> metric
  inferred: string[];                                  // person:skill
}

export interface GraphDiff {
  signals: Record<SignalKind, { added: SignalItem[]; changed: { item: SignalItem; before: string }[] }>;
  risks: { systemId: string; name: string; before: number; after: number; people: { id: string; name: string; retirementRisk: number }[] }[];
  cards: DiscoveryCard[];
  inferred: { personId: string; skillId: string }[];
  count: number;
}

const fingerprint = (it: SignalItem) => `${it.metric}|${it.facts.join("|")}`;

export function snapshot(): Snapshot {
  return {
    at: new Date().toISOString(),
    signals: Object.fromEntries(SIGNAL_KINDS.map((k) => [k, Object.fromEntries(signals(k).items.map((it) => [it.id, fingerprint(it)]))])),
    risks: Object.fromEntries(concentrationRisks().map((r) => [r.systemId, r.share])),
    cards: Object.fromEntries(discover().cards.map((c) => [c.id, c.metric])),
    inferred: all<{ k: string }>("SELECT person_id || ':' || skill_id k FROM inferred_skills").map((r) => r.k),
  };
}

/** Diff between a stored snapshot and the current state (current lenses must already be refreshed). */
export function diff(before: Snapshot, after: Snapshot): GraphDiff {
  const sig = {} as GraphDiff["signals"];
  let count = 0;
  for (const k of SIGNAL_KINDS) {
    const prev = before.signals[k] ?? {};
    const items = signals(k).items;
    const added = items.filter((it) => !(it.id in prev));
    const changed = items.filter((it) => it.id in prev && prev[it.id] !== fingerprint(it)).map((it) => ({ item: it, before: prev[it.id].split("|")[0] }));
    sig[k] = { added, changed };
    count += added.length + changed.length;
  }
  const risks = concentrationRisks()
    .filter((r) => (before.risks[r.systemId] ?? 0) < r.share - 0.001)
    .map((r) => ({ systemId: r.systemId, name: r.name, before: before.risks[r.systemId] ?? 0, after: r.share, people: r.people }));
  const cards = discover().cards.filter((c) => !(c.id in before.cards) || before.cards[c.id] !== c.metric);
  const known = new Set(before.inferred);
  const inferred = after.inferred.filter((k) => !known.has(k)).map((k) => { const [personId, skillId] = k.split(":"); return { personId, skillId }; });
  return { signals: sig, risks, cards, inferred, count: count + risks.length + cards.length + inferred.length };
}
