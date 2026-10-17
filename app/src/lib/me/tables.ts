// Self-service profile tables, created on first use (like the agent tables) so a database rebuilt from the seed
// needs no migration. profile_trace records every change made to a seeded table, so reset restores the seed exactly.
import { all, get, getDb, run } from "../db.ts";

const DDL = `
CREATE TABLE IF NOT EXISTS profile_about (person_id TEXT PRIMARY KEY, headline TEXT NOT NULL DEFAULT '', bio TEXT NOT NULL DEFAULT '',
  languages TEXT NOT NULL DEFAULT '[]', location_pref TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS profile_projects (id TEXT PRIMARY KEY, person_id TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL,
  role TEXT NOT NULL, start_month TEXT NOT NULL, end_month TEXT, effort TEXT NOT NULL DEFAULT '', contribution TEXT NOT NULL DEFAULT '',
  skills TEXT NOT NULL DEFAULT '[]', link TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', decided_by TEXT,
  decided_at TEXT, decline_note TEXT, project_id TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS profile_skill_meta (person_id TEXT NOT NULL, skill_id TEXT NOT NULL, want_grow INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (person_id, skill_id));
CREATE TABLE IF NOT EXISTS profile_validations (person_id TEXT NOT NULL, skill_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  decided_by TEXT, decided_at TEXT, created_at TEXT NOT NULL, PRIMARY KEY (person_id, skill_id));
CREATE TABLE IF NOT EXISTS profile_evidence (id TEXT PRIMARY KEY, person_id TEXT NOT NULL, skill_id TEXT NOT NULL, kind TEXT NOT NULL,
  ref_id TEXT, note TEXT NOT NULL DEFAULT '', date TEXT NOT NULL, hidden INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS profile_documents (id TEXT PRIMARY KEY, person_id TEXT NOT NULL, filename TEXT NOT NULL, kind TEXT NOT NULL,
  mime TEXT NOT NULL, size INTEGER NOT NULL, path TEXT NOT NULL, excerpt TEXT NOT NULL DEFAULT '', ai TEXT NOT NULL DEFAULT 'rules',
  shared INTEGER NOT NULL DEFAULT 0, uploaded_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS profile_doc_skills (doc_id TEXT NOT NULL, skill_id TEXT NOT NULL, level INTEGER NOT NULL, quote TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'suggested', PRIMARY KEY (doc_id, skill_id));
CREATE TABLE IF NOT EXISTS profile_certs (id TEXT PRIMARY KEY, person_id TEXT NOT NULL, name TEXT NOT NULL, issuer TEXT NOT NULL DEFAULT '',
  issued TEXT NOT NULL DEFAULT '', expiry TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS profile_connections (id TEXT PRIMARY KEY, person_id TEXT NOT NULL, other_id TEXT NOT NULL, kind TEXT NOT NULL,
  skill_id TEXT, rec_id TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS profile_feedback (id TEXT PRIMARY KEY, from_id TEXT NOT NULL, to_id TEXT NOT NULL, rec_id TEXT, skill_id TEXT,
  project_id TEXT, text TEXT NOT NULL DEFAULT '', thanked INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS profile_feedback_requests (id TEXT PRIMARY KEY, from_id TEXT NOT NULL, to_id TEXT NOT NULL, project_id TEXT,
  status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS profile_suggestion_decisions (person_id TEXT NOT NULL, skill_id TEXT NOT NULL, decision TEXT NOT NULL,
  created_at TEXT NOT NULL, PRIMARY KEY (person_id, skill_id));
CREATE TABLE IF NOT EXISTS profile_growth (person_id TEXT PRIMARY KEY, interests TEXT NOT NULL DEFAULT '[]', goals TEXT NOT NULL DEFAULT '',
  target_roles TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS profile_availability (person_id TEXT PRIMARY KEY, open_projects INTEGER NOT NULL DEFAULT 0,
  open_sme INTEGER NOT NULL DEFAULT 0, open_mentoring INTEGER NOT NULL DEFAULT 0, until TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS profile_privacy (person_id TEXT NOT NULL, section TEXT NOT NULL, audience TEXT NOT NULL, PRIMARY KEY (person_id, section));
CREATE TABLE IF NOT EXISTS profile_hidden (person_id TEXT NOT NULL, kind TEXT NOT NULL, ref_id TEXT NOT NULL, PRIMARY KEY (person_id, kind, ref_id));
CREATE TABLE IF NOT EXISTS profile_reports (id TEXT PRIMARY KEY, person_id TEXT NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL,
  message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS profile_changes (id INTEGER PRIMARY KEY AUTOINCREMENT, person_id TEXT NOT NULL, actor_id TEXT NOT NULL,
  section TEXT NOT NULL, summary TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS profile_trace (id INTEGER PRIMARY KEY AUTOINCREMENT, person_id TEXT NOT NULL, tbl TEXT NOT NULL,
  key TEXT NOT NULL, original TEXT, at TEXT NOT NULL);
`;

let ready = false;
export function ensureProfileTables(): void {
  if (ready) return;
  getDb().exec(DDL);
  ready = true;
}

/** Profile tables the person owns outright: reset deletes their rows. */
export const OWN_TABLES: [string, string][] = [
  ["profile_about", "person_id"], ["profile_projects", "person_id"], ["profile_skill_meta", "person_id"], ["profile_validations", "person_id"],
  ["profile_evidence", "person_id"], ["profile_certs", "person_id"], ["profile_connections", "person_id"], ["profile_feedback", "from_id"],
  ["profile_feedback_requests", "from_id"], ["profile_suggestion_decisions", "person_id"], ["profile_growth", "person_id"],
  ["profile_availability", "person_id"], ["profile_privacy", "person_id"], ["profile_hidden", "person_id"], ["profile_reports", "person_id"],
  ["profile_changes", "person_id"],
];

// ---------------------------------------------------------------- change tracking for seeded tables
const KEYS: Record<string, string[]> = {
  person_skills: ["person_id", "skill_id"],
  person_certs: ["person_id", "cert_id"],
  projects: ["id"],
  project_skills: ["project_id", "skill_id"],
  assignments: ["id"],
  peer_recognition: ["id"],
  people: ["id"],
};

const where = (tbl: string) => KEYS[tbl].map((k) => `${k} = ?`).join(" AND ");
const keyVals = (tbl: string, key: Record<string, string>) => KEYS[tbl].map((k) => key[k]);

/** Call before changing or deleting a seeded row: the first call per row keeps its original for reset. */
export function traceChange(personId: string, tbl: string, key: Record<string, string>): void {
  const k = JSON.stringify(keyVals(tbl, key));
  if (get("SELECT 1 FROM profile_trace WHERE tbl = ? AND key = ?", tbl, k)) return;
  const row = get<Record<string, unknown>>(`SELECT * FROM ${tbl} WHERE ${where(tbl)}`, ...keyVals(tbl, key));
  run("INSERT INTO profile_trace (person_id, tbl, key, original, at) VALUES (?, ?, ?, ?, ?)", personId, tbl, k,
    row ? JSON.stringify(row) : null, new Date().toISOString());
}

/** Call after inserting a new row into a seeded table: reset deletes it. */
export function traceInsert(personId: string, tbl: string, key: Record<string, string>): void {
  traceChange(personId, tbl, key);
}

/** Undo every traced change (for one person, or everyone), newest first, then clear their profile tables. */
export function restoreTraced(personId?: string): number {
  ensureProfileTables();
  const rows = all<{ id: number; tbl: string; key: string; original: string | null }>(
    personId ? "SELECT * FROM profile_trace WHERE person_id = ? ORDER BY id DESC" : "SELECT * FROM profile_trace ORDER BY id DESC",
    ...(personId ? [personId] : []));
  // Count what is being undone: traced seed rows plus logged profile changes (headline, documents, settings)
  const changes = get<{ n: number }>(personId ? "SELECT COUNT(*) n FROM profile_changes WHERE person_id = ?" : "SELECT COUNT(*) n FROM profile_changes",
    ...(personId ? [personId] : []))?.n ?? 0;
  const db = getDb();
  db.exec("BEGIN");
  try {
    for (const r of rows) {
      const vals = JSON.parse(r.key) as string[];
      if (!r.original) {
        run(`DELETE FROM ${r.tbl} WHERE ${where(r.tbl)}`, ...vals);
      } else {
        const o = JSON.parse(r.original) as Record<string, string | number | null>;
        const cols = Object.keys(o);
        // Update in place when the row still exists (people rows are referenced by foreign keys); re-insert when deleted
        if (get(`SELECT 1 FROM ${r.tbl} WHERE ${where(r.tbl)}`, ...vals)) {
          run(`UPDATE ${r.tbl} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE ${where(r.tbl)}`, ...cols.map((c) => o[c]), ...vals);
        } else {
          run(`INSERT INTO ${r.tbl} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, ...cols.map((c) => o[c]));
        }
      }
      run("DELETE FROM profile_trace WHERE id = ?", r.id);
    }
    for (const [t, col] of OWN_TABLES) run(personId ? `DELETE FROM ${t} WHERE ${col} = ?` : `DELETE FROM ${t}`, ...(personId ? [personId] : []));
    if (personId) {
      run("DELETE FROM profile_doc_skills WHERE doc_id IN (SELECT id FROM profile_documents WHERE person_id = ?)", personId);
      run("DELETE FROM profile_documents WHERE person_id = ?", personId);
      run("DELETE FROM profile_feedback_requests WHERE to_id = ?", personId);
    } else {
      run("DELETE FROM profile_doc_skills");
      run("DELETE FROM profile_documents");
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return rows.length + changes;
}
