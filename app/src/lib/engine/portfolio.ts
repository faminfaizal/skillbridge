// The open-opportunity portfolio, staffed once per process. Shared by Opportunity Discovery, Executive Intelligence
// and growth paths. Seed data is static at runtime, so the cache only resets when the DB is rebuilt (resetPortfolio).
import { all } from "../db.ts";
import { data } from "./data.ts";
import { dataVersion } from "../cacheVersion.ts";
import { opportunityRoles } from "./requirements.ts";
import { formTeam, type TeamResult } from "./team.ts";
import type { OpportunityRow } from "./value.ts";
import type { RoleRequirement } from "../types.ts";

export interface OpenOpportunity extends OpportunityRow {
  org_id: string | null;
  problem_class_id: string | null;
  deadline: string;
  demo_query: string | null;
  roles: RoleRequirement[];
}

let opps: OpenOpportunity[] | null = null;
const teams = new Map<string, TeamResult>();
let version = -1;

export function resetPortfolio(): void {
  opps = null;
  teams.clear();
}

function fresh() {
  if (version !== dataVersion()) { resetPortfolio(); version = dataVersion(); }
}

export function openOpportunities(): OpenOpportunity[] {
  fresh();
  opps ??= all<OpenOpportunity>("SELECT * FROM opportunities WHERE status = 'open' ORDER BY id").map((o) => ({ ...o, roles: opportunityRoles(o.id) }));
  return opps;
}

export function staffed(opportunityId: string): TeamResult {
  fresh();
  if (!teams.has(opportunityId)) {
    const o = openOpportunities().find((x) => x.id === opportunityId);
    teams.set(opportunityId, formTeam(o ? o.roles : [], data()));
  }
  return teams.get(opportunityId)!;
}

/** The query that reproduces an opportunity in Ask AI (demo question if it has one, else its title). */
export const askFor = (o: { demo_query: string | null; title: string }) => o.demo_query ?? o.title;
