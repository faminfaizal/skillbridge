// Demo data feed: realistic new records written straight into the data tables. Nothing here calls an agent: the
// database triggers log each insert, and the runner picks the changes up exactly as it would from a real HR or ITSM feed.
// Every simulated row id starts with "SIM-" so the demo can be reset.
import fs from "node:fs";
import { resetExtensions } from "./resetHooks.ts";
import { agentsChanged, ledgerChanged } from "../cloud/index.ts";
import path from "node:path";
import { all, get, getDb, run } from "../db.ts";
import { bumpDataVersion } from "../cacheVersion.ts";
import { data } from "../engine/data.ts";
import { inferPerson } from "../engine/inferRun.ts";
import { resetActivations } from "../engine/impact.ts";
import { buildGraph, readGraph, writeGraph } from "../graphBuild.ts";
import { snapshot } from "./snapshot.ts";
import { ensureAgentTables, setState, getState, today } from "./store.ts";
import { ensureRunner, withRunnerLock } from "./runner.ts";
import { ensureProfileTables } from "../me/tables.ts";
import { resetProfiles } from "../me/write.ts";

export type Scenario = "rfp" | "purchase" | "ratepro" | "offchart";

export const SCENARIOS: { id: Scenario; label: string; detail: string; agents: string }[] = [
  { id: "rfp", label: "New customer RFP arrives", detail: "A university asks for campus CCTV analytics with edge processing.", agents: "Connectivity, Opportunity Scout" },
  { id: "purchase", label: "Consultancy purchase request", detail: "Cloud Platform asks to buy 40 days of Kubernetes consultants for $200k.", agents: "Connectivity, Opportunity Scout" },
  { id: "ratepro", label: "RatePro fails again overnight", detail: "Three more RatePro incidents, fixed by the same people.", agents: "Connectivity, Risk Sentinel, People Growth" },
  { id: "offchart", label: "Field coordinator fixes a NOVA alarm", detail: "She resolves an incident, writes a runbook and is thanked by the NOVA team.", agents: "Connectivity, People Growth" },
];

function manifest(): Record<string, any> {
  const file = path.resolve(process.cwd(), "../data/seed/story_manifest.json");
  return Object.fromEntries(JSON.parse(fs.readFileSync(file, "utf-8")).map((x: { anchor: string; expected: unknown }) => [x.anchor, x.expected]));
}

const next = (table: string, prefix: string) => (get<{ n: number }>(`SELECT COUNT(*) n FROM ${table} WHERE id LIKE ?`, `${prefix}%`)?.n ?? 0) + 1;
const pcId = (name: string) => get<{ id: string }>("SELECT id FROM problem_classes WHERE name = ?", name)?.id ?? null;

export function simulate(s: Scenario): { inserted: string[] } {
  ensureRunner();   // baseline snapshot is taken before the new rows land
  const mf = manifest();
  const d = today();
  const ins: string[] = [];
  const db = getDb();
  db.exec("BEGIN");
  try {
    if (s === "rfp") {
      const n = next("opportunities", "SIM-OPP-");
      const id = `SIM-OPP-${n}`;
      const org = get<{ id: string; name: string }>("SELECT id, name FROM organisations WHERE id = 'ORG-UNI'") ?? get<{ id: string; name: string }>("SELECT id, name FROM organisations WHERE kind = 'customer' LIMIT 1")!;
      run(`INSERT INTO opportunities (id, code, title, kind, org_id, description, deadline, external_quote_amt, internal_cost_amt, revenue_potential_amt, hours_saved,
           win_probability, status, demo_query, problem_class_id) VALUES (?, ?, ?, 'customer project', ?, ?, '2027-03-31', 260000, 120000, 520000, 220, 0.45, 'open', NULL, ?)`,
        id, id, `Campus CCTV analytics RFP: ${org.name}`, org.id, "RFP: CCTV video analytics with on-site edge processing for a university campus.", pcId("Video analytics demand"));
      const roles: [string, string[]][] = [["Video Analytics Engineer", ["Video Analytics", "Computer Vision"]], ["IoT Architect", ["IoT Platforms", "Smart Campus Solutions"]], ["Edge Platform Engineer", ["Edge Computing", "Kubernetes"]]];
      roles.forEach(([role, skills], i) => {
        run("INSERT INTO opportunity_roles (id, opportunity_id, role, headcount) VALUES (?, ?, ?, 1)", `${id}-R${i + 1}`, id, role);
        for (const sk of skills) {
          const sid = get<{ id: string }>("SELECT id FROM skills WHERE name = ?", sk)!.id;
          run("INSERT INTO opportunity_role_skills (role_id, skill_id, must) VALUES (?, ?, 1)", `${id}-R${i + 1}`, sid);
        }
      });
      run(`INSERT INTO customer_cases (id, org_id, problem_class_id, severity, opened, mttr_hours, escalated, fcr, csat, resolver_id, summary)
           VALUES (?, ?, ?, 'P4', ?, 0, 0, 0, 0, NULL, 'Video analytics demand: RFP for campus CCTV analytics with edge processing')`, `SIM-CS-${n}`, org.id, pcId("Video analytics demand"), d);
      ins.push(id, `SIM-CS-${n}`);
    } else if (s === "purchase") {
      const id = `SIM-PR-${next("purchase_requests", "SIM-PR-")}`;
      run(`INSERT INTO purchase_requests (id, vendor_org_id, skill_id, days, cost_amt, requested_by, description, status, created_at)
           VALUES (?, 'ORG-ACP', 'SK-kubernetes', 40, 200000, 'Cloud Platform', 'Kubernetes platform hardening consultants (40 days)', 'pending', ?)`, id, new Date().toISOString());
      ins.push(id);
    } else if (s === "ratepro") {
      const n = next("incidents", "SIM-INC-");
      const [senior, veteran, priya] = mf.A3.people as string[];
      ["a", "b", "c"].forEach((x, i) => {
        const id = `SIM-INC-${n}${x}`;
        run("INSERT INTO incidents (id, code, system_id, severity, opened, duration_hours, summary) VALUES (?, ?, 'SYS-RATE', ?, ?, ?, 'RatePro overnight rating run failure')",
          id, id, i === 0 ? "P1" : "P2", d, 4 + i);
        run("INSERT INTO incident_resolvers (incident_id, person_id) VALUES (?, ?)", id, priya);
        if (i === 1) run("INSERT INTO incident_resolvers (incident_id, person_id) VALUES (?, ?)", id, veteran);
        if (i === 2) run("INSERT INTO incident_resolvers (incident_id, person_id) VALUES (?, ?)", id, senior);
        ins.push(id);
      });
    } else if (s === "offchart") {
      const n = next("knowledge_items", "SIM-KI-");
      const mary = mf.A20.person_id as string;
      const novaA = mf.A14.projects[0] as string;
      const maint = mf.A14.maintainer as string;
      const inc = `SIM-INC-${next("incidents", "SIM-INC-")}`;
      run("INSERT INTO incidents (id, code, system_id, severity, opened, duration_hours, summary) VALUES (?, ?, 'SYS-NOVA', 'P2', ?, 2.5, 'NOVA NMS alarm storm after a field fibre cut; fixed by remote triage')", inc, inc, d);
      run("INSERT INTO incident_resolvers (incident_id, person_id) VALUES (?, ?)", inc, mary);
      run(`INSERT INTO knowledge_items (id, code, title, kind, author_id, project_id, problem_class_id, system_id, reuse_count, created, body)
           VALUES (?, ?, 'NOVA alarm correlation for field triage', 'runbook', ?, ?, ?, 'SYS-NOVA', 0, ?, ?)`,
        `SIM-KI-${n}`, `SIM-KI-${n}`, mary, novaA, pcId("Network alarm flood"), d,
        "How field coordinators read alarm correlation in the network management systems (NOVA) to decide between a remote fix and a truck roll.");
      run("INSERT INTO peer_recognition (id, from_id, to_id, question, project_id, date) VALUES (?, ?, ?, 'Who solved a problem others could not?', ?, ?)",
        `SIM-REC-${n}`, maint, mary, novaA, d);
      ins.push(inc, `SIM-KI-${n}`, `SIM-REC-${n}`);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { inserted: ins };
}

/** Undo every simulated row and every approved agent action, then rebuild the affected skills and the graph. */
export async function resetAgents(): Promise<{ removed: number }> {
  return withRunnerLock(resetLocked);
}

async function resetLocked(): Promise<{ removed: number }> {
  ensureAgentTables();
  const people = new Set(all<{ p: string | null }>("SELECT person_ids p FROM change_events").flatMap((r) => (r.p ? r.p.split(",") : [])));
  let removed = 0;
  const del = (sql: string, ...a: string[]) => { const before = get<{ c: number }>("SELECT total_changes() c")!.c; run(sql, ...a); removed += get<{ c: number }>("SELECT total_changes() c")!.c - before; };
  for (const r of all<{ action: string }>("SELECT action FROM agent_inbox WHERE status = 'approved'")) {
    const a = JSON.parse(r.action);
    if (a.type === "sme_role" && a.systemId) del("DELETE FROM system_roles WHERE system_id = ? AND person_id = ? AND role = 'sme (via SkillBridge)'", a.systemId, a.personId);
    if (a.personId) people.add(a.personId);
  }
  // Self-service profile edits first: they restore traced seed rows (skills, certifications, projects, recognition)
  ensureProfileTables();
  for (const r of all<{ person_id: string }>("SELECT DISTINCT person_id FROM profile_trace")) people.add(r.person_id);
  removed += resetProfiles();
  // Newer features first (crises, community requests, social records), then impact records:
  // an approved RFP bid references its simulated opportunity
  removed += resetExtensions();
  resetActivations();
  del("DELETE FROM person_skills WHERE source = 'confirmed'");
  del("DELETE FROM opportunity_role_skills WHERE role_id LIKE 'SIM-%'");
  for (const t of ["opportunity_roles", "opportunities", "customer_cases", "knowledge_items", "peer_recognition", "visibility_signals", "events", "purchase_requests"]) del(`DELETE FROM ${t} WHERE id LIKE 'SIM-%'`);
  del("DELETE FROM incident_resolvers WHERE incident_id LIKE 'SIM-%'");
  del("DELETE FROM incidents WHERE id LIKE 'SIM-%'");
  // Concierge question log is kept: it is not part of the simulated data
  run("DELETE FROM change_events");
  run("DELETE FROM agent_runs WHERE agent <> 'concierge'");
  run("DELETE FROM agent_inbox");
  bumpDataVersion();
  const m = data();
  // LLM calls here hit the cache: the same records were explained before the demo started
  for (const pid of people) if (m.people.has(pid)) await inferPerson(m, pid, true);
  bumpDataVersion();
  const prev = readGraph();
  writeGraph(buildGraph(data(), { pinned: new Map((prev?.nodes ?? []).map((n) => [n.id, { x: n.x, y: n.y }])) }));
  setState("snapshot", snapshot());
  setState("graph_version", (getState<number>("graph_version") ?? 0) + 1);
  agentsChanged("reset");
  ledgerChanged("reset");
  return { removed };
}
