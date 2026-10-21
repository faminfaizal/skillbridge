-- SkillBridge schema. Postgres-compatible DDL that SQLite also executes (MVP store).
-- All data is synthetic (fictional company Veridane Networks). See docs/SkillBridge_Synthetic_Data_Plan.md.

CREATE TABLE locations (id TEXT PRIMARY KEY, name TEXT NOT NULL, region TEXT NOT NULL, remote_region INTEGER NOT NULL DEFAULT 0);
CREATE TABLE divisions (id TEXT PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL);
CREATE TABLE departments (id TEXT PRIMARY KEY, division_id TEXT NOT NULL REFERENCES divisions(id), name TEXT NOT NULL);
CREATE TABLE teams (id TEXT PRIMARY KEY, department_id TEXT NOT NULL REFERENCES departments(id), name TEXT NOT NULL, location_id TEXT REFERENCES locations(id));

CREATE TABLE people (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL,
  level TEXT NOT NULL, level_rank INTEGER NOT NULL, title TEXT NOT NULL, archetype TEXT NOT NULL,
  division_id TEXT NOT NULL REFERENCES divisions(id), department_id TEXT REFERENCES departments(id), team_id TEXT REFERENCES teams(id),
  manager_id TEXT REFERENCES people(id), location_id TEXT NOT NULL REFERENCES locations(id),
  hire_year INTEGER NOT NULL, availability_pct INTEGER NOT NULL, loaded_rate_amt INTEGER NOT NULL,
  consent_visibility INTEGER NOT NULL DEFAULT 1, retirement_risk INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE profiles (person_id TEXT PRIMARY KEY REFERENCES people(id), cv_summary TEXT NOT NULL, work_history TEXT NOT NULL, interests TEXT NOT NULL);

CREATE TABLE skills (id TEXT PRIMARY KEY, name TEXT NOT NULL, family TEXT NOT NULL, emerging INTEGER NOT NULL DEFAULT 0);
CREATE TABLE skill_adjacency (skill_a TEXT NOT NULL REFERENCES skills(id), skill_b TEXT NOT NULL REFERENCES skills(id), weight REAL NOT NULL, PRIMARY KEY (skill_a, skill_b));
CREATE TABLE person_skills (person_id TEXT NOT NULL REFERENCES people(id), skill_id TEXT NOT NULL REFERENCES skills(id), level INTEGER NOT NULL, source TEXT NOT NULL, last_used_year INTEGER NOT NULL, PRIMARY KEY (person_id, skill_id));

CREATE TABLE positions (
  id TEXT PRIMARY KEY, person_id TEXT NOT NULL UNIQUE REFERENCES people(id),
  title TEXT NOT NULL, level TEXT NOT NULL, level_rank INTEGER NOT NULL, archetype TEXT NOT NULL,
  division_id TEXT NOT NULL REFERENCES divisions(id), department_id TEXT REFERENCES departments(id), team_id TEXT REFERENCES teams(id),
  reports_to_id TEXT REFERENCES positions(id), responsibilities TEXT NOT NULL, competencies TEXT NOT NULL
);
CREATE TABLE position_skills (position_id TEXT NOT NULL REFERENCES positions(id), skill_id TEXT NOT NULL REFERENCES skills(id), must INTEGER NOT NULL, PRIMARY KEY (position_id, skill_id));

CREATE TABLE certifications (id TEXT PRIMARY KEY, name TEXT NOT NULL, skill_id TEXT NOT NULL REFERENCES skills(id), cost_amt INTEGER NOT NULL, months INTEGER NOT NULL);
CREATE TABLE person_certs (person_id TEXT NOT NULL REFERENCES people(id), cert_id TEXT NOT NULL REFERENCES certifications(id), year INTEGER NOT NULL, PRIMARY KEY (person_id, cert_id));
CREATE TABLE trainings (id TEXT PRIMARY KEY, name TEXT NOT NULL, skill_id TEXT NOT NULL REFERENCES skills(id), kind TEXT NOT NULL, cost_amt INTEGER NOT NULL, weeks INTEGER NOT NULL);
CREATE TABLE enrolments (person_id TEXT NOT NULL REFERENCES people(id), training_id TEXT NOT NULL REFERENCES trainings(id), year INTEGER NOT NULL, status TEXT NOT NULL, PRIMARY KEY (person_id, training_id));

CREATE TABLE organisations (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, sector TEXT NOT NULL, location_id TEXT REFERENCES locations(id));
CREATE TABLE problem_classes (id TEXT PRIMARY KEY, name TEXT NOT NULL, domain TEXT NOT NULL);

CREATE TABLE systems (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, criticality TEXT NOT NULL, location_id TEXT REFERENCES locations(id), vendor_org_id TEXT REFERENCES organisations(id), description TEXT NOT NULL);
CREATE TABLE system_deps (system_id TEXT NOT NULL REFERENCES systems(id), depends_on_id TEXT NOT NULL REFERENCES systems(id), PRIMARY KEY (system_id, depends_on_id));
CREATE TABLE system_roles (system_id TEXT NOT NULL REFERENCES systems(id), person_id TEXT NOT NULL REFERENCES people(id), role TEXT NOT NULL, PRIMARY KEY (system_id, person_id));

CREATE TABLE projects (
  id TEXT PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, division_id TEXT NOT NULL REFERENCES divisions(id),
  sponsor_id TEXT REFERENCES people(id), pm_id TEXT REFERENCES people(id), status TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL,
  budget_amt INTEGER NOT NULL, external_spend_amt INTEGER NOT NULL, outcome TEXT NOT NULL, value_amt INTEGER NOT NULL,
  customer_id TEXT REFERENCES organisations(id), problem_class_id TEXT REFERENCES problem_classes(id), location_id TEXT REFERENCES locations(id), description TEXT NOT NULL
);
CREATE TABLE project_skills (project_id TEXT NOT NULL REFERENCES projects(id), skill_id TEXT NOT NULL REFERENCES skills(id), PRIMARY KEY (project_id, skill_id));
CREATE TABLE project_systems (project_id TEXT NOT NULL REFERENCES projects(id), system_id TEXT NOT NULL REFERENCES systems(id), PRIMARY KEY (project_id, system_id));
CREATE TABLE assignments (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), person_id TEXT NOT NULL REFERENCES people(id),
  role TEXT NOT NULL, allocation_pct INTEGER NOT NULL, man_days INTEGER NOT NULL, contribution_note TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL
);

CREATE TABLE customer_cases (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organisations(id), problem_class_id TEXT NOT NULL REFERENCES problem_classes(id),
  severity TEXT NOT NULL, opened TEXT NOT NULL, mttr_hours REAL NOT NULL, escalated INTEGER NOT NULL, fcr INTEGER NOT NULL, csat INTEGER NOT NULL,
  resolver_id TEXT REFERENCES people(id), summary TEXT NOT NULL
);
CREATE TABLE incidents (id TEXT PRIMARY KEY, code TEXT NOT NULL, system_id TEXT NOT NULL REFERENCES systems(id), severity TEXT NOT NULL, opened TEXT NOT NULL, duration_hours REAL NOT NULL, summary TEXT NOT NULL);
CREATE TABLE incident_resolvers (incident_id TEXT NOT NULL REFERENCES incidents(id), person_id TEXT NOT NULL REFERENCES people(id), PRIMARY KEY (incident_id, person_id));

CREATE TABLE knowledge_items (
  id TEXT PRIMARY KEY, code TEXT NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL, author_id TEXT NOT NULL REFERENCES people(id),
  project_id TEXT REFERENCES projects(id), problem_class_id TEXT REFERENCES problem_classes(id), system_id TEXT REFERENCES systems(id),
  reuse_count INTEGER NOT NULL, created TEXT NOT NULL, body TEXT NOT NULL
);

CREATE TABLE external_engagements (id TEXT PRIMARY KEY, vendor_org_id TEXT NOT NULL REFERENCES organisations(id), project_id TEXT REFERENCES projects(id), skill_id TEXT NOT NULL REFERENCES skills(id), days INTEGER NOT NULL, cost_amt INTEGER NOT NULL, start_date TEXT NOT NULL, description TEXT NOT NULL);
CREATE TABLE requisitions (id TEXT PRIMARY KEY, title TEXT NOT NULL, skill_id TEXT NOT NULL REFERENCES skills(id), division_id TEXT NOT NULL REFERENCES divisions(id), est_cost_amt INTEGER NOT NULL, status TEXT NOT NULL, opened TEXT NOT NULL);

CREATE TABLE opportunities (
  id TEXT PRIMARY KEY, code TEXT NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL, org_id TEXT REFERENCES organisations(id), description TEXT NOT NULL,
  deadline TEXT NOT NULL, external_quote_amt INTEGER NOT NULL, internal_cost_amt INTEGER NOT NULL, revenue_potential_amt INTEGER NOT NULL,
  hours_saved INTEGER NOT NULL, win_probability REAL NOT NULL, status TEXT NOT NULL, demo_query TEXT, problem_class_id TEXT REFERENCES problem_classes(id)
);
CREATE TABLE opportunity_roles (id TEXT PRIMARY KEY, opportunity_id TEXT NOT NULL REFERENCES opportunities(id), role TEXT NOT NULL, headcount INTEGER NOT NULL);
CREATE TABLE opportunity_role_skills (role_id TEXT NOT NULL REFERENCES opportunity_roles(id), skill_id TEXT NOT NULL REFERENCES skills(id), must INTEGER NOT NULL, PRIMARY KEY (role_id, skill_id));

CREATE TABLE peer_recognition (id TEXT PRIMARY KEY, from_id TEXT NOT NULL REFERENCES people(id), to_id TEXT NOT NULL REFERENCES people(id), question TEXT NOT NULL, project_id TEXT REFERENCES projects(id), date TEXT NOT NULL);
CREATE TABLE visibility_signals (id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES people(id), kind TEXT NOT NULL, date TEXT NOT NULL);
CREATE TABLE sme_requests (id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organisations(id), skill_id TEXT NOT NULL REFERENCES skills(id), description TEXT NOT NULL, date TEXT NOT NULL);
CREATE TABLE events (id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES people(id), kind TEXT NOT NULL, ref_id TEXT, date TEXT NOT NULL);

CREATE TABLE impact_records (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, title TEXT NOT NULL, opportunity_id TEXT REFERENCES opportunities(id), people_count INTEGER NOT NULL,
  cost_avoided_amt INTEGER NOT NULL, productivity_amt INTEGER NOT NULL, recruitment_amt INTEGER NOT NULL, revenue_amt INTEGER NOT NULL,
  customer_impact TEXT NOT NULL, strategic_value TEXT NOT NULL, source TEXT NOT NULL, person_ids TEXT
);
CREATE TABLE reinvestment_initiatives (id TEXT PRIMARY KEY, name TEXT NOT NULL, allocation_amt INTEGER NOT NULL, outcome TEXT NOT NULL);
CREATE TABLE finance_params (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- Written by app/scripts/precompute.ts and the app at runtime
CREATE TABLE inferred_skills (person_id TEXT NOT NULL REFERENCES people(id), skill_id TEXT NOT NULL REFERENCES skills(id), confidence REAL NOT NULL, evidence_ids TEXT NOT NULL, rationale TEXT NOT NULL, model TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (person_id, skill_id));
CREATE TABLE embeddings (ref_type TEXT NOT NULL, ref_id TEXT NOT NULL, model TEXT NOT NULL, dims INTEGER NOT NULL, vector TEXT NOT NULL, PRIMARY KEY (ref_type, ref_id));
CREATE TABLE llm_cache (key TEXT PRIMARY KEY, model TEXT NOT NULL, provider TEXT NOT NULL, response TEXT NOT NULL, created_at TEXT NOT NULL);
-- AI agents (PRD 8.8). The app also creates these, plus the AFTER INSERT triggers that fill change_events, on startup
-- (app/src/lib/agents/store.ts), so a database built from this file and the seed CSVs never fires triggers during the load.
CREATE TABLE change_events (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, entity_id TEXT NOT NULL, person_ids TEXT, payload TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL, processed_at TEXT);
CREATE TABLE agent_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, agent TEXT NOT NULL, trigger TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, steps TEXT NOT NULL, summary TEXT, provider TEXT, event_ids TEXT, node_ids TEXT);
CREATE TABLE agent_inbox (id INTEGER PRIMARY KEY AUTOINCREMENT, agent TEXT NOT NULL, run_id INTEGER, kind TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL, evidence TEXT NOT NULL, value_amt INTEGER NOT NULL DEFAULT 0, node_ids TEXT NOT NULL, approver TEXT NOT NULL, action TEXT NOT NULL, status TEXT NOT NULL, dedupe_key TEXT UNIQUE, provider TEXT, created_at TEXT NOT NULL, decided_at TEXT, outcome TEXT);
CREATE TABLE agent_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE purchase_requests (id TEXT PRIMARY KEY, vendor_org_id TEXT NOT NULL, skill_id TEXT NOT NULL, days INTEGER NOT NULL, cost_amt INTEGER NOT NULL, requested_by TEXT, description TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE ai_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, input_ref TEXT NOT NULL, output TEXT NOT NULL, model TEXT NOT NULL, provider TEXT NOT NULL, created_at TEXT NOT NULL);
