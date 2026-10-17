// SQLite access via Node's built-in node:sqlite (no native build, no install). Schema: data/schema.sql.
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

type Param = string | number | null;
let db: DatabaseSync | null = null;

export function dbPath(): string {
  return process.env.SKILLBRIDGE_DB || path.resolve(process.cwd(), "../data/skillbridge.db");
}

export function getDb(): DatabaseSync {
  if (!db) {
    db = new DatabaseSync(dbPath());
    db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;");
  }
  return db;
}

export function all<T>(sql: string, ...params: Param[]): T[] {
  return getDb().prepare(sql).all(...params) as T[];
}

export function get<T>(sql: string, ...params: Param[]): T | undefined {
  return getDb().prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, ...params: Param[]): void {
  getDb().prepare(sql).run(...params);
}

export function financeParams(): Record<string, unknown> {
  const rows = all<{ key: string; value: string }>("SELECT key, value FROM finance_params");
  return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
}
