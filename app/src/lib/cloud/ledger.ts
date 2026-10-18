// Public impact ledger (Firestore mirror, SQLite fallback) and value by quarter (BigQuery, SQLite fallback).
// Ledger records never carry person ids or names: only whitelisted columns leave SQLite.
import { all, get } from "../db.ts";
import { cloudOn } from "./index.ts";
import { fsList } from "./firestore.ts";
import { bqQuery, tableRef } from "./bigquery.ts";

export interface LedgerRecord {
  id: string; date: string; title: string; opportunity_id: string | null; people_count: number;
  cost_avoided_amt: number; productivity_amt: number; recruitment_amt: number; revenue_amt: number;
  customer_impact: string; strategic_value: string; source: string;
}
export interface LedgerTotals { costAvoided: number; productivity: number; recruitment: number; revenue: number; total: number; activations: number; people: number }
export interface LedgerView { source: "firestore" | "sqlite"; records: LedgerRecord[]; totals: LedgerTotals; syncedAt: string | null }
export interface QuarterRow { quarter: string; activations: number; value: number }
export interface QuartersView { source: "bigquery" | "sqlite"; rows: QuarterRow[]; jobMs?: number; jobId?: string }

const COLS = ["id", "date", "title", "opportunity_id", "people_count", "cost_avoided_amt", "productivity_amt", "recruitment_amt", "revenue_amt",
  "customer_impact", "strategic_value", "source"] as const;
const NUM = new Set(["people_count", "cost_avoided_amt", "productivity_amt", "recruitment_amt", "revenue_amt"]);

export function ledgerRecords(): LedgerRecord[] {
  return all<LedgerRecord>(`SELECT ${COLS.join(", ")} FROM impact_records ORDER BY date DESC, id DESC`);
}

export function ledgerTotals(records: LedgerRecord[]): LedgerTotals {
  const sum = (k: keyof LedgerRecord) => records.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  const t = { costAvoided: sum("cost_avoided_amt"), productivity: sum("productivity_amt"), recruitment: sum("recruitment_amt"), revenue: sum("revenue_amt") };
  return { ...t, total: t.costAvoided + t.productivity + t.recruitment + t.revenue, activations: records.length, people: sum("people_count") };
}

/** Only the public columns of a mirrored document, typed. */
function pick(d: Record<string, unknown>): LedgerRecord {
  const o: Record<string, unknown> = {};
  for (const c of COLS) o[c] = NUM.has(c) ? Number(d[c] ?? 0) : d[c] === null || d[c] === undefined ? (c === "opportunity_id" ? null : "") : String(d[c]);
  return o as unknown as LedgerRecord;
}

const byDateDesc = (a: LedgerRecord, b: LedgerRecord) => (a.date === b.date ? (a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1);
const G = globalThis as unknown as { __sbLedgerCache?: { at: number; view: LedgerView } | null; __sbQuarters?: { at: number; view: QuartersView } | null };

function localLedger(): LedgerView {
  const records = ledgerRecords();
  return { source: "sqlite", records, totals: ledgerTotals(records), syncedAt: null };
}

/** The ledger as the public sees it: the Firestore mirror when cloud is on and reachable, else SQLite. */
export async function ledgerView(): Promise<LedgerView> {
  if (!cloudOn()) return localLedger();
  const c = G.__sbLedgerCache;
  if (c && Date.now() - c.at < 2000) return c.view;
  try {
    const docs = await fsList("ledger", 2500);
    const local = get<{ n: number }>("SELECT COUNT(*) n FROM impact_records")?.n ?? 0;
    if (!docs.length && local) return localLedger(); // mirror not written yet
    const records = docs.map((d) => pick(d.data)).sort(byDateDesc);
    const synced = docs.map((d) => d.data.syncedAt).filter((x): x is Date => x instanceof Date).map((x) => x.toISOString()).sort();
    const view: LedgerView = { source: "firestore", records, totals: ledgerTotals(records), syncedAt: synced[synced.length - 1] ?? null };
    G.__sbLedgerCache = { at: Date.now(), view };
    return view;
  } catch (e) {
    console.error("[cloud] ledger read from Firestore failed:", (e as Error).message);
    return localLedger();
  }
}

export function invalidateLedger(): void {
  G.__sbLedgerCache = null;
  G.__sbQuarters = null;
}

/** Value by calendar quarter from SQLite (the same aggregation BigQuery runs). */
export function quartersSqlite(): QuarterRow[] {
  return all<QuarterRow>(`SELECT substr(date, 1, 4) || ' Q' || ((CAST(substr(date, 6, 2) AS INTEGER) + 2) / 3) AS quarter, COUNT(*) AS activations,
    SUM(cost_avoided_amt + productivity_amt + recruitment_amt + revenue_amt) AS value FROM impact_records GROUP BY quarter ORDER BY quarter`)
    .map((r) => ({ quarter: r.quarter, activations: Number(r.activations), value: Number(r.value) }));
}

/** Value by quarter from BigQuery (cached 15 s), SQLite when cloud is off, BigQuery fails or has not been synced yet. */
export async function valueQuarters(): Promise<QuartersView> {
  if (!cloudOn()) return { source: "sqlite", rows: quartersSqlite() };
  const c = G.__sbQuarters;
  if (c && Date.now() - c.at < 15000) return c.view;
  let view: QuartersView;
  try {
    const r = await bqQuery<QuarterRow>(`SELECT FORMAT('%d Q%d', EXTRACT(YEAR FROM date), EXTRACT(QUARTER FROM date)) AS quarter, COUNT(*) AS activations,
      SUM(cost_avoided_amt + productivity_amt + recruitment_amt + revenue_amt) AS value FROM ${tableRef("impact_records")} GROUP BY quarter ORDER BY quarter`, {}, 6000);
    const rows = r.rows.map((x) => ({ quarter: String(x.quarter), activations: Number(x.activations), value: Number(x.value ?? 0) }));
    if (!rows.length && quartersSqlite().length) throw new Error("BigQuery impact_records not synced yet");
    view = { source: "bigquery", rows, jobMs: r.ms, jobId: r.jobId };
  } catch (e) {
    console.error("[cloud] quarters from BigQuery failed:", (e as Error).message);
    view = { source: "sqlite", rows: quartersSqlite() };
  }
  G.__sbQuarters = { at: view.source === "bigquery" ? Date.now() : Date.now() - 10000, view }; // retry BigQuery after 5 s
  return view;
}
