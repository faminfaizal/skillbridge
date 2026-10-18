// Agent state in SQLite: the change log (filled by database triggers on every data insert), agent runs, the proposal
// inbox, purchase requests (a new data source the Opportunity Scout watches) and small key/value state.
import { all, get, getDb, run } from "../db.ts";
import { agentsChanged } from "../cloud/index.ts";

let ready = false;

// every insert into these tables becomes a change event; person_ids lets the agents scope their work
const WATCHED: { table: string; kind: string; id: string; people: string; payload: string }[] = [
  { table: "assignments", kind: "assignment", id: "NEW.id", people: "NEW.person_id", payload: "json_object('project_id', NEW.project_id, 'role', NEW.role)" },
  { table: "incident_resolvers", kind: "incident_resolved", id: "NEW.incident_id", people: "NEW.person_id", payload: "json_object('incident_id', NEW.incident_id)" },
  { table: "incidents", kind: "incident", id: "NEW.id", people: "NULL", payload: "json_object('system_id', NEW.system_id, 'severity', NEW.severity)" },
  { table: "customer_cases", kind: "customer_case", id: "NEW.id", people: "NEW.resolver_id", payload: "json_object('org_id', NEW.org_id, 'problem_class_id', NEW.problem_class_id)" },
  { table: "knowledge_items", kind: "knowledge", id: "NEW.id", people: "NEW.author_id", payload: "json_object('title', NEW.title, 'project_id', NEW.project_id, 'system_id', NEW.system_id)" },
  { table: "opportunities", kind: "opportunity", id: "NEW.id", people: "NULL", payload: "json_object('title', NEW.title, 'org_id', NEW.org_id)" },
  { table: "peer_recognition", kind: "recognition", id: "NEW.id", people: "NEW.to_id", payload: "json_object('from_id', NEW.from_id, 'project_id', NEW.project_id)" },
  { table: "person_skills", kind: "skill_declared", id: "NEW.person_id || ':' || NEW.skill_id", people: "NEW.person_id", payload: "json_object('skill_id', NEW.skill_id, 'level', NEW.level)" },
  { table: "purchase_requests", kind: "purchase_request", id: "NEW.id", people: "NULL", payload: "json_object('skill_id', NEW.skill_id, 'cost_amt', NEW.cost_amt)" },
];

export function ensureAgentTables(): void {
  if (ready) return;
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS change_events (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, entity_id TEXT NOT NULL, person_ids TEXT,
      payload TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL, processed_at TEXT);
    CREATE TABLE IF NOT EXISTS agent_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, agent TEXT NOT NULL, trigger TEXT NOT NULL, status TEXT NOT NULL,
      started_at TEXT NOT NULL, finished_at TEXT, steps TEXT NOT NULL, summary TEXT, provider TEXT, event_ids TEXT, node_ids TEXT);
    CREATE TABLE IF NOT EXISTS agent_inbox (id INTEGER PRIMARY KEY AUTOINCREMENT, agent TEXT NOT NULL, run_id INTEGER, kind TEXT NOT NULL,
      title TEXT NOT NULL, detail TEXT NOT NULL, evidence TEXT NOT NULL, value_amt INTEGER NOT NULL DEFAULT 0, node_ids TEXT NOT NULL,
      approver TEXT NOT NULL, action TEXT NOT NULL, status TEXT NOT NULL, dedupe_key TEXT UNIQUE, provider TEXT, created_at TEXT NOT NULL,
      decided_at TEXT, outcome TEXT);
    CREATE TABLE IF NOT EXISTS agent_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS purchase_requests (id TEXT PRIMARY KEY, vendor_org_id TEXT NOT NULL, skill_id TEXT NOT NULL, days INTEGER NOT NULL,
      cost_amt INTEGER NOT NULL, requested_by TEXT, description TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
  `);
  for (const w of WATCHED) {
    getDb().exec(`CREATE TRIGGER IF NOT EXISTS trg_change_${w.table} AFTER INSERT ON ${w.table} BEGIN
      INSERT INTO change_events (kind, entity_id, person_ids, payload, source, created_at)
      VALUES ('${w.kind}', ${w.id}, ${w.people}, ${w.payload}, 'db-trigger', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
    END;`);
  }
  ready = true;
}

export interface ChangeEvent { id: number; kind: string; entity_id: string; person_ids: string | null; payload: string; source: string; created_at: string }

export function pendingEvents(olderThanMs = 0): ChangeEvent[] {
  ensureAgentTables();
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  return all<ChangeEvent>("SELECT * FROM change_events WHERE processed_at IS NULL AND created_at <= ? ORDER BY id", cutoff);
}

export function markProcessed(ids: number[]): void {
  if (!ids.length) return;
  run(`UPDATE change_events SET processed_at = ? WHERE id IN (${ids.map(() => "?").join(",")})`, new Date().toISOString(), ...ids);
}

export interface Step { tool: string; detail: string; ms: number; ai?: boolean }

export function startRun(agent: string, trigger: string, eventIds: number[] = []): number {
  ensureAgentTables();
  run("INSERT INTO agent_runs (agent, trigger, status, started_at, steps, event_ids) VALUES (?, ?, 'running', ?, '[]', ?)",
    agent, trigger, new Date().toISOString(), eventIds.join(","));
  return get<{ id: number }>("SELECT MAX(id) id FROM agent_runs")!.id;
}

export function finishRun(id: number, status: "done" | "failed", steps: Step[], summary: string, provider: string, nodeIds: string[] = []): void {
  run("UPDATE agent_runs SET status = ?, finished_at = ?, steps = ?, summary = ?, provider = ?, node_ids = ? WHERE id = ?",
    status, new Date().toISOString(), JSON.stringify(steps), summary, provider, JSON.stringify([...new Set(nodeIds)].slice(0, 200)), id);
  agentsChanged("run");
}

export interface Proposal {
  agent: string; runId: number; kind: string; title: string; detail: string; evidence: string[]; valueAmt: number;
  nodeIds: string[]; approver: string; action: Record<string, unknown>; dedupeKey: string; provider: string;
}

/** Adds a proposal unless the same one is already pending or decided (dedupe key). Returns true when new. */
export function propose(p: Proposal): boolean {
  if (get("SELECT 1 x FROM agent_inbox WHERE dedupe_key = ?", p.dedupeKey)) return false;
  run(`INSERT INTO agent_inbox (agent, run_id, kind, title, detail, evidence, value_amt, node_ids, approver, action, status, dedupe_key, provider, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    p.agent, p.runId, p.kind, p.title, p.detail, JSON.stringify(p.evidence), Math.round(p.valueAmt), JSON.stringify(p.nodeIds), p.approver,
    JSON.stringify(p.action), p.dedupeKey, p.provider, new Date().toISOString());
  agentsChanged("propose");
  return true;
}

export function getState<T>(key: string): T | null {
  ensureAgentTables();
  const r = get<{ value: string }>("SELECT value FROM agent_state WHERE key = ?", key);
  return r ? (JSON.parse(r.value) as T) : null;
}

export function setState(key: string, value: unknown): void {
  run("INSERT OR REPLACE INTO agent_state (key, value) VALUES (?, ?)", key, JSON.stringify(value));
}

export const today = () => new Date().toISOString().slice(0, 10);
