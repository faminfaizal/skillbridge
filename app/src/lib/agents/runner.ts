// Agent runner, inside the app server process (so every in-memory cache sees the new data at once).
// Polls the change log every few seconds; a batch of changes runs the Connectivity Agent first, then the agents that
// react to its diff. One run at a time; state lives on globalThis so there is exactly one runner per process.
import { all, get } from "../db.ts";
import { AGENTS } from "./registry.ts";
import { runConnectivity } from "./connectivity.ts";
import { runPeople } from "./people.ts";
import { runScout } from "./scout.ts";
import { runSentinel } from "./sentinel.ts";
import { snapshot, type Snapshot } from "./snapshot.ts";
import { ensureAgentTables, getState, pendingEvents, setState } from "./store.ts";
import type { AgentId, AgentRunView, AgentsView, InboxItem } from "../types.ts";

interface RunnerState { timer: ReturnType<typeof setInterval> | null; busy: boolean; current: AgentId | null; lastError: string }
const G = globalThis as unknown as { __sbAgents?: RunnerState };
const S = (G.__sbAgents ??= { timer: null, busy: false, current: null, lastError: "" });

const POLL_MS = 3000;
const DEBOUNCE_MS = 800;

/** Start the poller (idempotent) and make sure a baseline snapshot exists before any new data arrives. */
export function ensureRunner(): void {
  ensureAgentTables();
  if (!getState<Snapshot>("snapshot")) setState("snapshot", snapshot());
  if (!S.timer) {
    S.timer = setInterval(() => { void tick(); }, POLL_MS);
    S.timer.unref?.();
  }
}

/** Run fn with the runner held: waits for any agent run in flight to finish and blocks new ones meanwhile (used by reset). */
export async function withRunnerLock<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; i < 600 && S.busy; i++) await new Promise((r) => setTimeout(r, 100));
  S.busy = true;
  try {
    return await fn();
  } finally {
    S.busy = false;
  }
}

/** Process pending change events. force: ignore the debounce (used right after a simulated change, and in tests). */
export async function tick(force = false): Promise<{ processed: number }> {
  if (S.busy) return { processed: 0 };
  const events = pendingEvents(force ? 0 : DEBOUNCE_MS);
  if (!events.length) return { processed: 0 };
  S.busy = true;
  try {
    S.current = "connectivity";
    const before = getState<Snapshot>("snapshot") ?? snapshot();
    const c = await runConnectivity(events, before);
    setState("snapshot", c.after);
    setState("graph_version", (getState<number>("graph_version") ?? 0) + 1);
    const touched = new Set(c.people);
    S.current = "people";
    await runPeople(c.diff, touched);
    S.current = "scout";
    await runScout(events, c.diff);
    S.current = "sentinel";
    await runSentinel(c.diff);
    S.lastError = "";
    return { processed: events.length };
  } catch (e) {
    S.lastError = (e as Error).message;
    return { processed: 0 };
  } finally {
    S.busy = false;
    S.current = null;
  }
}

const parse = <T>(s: string | null, d: T): T => { try { return s ? (JSON.parse(s) as T) : d; } catch { return d; } };

export function agentsView(): AgentsView {
  ensureRunner();
  const runs = all<{ id: number; agent: AgentId; trigger: string; status: AgentRunView["status"]; started_at: string; finished_at: string | null; steps: string; summary: string | null; provider: string | null; node_ids: string | null }>(
    "SELECT * FROM agent_runs ORDER BY id DESC LIMIT 25").map((r) => ({
    id: r.id, agent: r.agent, trigger: r.trigger, status: r.status, startedAt: r.started_at, finishedAt: r.finished_at,
    steps: parse(r.steps, []), summary: r.summary ?? "", provider: r.provider ?? "", nodeIds: parse(r.node_ids, []),
  }));
  const inbox: InboxItem[] = all<{ id: number; agent: AgentId; kind: string; title: string; detail: string; evidence: string; value_amt: number; node_ids: string; approver: string; status: InboxItem["status"]; provider: string | null; created_at: string; outcome: string | null }>(
    "SELECT * FROM agent_inbox ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, id DESC LIMIT 40").map((r) => ({
    id: r.id, agent: r.agent, kind: r.kind, title: r.title, detail: r.detail, evidence: parse(r.evidence, []), valueAmt: r.value_amt,
    nodeIds: parse(r.node_ids, []), approver: r.approver, status: r.status, provider: r.provider ?? "", createdAt: r.created_at, outcome: r.outcome,
  }));
  const stats = new Map(all<{ agent: string; n: number; last: string }>("SELECT agent, COUNT(*) n, MAX(started_at) last FROM agent_runs GROUP BY agent").map((r) => [r.agent, r]));
  return {
    agents: AGENTS.map((a) => ({ ...a, state: S.current === a.id ? "running" : "idle", lastRun: stats.get(a.id)?.last ?? null, runs: stats.get(a.id)?.n ?? 0 })),
    runs, inbox,
    pending: get<{ n: number }>("SELECT COUNT(*) n FROM agent_inbox WHERE status = 'pending'")?.n ?? 0,
    busy: S.busy,
    graphVersion: getState<number>("graph_version") ?? 0,
    queued: get<{ n: number }>("SELECT COUNT(*) n FROM change_events WHERE processed_at IS NULL")?.n ?? 0,
  };
}
