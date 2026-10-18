// SQLite to Google Cloud mirrors. Firestore: ledger/{IMP-id}, inbox/{id}, activity/{runId}. BigQuery: impact_records,
// social_ledger, skill_coverage (full replace) and activation_events (streamed). Debounced full replaces: the tables
// are small and impact ids are reused after a demo reset, so stale documents are deleted on every pass.
import { all } from "../db.ts";
import { errText, status } from "./gcp.ts";
import { docId, fsPatch, fsReplaceCollection } from "./firestore.ts";
import { bqReplaceMany, bqStream, type ReplaceTable } from "./bigquery.ts";
import { invalidateLedger, ledgerRecords, type LedgerRecord } from "./ledger.ts";
import { getState, setState } from "../agents/store.ts";
import { data } from "../engine/data.ts";
import { capability, eligiblePeople } from "../engine/match.ts";
import { openOpportunities } from "../engine/portfolio.ts";
import { socialLedger } from "../engine/social.ts";

const DEBOUNCE_MS = 1500;
const IDS_KEY = "cloud_ledger_ids";

interface Job { timer: ReturnType<typeof setTimeout> | null; running: boolean; again: boolean }
interface SyncState { ledger: Job; agents: Job; booted: boolean; docs: Record<string, number> }
const G = globalThis as unknown as { __sbSync?: SyncState };
const job = (): Job => ({ timer: null, running: false, again: false });
const S: SyncState = (G.__sbSync ??= { ledger: job(), agents: job(), booted: false, docs: {} });

/** Run fn DEBOUNCE_MS after the last call; a call during a run queues exactly one more run. */
function schedule(j: Job, fn: () => Promise<unknown>): void {
  if (j.running) { j.again = true; return; }
  if (j.timer) clearTimeout(j.timer);
  j.timer = setTimeout(async () => {
    j.timer = null;
    j.running = true;
    try { await fn(); } catch (e) { console.error("[cloud] sync failed:", errText(e)); } finally {
      j.running = false;
      if (j.again) { j.again = false; schedule(j, fn); }
    }
  }, DEBOUNCE_MS);
}

export const scheduleLedger = () => schedule(S.ledger, syncLedger);
export const scheduleAgents = () => schedule(S.agents, syncAgents);

/** First cloud request in this process: push the current state once (a fresh instance may follow a reseed). */
export function ensureBootSync(): void {
  if (S.booted) return;
  S.booted = true;
  scheduleLedger();
  scheduleAgents();
}

function firestoreOk(collection: string, n: number): void {
  S.docs[collection] = n;
  Object.assign(status.firestore, { state: "live", lastSyncAt: new Date().toISOString(), docs: Object.values(S.docs).reduce((a, b) => a + b, 0), lastError: undefined });
}
function firestoreFailed(e: unknown): string {
  const msg = errText(e);
  Object.assign(status.firestore, { state: "error", lastError: msg });
  return msg;
}

// ---------------------------------------------------------------- rows
const bqImpact = (records: LedgerRecord[]) => records.map(({ customer_impact: _c, ...r }) => r);

function socialRows(): Record<string, unknown>[] {
  try {
    return socialLedger(data()).lines.map((l) => ({ metric: l.key, value: l.value, unit: l.unit, basis: l.basis, source: l.live ? "seed+live" : "seed" }));
  } catch (e) {
    console.error("[cloud] social ledger unavailable:", (e as Error).message);
    return [];
  }
}

/** Per skill: experts (capability >= 0.8), capable (>= 0.6) and how many open opportunity roles ask for it. */
export function skillCoverage(): Record<string, unknown>[] {
  const m = data();
  const people = eligiblePeople(m);
  const demand = new Map<string, number>();
  for (const o of openOpportunities()) for (const r of o.roles) for (const s of new Set([...r.must, ...r.nice])) demand.set(s, (demand.get(s) ?? 0) + 1);
  return [...m.skills.values()].map((s) => {
    let experts = 0, capable = 0;
    for (const p of people) {
      const v = capability(m, p, s.id).value;
      if (v >= 0.8) experts++;
      if (v >= 0.6) capable++;
    }
    return { skill_id: s.id, skill: s.name, family: s.family, emerging: !!s.emerging, experts, capable, open_role_demand: demand.get(s.id) ?? 0 };
  });
}

/** Activations not seen in the previous sync go to the append-only activation_events stream. */
async function streamActivations(records: LedgerRecord[]): Promise<number> {
  const prev = new Set(getState<string[]>(IDS_KEY) ?? records.filter((r) => r.source !== "activated" && r.source !== "agent").map((r) => r.id));
  const fresh = records.filter((r) => !prev.has(r.id));
  const at = new Date().toISOString();
  const n = await bqStream("activation_events", fresh.map((r) => ({
    event_id: `${r.id}-${Date.now().toString(36)}`, at, kind: r.source, ref: r.opportunity_id ?? r.id, title: r.title,
    value_amt: r.cost_avoided_amt + r.productivity_amt + r.recruitment_amt + r.revenue_amt, people_count: r.people_count,
  })));
  setState(IDS_KEY, records.map((r) => r.id));
  return n;
}

// ---------------------------------------------------------------- syncs
export interface SyncResult { firestore: Record<string, number>; bigquery: Record<string, number>; streamed: number; errors: string[]; ms: number }

/** Ledger to Firestore and BigQuery (impact_records, social_ledger, optionally skill_coverage) plus new activation events. */
export async function syncLedger(opts: { coverage?: boolean } = {}): Promise<SyncResult> {
  const t = Date.now();
  const out: SyncResult = { firestore: {}, bigquery: {}, streamed: 0, errors: [], ms: 0 };
  const records = ledgerRecords();
  const syncedAt = new Date();
  const fs = fsReplaceCollection("ledger", records.map((r) => ({ id: r.id, data: { ...r, syncedAt } })))
    .then((r) => { out.firestore.ledger = r.written; firestoreOk("ledger", r.written); })
    .catch((e) => { out.errors.push(`firestore ledger: ${firestoreFailed(e)}`); });
  const parts: [ReplaceTable, Record<string, unknown>[]][] = [["impact_records", bqImpact(records)], ["social_ledger", socialRows()]];
  if (opts.coverage) parts.push(["skill_coverage", skillCoverage()]);
  const bq = bqReplaceMany(parts, opts.coverage ? 25000 : 15000)
    .then(() => { for (const [table, rows] of parts) out.bigquery[table] = rows.length; })
    .catch((e) => { out.errors.push(`bigquery replace: ${errText(e)}`); });
  const stream = streamActivations(records)
    .then((n) => { out.streamed = n; })
    .catch((e) => { out.errors.push(`bigquery stream: ${errText(e)}`); });
  await Promise.all([fs, bq, stream]);
  invalidateLedger();
  out.ms = Date.now() - t;
  if (out.errors.length) console.error("[cloud] ledger sync:", out.errors.join("; "));
  return out;
}

/** Agent inbox and the last 25 runs to Firestore. */
export async function syncAgents(): Promise<SyncResult> {
  const t = Date.now();
  const out: SyncResult = { firestore: {}, bigquery: {}, streamed: 0, errors: [], ms: 0 };
  const inbox = all<Record<string, unknown> & { id: number }>(`SELECT id, agent, kind, title, status, value_amt, approver, created_at, decided_at, outcome
    FROM agent_inbox ORDER BY id DESC LIMIT 300`);
  const runs = all<Record<string, unknown> & { id: number }>("SELECT id, agent, trigger, status, summary, started_at FROM agent_runs ORDER BY id DESC LIMIT 25");
  for (const [collection, rows] of [["inbox", inbox], ["activity", runs]] as const) {
    try {
      const r = await fsReplaceCollection(collection, rows.map((x) => ({ id: String(x.id), data: x })));
      out.firestore[collection] = r.written;
      firestoreOk(collection, r.written);
    } catch (e) {
      out.errors.push(`firestore ${collection}: ${firestoreFailed(e)}`);
    }
  }
  out.ms = Date.now() - t;
  return out;
}

/** Full resync (POST /api/cloud/sync): ledger, BigQuery including skill_coverage, inbox and activity. */
export async function fullResync(): Promise<SyncResult> {
  const t = Date.now();
  const [l, a] = await Promise.all([syncLedger({ coverage: true }), syncAgents()]);
  return { firestore: { ...l.firestore, ...a.firestore }, bigquery: l.bigquery, streamed: l.streamed, errors: [...l.errors, ...a.errors], ms: Date.now() - t };
}

/** One mirrored document (crisis plans, community requests). */
export async function mirrorDoc(collection: string, id: string, doc: Record<string, unknown>): Promise<void> {
  try {
    await fsPatch(`${collection}/${docId(id)}`, { ...doc, syncedAt: new Date() });
    S.docs[`${collection}/${docId(id)}`] = 1;
    firestoreOk(`${collection}/${docId(id)}`, 1);
  } catch (e) {
    console.error(`[cloud] mirror ${collection}/${id} failed:`, firestoreFailed(e));
  }
}
