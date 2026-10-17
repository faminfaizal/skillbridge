// Cached read model over the SQLite seed. Seed data is static at runtime; call resetData() after precompute writes.
import { all, financeParams } from "../db.ts";
import { dataVersion } from "../cacheVersion.ts";

export interface Person {
  id: string; name: string; level: string; level_rank: number; title: string; division_id: string; department_id: string | null;
  team_id: string | null; location_id: string; availability_pct: number; loaded_rate_amt: number; consent_visibility: number;
  hire_year: number; retirement_risk: number; manager_id: string | null;
}
export interface Skill { id: string; name: string; family: string; emerging: number }
export interface DeclaredSkill { person_id: string; skill_id: string; level: number; source: string; last_used_year: number }
export interface InferredSkill { person_id: string; skill_id: string; confidence: number; evidence_ids: string; rationale: string; model: string }
export interface Assignment { id: string; project_id: string; person_id: string; role: string; allocation_pct: number; man_days: number; contribution_note: string; start_date: string; end_date: string }
export interface Project { id: string; name: string; status: string; division_id: string; start_date: string; end_date: string; customer_id: string | null; problem_class_id: string | null }
export interface EvidenceRow { id: string; kind: "assignment" | "knowledge" | "incident" | "case"; person_id: string; text: string; date: string; ref: string; problem_class_id?: string | null }

export interface Model {
  finance: Record<string, any>;
  people: Map<string, Person>;
  skills: Map<string, Skill>;
  skillByName: Map<string, Skill>;
  adjacency: Map<string, Map<string, number>>; // a -> b -> weight
  declared: Map<string, Map<string, DeclaredSkill>>; // person -> skill -> row
  inferred: Map<string, Map<string, InferredSkill>>;
  assignments: Map<string, Assignment[]>; // by person
  projects: Map<string, Project>;
  projectSkills: Map<string, Set<string>>;
  evidence: Map<string, EvidenceRow[]>; // by person
  departments: Map<string, string>;
  locations: Map<string, string>;
}

let model: Model | null = null;
let modelVersion = -1;

export function resetData(): void {
  model = null;
}

function group<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  }
  return m;
}

export function data(): Model {
  if (model && modelVersion === dataVersion()) return model;
  modelVersion = dataVersion();
  const people = new Map(all<Person>("SELECT * FROM people").map((p) => [p.id, p]));
  const skillsRows = all<Skill>("SELECT * FROM skills");
  const adjacency = new Map<string, Map<string, number>>();
  for (const r of all<{ skill_a: string; skill_b: string; weight: number }>("SELECT * FROM skill_adjacency")) {
    if (!adjacency.has(r.skill_a)) adjacency.set(r.skill_a, new Map());
    adjacency.get(r.skill_a)!.set(r.skill_b, r.weight);
  }
  const declared = new Map<string, Map<string, DeclaredSkill>>();
  for (const r of all<DeclaredSkill>("SELECT * FROM person_skills")) {
    if (!declared.has(r.person_id)) declared.set(r.person_id, new Map());
    declared.get(r.person_id)!.set(r.skill_id, r);
  }
  const inferred = new Map<string, Map<string, InferredSkill>>();
  for (const r of all<InferredSkill>("SELECT * FROM inferred_skills")) {
    if (!inferred.has(r.person_id)) inferred.set(r.person_id, new Map());
    inferred.get(r.person_id)!.set(r.skill_id, r);
  }
  const projectSkills = new Map<string, Set<string>>();
  for (const r of all<{ project_id: string; skill_id: string }>("SELECT * FROM project_skills")) {
    if (!projectSkills.has(r.project_id)) projectSkills.set(r.project_id, new Set());
    projectSkills.get(r.project_id)!.add(r.skill_id);
  }
  const ev: EvidenceRow[] = [
    ...all<EvidenceRow>(`SELECT a.id, 'assignment' AS kind, a.person_id, a.contribution_note AS text, a.end_date AS date, a.project_id AS ref FROM assignments a`),
    ...all<EvidenceRow>(`SELECT k.id, 'knowledge' AS kind, k.author_id AS person_id, k.title || '. ' || k.body AS text, k.created AS date, k.id AS ref FROM knowledge_items k`),
    ...all<EvidenceRow>(`SELECT i.id, 'incident' AS kind, r.person_id, i.summary AS text, i.opened AS date, i.id AS ref FROM incidents i JOIN incident_resolvers r ON r.incident_id = i.id`),
    ...all<EvidenceRow>(`SELECT c.id, 'case' AS kind, c.resolver_id AS person_id, c.summary AS text, c.opened AS date, c.org_id AS ref, c.problem_class_id FROM customer_cases c WHERE c.resolver_id IS NOT NULL`),
  ];
  model = {
    finance: financeParams(),
    people,
    skills: new Map(skillsRows.map((s) => [s.id, s])),
    skillByName: new Map(skillsRows.map((s) => [s.name.toLowerCase(), s])),
    adjacency,
    declared,
    inferred,
    assignments: group(all<Assignment>("SELECT * FROM assignments"), (a) => a.person_id),
    projects: new Map(all<Project>("SELECT * FROM projects").map((p) => [p.id, p])),
    projectSkills,
    evidence: group(ev, (e) => e.person_id),
    departments: new Map(all<{ id: string; name: string }>("SELECT id, name FROM departments").map((d) => [d.id, d.name])),
    locations: new Map(all<{ id: string; name: string }>("SELECT id, name FROM locations").map((d) => [d.id, d.name])),
  };
  return model;
}
