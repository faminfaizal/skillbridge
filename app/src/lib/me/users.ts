// Temporary demo sign-in: the profile page acts as one of ten seeded people. Every /api/me call names the person in the
// x-demo-user header (or ?as=); this is the single place SSO replaces later.
import { all } from "../db.ts";

export const DEMO_USERS = ["P-075", "P-072", "P-210", "P-208", "P-152", "P-066", "P-030", "P-203", "P-027", "P-010"] as const;

export interface DemoUser { id: string; name: string; title: string; why: string }

const WHY: Record<string, string> = {
  "P-075": "Hidden talent: AI suggestions to confirm",
  "P-072": "Hafiz's manager: Team validation",
  "P-210": "Strong recognition, six projects",
  "P-208": "Priya's manager: Team validation",
  "P-152": "Reskilling and growth paths",
  "P-066": "Field expert, thin profile",
  "P-030": "Forgotten expert, manages two",
  "P-203": "Real work, no project roster",
  "P-027": "Opted out of discovery",
  "P-010": "Manager with a full profile",
};

export function demoUsers(): DemoUser[] {
  const rows = all<{ id: string; name: string; title: string }>(
    `SELECT id, name, title FROM people WHERE id IN (${DEMO_USERS.map(() => "?").join(",")})`, ...DEMO_USERS);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return DEMO_USERS.filter((id) => byId.has(id)).map((id) => ({ ...byId.get(id)!, why: WHY[id] ?? "" }));
}

/** The signed-in person for this request, or null when the header names no allowed demo user. */
export function currentUser(req: Request): string | null {
  const id = req.headers.get("x-demo-user") ?? new URL(req.url).searchParams.get("as");
  return id && (DEMO_USERS as readonly string[]).includes(id) ? id : null;
}
