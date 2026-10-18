// BigQuery over REST: parameterised queries (jobs.query), full-table replace for the analytics tables and streaming
// inserts for the append-only activation_events table. Row data always travels as a query parameter, never as SQL text.
import { gcpRequest, projectId, status } from "./gcp.ts";
import { env } from "../env.ts";

const LOCATION = "us-central1";
type Col = [name: string, type: "STRING" | "DATE" | "INT64" | "FLOAT64" | "BOOL" | "TIMESTAMP"];

/** Tables this app writes, with their columns in order. synced_at is always set by BigQuery (CURRENT_TIMESTAMP). */
export const TABLES = {
  impact_records: [["id", "STRING"], ["date", "DATE"], ["title", "STRING"], ["opportunity_id", "STRING"], ["people_count", "INT64"],
    ["cost_avoided_amt", "INT64"], ["productivity_amt", "INT64"], ["recruitment_amt", "INT64"], ["revenue_amt", "INT64"],
    ["strategic_value", "STRING"], ["source", "STRING"], ["synced_at", "TIMESTAMP"]],
  social_ledger: [["metric", "STRING"], ["value", "FLOAT64"], ["unit", "STRING"], ["basis", "STRING"], ["source", "STRING"], ["synced_at", "TIMESTAMP"]],
  skill_coverage: [["skill_id", "STRING"], ["skill", "STRING"], ["family", "STRING"], ["emerging", "BOOL"], ["experts", "INT64"],
    ["capable", "INT64"], ["open_role_demand", "INT64"], ["synced_at", "TIMESTAMP"]],
} satisfies Record<string, Col[]>;
export type ReplaceTable = keyof typeof TABLES;

export function dataset(): string {
  const d = env("BQ_DATASET", "skillbridge");
  if (!/^\w{1,100}$/.test(d)) throw new Error("BQ_DATASET is not a valid dataset id");
  return d;
}
export const tableRef = (t: string) => `\`${projectId()}.${dataset()}.${t}\``;

export type BqParam = string | number | boolean | null;
interface QueryResponse {
  jobComplete?: boolean;
  jobReference?: { jobId?: string };
  schema?: { fields?: { name: string; type: string }[] };
  rows?: { f: { v: unknown }[] }[];
  numDmlAffectedRows?: string;
}

function param(name: string, v: BqParam) {
  const type = typeof v === "number" ? (Number.isInteger(v) ? "INT64" : "FLOAT64") : typeof v === "boolean" ? "BOOL" : "STRING";
  return { name, parameterType: { type }, parameterValue: { value: v === null ? null : String(v) } };
}

function cell(v: unknown, type: string): unknown {
  if (v === null || v === undefined) return null;
  if (type === "INTEGER" || type === "INT64" || type === "FLOAT" || type === "FLOAT64" || type === "NUMERIC") return Number(v);
  if (type === "BOOLEAN" || type === "BOOL") return v === "true" || v === true;
  return v;
}

/** Run one standard-SQL query or script with named parameters. Rows come back as plain objects. */
export async function bqQuery<T = Record<string, unknown>>(sql: string, params: Record<string, BqParam> = {}, timeoutMs = 8000): Promise<{ rows: T[]; jobId: string; ms: number }> {
  const t = Date.now();
  try {
    const r = await gcpRequest<QueryResponse>(`https://bigquery.googleapis.com/bigquery/v2/projects/${projectId()}/queries`, {
      method: "POST", timeoutMs,
      data: {
        query: sql, useLegacySql: false, location: LOCATION, parameterMode: "NAMED", timeoutMs: Math.max(1000, timeoutMs - 500),
        queryParameters: Object.entries(params).map(([k, v]) => param(k, v)),
      },
    });
    if (r.jobComplete === false) throw new Error("query did not finish in time");
    const fields = r.schema?.fields ?? [];
    const rows = (r.rows ?? []).map((row) => Object.fromEntries(fields.map((f, i) => [f.name, cell(row.f[i]?.v, f.type)])) as T);
    const ms = Date.now() - t;
    Object.assign(status.bigquery, { state: "live", lastQueryMs: ms, lastError: undefined });
    return { rows, jobId: r.jobReference?.jobId ?? "", ms };
  } catch (e) {
    Object.assign(status.bigquery, { state: "error", lastError: (e as Error).message.slice(0, 200) });
    throw e;
  }
}

/** The replace statements for one table: TRUNCATE, then INSERT from the JSON array in @<param> with typed casts. */
export function replaceScript(table: ReplaceTable, paramName = "rows"): string {
  const cols = TABLES[table] as Col[];
  const sel = cols.map(([name, type]) => (name === "synced_at" ? "CURRENT_TIMESTAMP()"
    : type === "STRING" ? `JSON_VALUE(r, '$.${name}')` : `SAFE_CAST(JSON_VALUE(r, '$.${name}') AS ${type})`));
  return `TRUNCATE TABLE ${tableRef(table)};\nINSERT INTO ${tableRef(table)} (${cols.map((c) => c[0]).join(", ")})\n`
    + `SELECT ${sel.join(", ")} FROM UNNEST(JSON_QUERY_ARRAY(@${paramName})) AS r;`;
}

// One replace script at a time: overlapping TRUNCATE/INSERT jobs on the same table fail to serialise
let lock: Promise<unknown> = Promise.resolve();

/** Replace several tables in ONE script job; each table's rows travel as one JSON string parameter. */
export async function bqReplaceMany(parts: [ReplaceTable, Record<string, unknown>[]][], timeoutMs = 15000): Promise<{ rows: number; ms: number; jobId: string }> {
  const run = lock.then(async () => {
    const params: Record<string, string> = {};
    const sql = parts.map(([table, rows], i) => { params[`rows${i}`] = JSON.stringify(rows); return replaceScript(table, `rows${i}`); }).join("\n");
    const r = await bqQuery(sql, params, timeoutMs);
    status.bigquery.lastSyncAt = new Date().toISOString();
    return { rows: parts.reduce((a, p) => a + p[1].length, 0), ms: r.ms, jobId: r.jobId };
  });
  lock = run.catch(() => null);
  return run;
}

/** Replace every row of a table with rows (rows passed as ONE string parameter, never as SQL text). */
export async function bqReplace(table: ReplaceTable, rows: Record<string, unknown>[], timeoutMs = 15000): Promise<number> {
  return (await bqReplaceMany([[table, rows]], timeoutMs)).rows;
}

/** Streaming insert, only for the append-only activation_events table (DML on streamed rows fails for a while). */
export async function bqStream(table: "activation_events", rows: (Record<string, unknown> & { event_id: string })[], timeoutMs = 5000): Promise<number> {
  if (!rows.length) return 0;
  const r = await gcpRequest<{ insertErrors?: unknown[] }>(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId()}/datasets/${dataset()}/tables/${table}/insertAll`,
    { method: "POST", timeoutMs, data: { rows: rows.map((json) => ({ insertId: json.event_id, json })) } });
  if (r.insertErrors?.length) throw new Error(`insertAll rejected ${r.insertErrors.length} row(s): ${JSON.stringify(r.insertErrors[0]).slice(0, 200)}`);
  return rows.length;
}
