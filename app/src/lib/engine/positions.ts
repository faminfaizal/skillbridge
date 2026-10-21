// Positions: each person's current post (generated from templates in the data pipeline, never by an LLM).
// A post's holder is named only when they share their profile.
import { all, get } from "../db.ts";
import { data, type Model } from "./data.ts";
import { capability } from "./match.ts";
import type { Position, RoleRequirement } from "../types.ts";

interface PositionRow {
  id: string; person_id: string; title: string; level: string; level_rank: number; archetype: string;
  division_id: string; department_id: string | null; reports_to_id: string | null; responsibilities: string; competencies: string;
}

function toPosition(r: PositionRow, m: Model): Position {
  const holder = m.people.get(r.person_id);
  const boss = r.reports_to_id ? get<{ id: string; title: string }>("SELECT id, title FROM positions WHERE id = ?", r.reports_to_id) : undefined;
  const skills = all<{ skill_id: string; must: number }>("SELECT skill_id, must FROM position_skills WHERE position_id = ? ORDER BY must DESC, rowid", r.id)
    .map((s) => ({ skillId: s.skill_id, skill: m.skills.get(s.skill_id)?.name ?? s.skill_id, must: s.must === 1 }));
  return {
    id: r.id, personId: r.person_id, holder: holder?.consent_visibility === 1 ? holder.name : null,
    title: r.title, level: r.level, levelRank: r.level_rank,
    unit: r.department_id ? m.departments.get(r.department_id) ?? "" : "Leadership",
    reportsTo: boss ?? null,
    responsibilities: JSON.parse(r.responsibilities) as string[], competencies: JSON.parse(r.competencies) as string[], skills,
  };
}

export function positionById(id: string, m: Model = data()): Position | null {
  const r = get<PositionRow>("SELECT * FROM positions WHERE id = ?", id);
  return r ? toPosition(r, m) : null;
}

export function positionOf(personId: string, m: Model = data()): Position | null {
  const r = get<PositionRow>("SELECT * FROM positions WHERE person_id = ?", personId);
  return r ? toPosition(r, m) : null;
}

/** Posts by post id, title or holder name (a private holder is never matched by name). */
export function searchPositions(q: string, limit = 8, m: Model = data()): Position[] {
  const s = q.trim().toLowerCase();
  if (s.length < 2) return [];
  const rows = all<PositionRow>("SELECT * FROM positions ORDER BY level_rank, id");
  const hit = (r: PositionRow) => {
    const p = m.people.get(r.person_id);
    const named = p?.consent_visibility === 1 && p.name.toLowerCase().includes(s);
    return r.id.toLowerCase() === s || r.title.toLowerCase().includes(s) || named;
  };
  const exact = rows.filter((r) => r.id.toLowerCase() === s);
  return (exact.length ? exact : rows.filter(hit)).slice(0, limit).map((r) => toPosition(r, m));
}

/** A person's post with their own capability on each of its skills (for the Current post block). */
export function postWithCapability(personId: string, m: Model = data()): Position | null {
  const post = positionOf(personId, m);
  return post ? { ...post, skills: post.skills.map((s) => ({ ...s, value: capability(m, personId, s.skillId).value })) } : null;
}

export function positionRequirement(p: Position): RoleRequirement {
  return { role: p.title, must: p.skills.filter((s) => s.must).map((s) => s.skillId), nice: p.skills.filter((s) => !s.must).map((s) => s.skillId) };
}
