// Concierge conversation memory: the last 6 turns per session, in process first, mirrored to Firestore sessions/{sid}
// (best effort: 1.2 s cap on reads, async writes, expiresAt 24 h for a TTL policy). Lets follow-ups ("what about
// them?") reach the Concierge with context. Works the same with Firestore unreachable or cloud off.
import { cloudOn } from "./index.ts";
import { capped } from "./gcp.ts";
import { fsGet, fsPatch } from "./firestore.ts";

export interface Turn { q: string; a: string; kind: string; tools: string[]; evidence: string; at: number }
export type MemorySource = "memory" | "firestore" | "none";
export interface Remote { load(sid: string): Promise<Turn[] | null>; save(sid: string, turns: Turn[]): Promise<void> }

const MAX_TURNS = 6;
const MAX_SESSIONS = 500;
const TTL_MS = 24 * 3600_000;
const FOLLOW_UP_MS = 10 * 60_000;
export const FOLLOW_UP = /^(and|what about|how about|who else|why|tell me more|same for)\b/i;
// a pronoun only marks a follow-up in a short question: a long staffing request ("... so they can start in May") stands alone
const LEANS_ON = /\b(them|they|those|her|him|his|that one)\b/i;
const SHORT_WORDS = 8;

const G = globalThis as unknown as { __sbMemory?: Map<string, Turn[]> };
const mem = (G.__sbMemory ??= new Map<string, Turn[]>());

const firestore: Remote = {
  async load(sid) {
    const d = await fsGet(`sessions/${sid}`, 1200);
    if (!d || !Array.isArray(d.turns)) return null;
    if (d.expiresAt instanceof Date && d.expiresAt.getTime() < Date.now()) return null;
    return (d.turns as Record<string, unknown>[]).map((t) => ({
      q: String(t.q ?? ""), a: String(t.a ?? ""), kind: String(t.kind ?? ""), tools: Array.isArray(t.tools) ? t.tools.map(String) : [],
      evidence: String(t.evidence ?? ""), at: Number(t.at ?? 0),
    }));
  },
  async save(sid, turns) {
    await fsPatch(`sessions/${sid}`, { turns, updatedAt: new Date(), expiresAt: new Date(Date.now() + TTL_MS) }, 4000);
  },
};

let override: Remote | null | undefined;
/** Tests: swap the remote store (null: none; undefined: back to Firestore when cloud is on). */
export function useRemote(r: Remote | null | undefined): void { override = r; }
const remote = (): Remote | null => (override !== undefined ? override : cloudOn() ? firestore : null);

const oneLine = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);
const validSid = (sid?: string): sid is string => !!sid && /^[\w-]{8,64}$/.test(sid);

/** The session's earlier turns: in-process first, then the remote store within 1.2 s, else none. */
export async function recall(sid?: string): Promise<{ turns: Turn[]; source: MemorySource }> {
  if (!validSid(sid)) return { turns: [], source: "none" };
  const local = mem.get(sid);
  if (local?.length) return { turns: local, source: "memory" };
  const r = remote();
  if (!r) return { turns: [], source: "none" };
  const turns = (await capped(r.load(sid), 1200))?.filter((t) => t.q && Date.now() - t.at < TTL_MS).slice(-MAX_TURNS) ?? [];
  if (!turns.length) return { turns: [], source: "none" };
  if (!mem.has(sid)) mem.set(sid, turns);
  return { turns, source: "firestore" };
}

/** Remember one turn (answers trimmed to one line); the remote write happens in the background. */
export function remember(sid: string | undefined, turn: Turn): void {
  if (!validSid(sid)) return;
  const t: Turn = { q: oneLine(turn.q, 500), a: oneLine(turn.a, 600), kind: turn.kind, tools: turn.tools.slice(0, 12), evidence: turn.evidence.slice(0, 3000), at: turn.at };
  const turns = [...(mem.get(sid) ?? []), t].slice(-MAX_TURNS);
  mem.delete(sid);
  mem.set(sid, turns);
  while (mem.size > MAX_SESSIONS) mem.delete(mem.keys().next().value as string);
  const r = remote();
  if (r) setTimeout(() => { r.save(sid, turns).catch((e) => console.error("[cloud] session memory write failed:", (e as Error).message)); }, 0);
}

/** A follow-up: the last turn is under 10 minutes old and the question leans on it. */
export function isFollowUp(q: string, turns: Turn[], now = Date.now()): boolean {
  const last = turns[turns.length - 1];
  if (!last || now - last.at >= FOLLOW_UP_MS) return false;
  const s = q.trim();
  return FOLLOW_UP.test(s) || (LEANS_ON.test(s) && s.split(/\s+/).length <= SHORT_WORDS);
}

/** Tests: forget every session. */
export function clearMemory(): void { mem.clear(); }
