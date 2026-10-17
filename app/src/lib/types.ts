// Shared contracts between engine, API and UI (frozen on D0; extend, don't rename).

export type Provider = "vertex" | "cache" | "template" | "rules";
export type Evidence = "verified" | "inferred";

export interface GraphNode {
  id: string;
  type: "person" | "skill" | "project" | "system" | "org" | "problem" | "opportunity" | "incident" | "knowledge" | "department" | "division";
  label: string;
  x: number;
  y: number;
  size: number;
  community: number;
  attrs: Record<string, string | number | boolean | null>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  weight: number;
  evidence: Evidence;
  sourceRecordIds: string[];
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta: { generatedAt: string; communities: number };
}

export interface ScoreBreakdown {
  skill: number;
  project: number;
  domain: number;
  recency: number;
  adjacent: number;
}

export interface SkillCapability {
  skillId: string;
  skill: string;
  value: number; // 0..1
  source: "declared" | "inferred" | "adjacent" | "none";
  via?: string; // adjacent skill name, when source = adjacent
  year?: number;
}

export interface EvidenceItem {
  id: string;
  kind: "assignment" | "knowledge" | "incident" | "case" | "inference";
  text: string;
  date?: string;
  nodeId?: string;
}

export interface Candidate {
  personId: string;
  name: string;
  title: string;
  department: string;
  location: string;
  role: string;
  score: number; // 0..1
  breakdown: ScoreBreakdown;
  capabilities: SkillCapability[];
  evidence: EvidenceItem[];
  hidden: boolean; // selected on AI-inferred capability
  solvedSimilar: boolean;
  availabilityPct: number;
}

export interface LearningStep {
  id: string;
  name: string;
  kind: string; // short | assignment | mentoring
  weeks: number;
  costAmt: number;
  skill: string;
  mentorId?: string;
}

/** Reskilling Intelligence (PRD 8.5): the smallest path from today's capability to the role, with time and value. */
export interface ReskillOption {
  personId: string;
  name: string;
  title: string;
  readiness: number;   // today, 0..1
  projected: number;   // after the path, 0..1
  skills: { skillId: string; skill: string; now: number; after: number; via?: string }[];
  path: LearningStep[];
  weeks: number;
  costAmt: number;
  readyBy: string;     // ISO date
  contrast?: { id: string; name: string; weeks: number; costAmt: number };
  valueAmt: number;     // hiring cost avoided minus training cost
  valueBasis: string;
}

export interface Gap {
  role: string;
  skills: string[];
  bestScore: number;
  reskill: ReskillOption[];
}

export interface ValueEstimate {
  costAvoided: number;
  productivity: number;
  revenuePotential: number;
  recruitmentAvoided: number;
  assumptions: string[];
  estimated: boolean;
}

export interface RoleRequirement {
  role: string;
  must: string[]; // skill ids
  nice: string[];
  problemClassId?: string | null; // experience with this problem type counts as project experience
}

/** Challenge Team: how a team fits together. Scores are 0..1. */
export interface TeamFit {
  score: number;
  parts: { roleFit: number; coverage: number; complementarity: number; availability: number };
  weights: { roleFit: number; coverage: number; complementarity: number; availability: number };
  skills: { skillId: string; skill: string; best: number; byPerson: Record<string, number> }[];
  brings: Record<string, string[]>; // personId -> covered skills they hold best on the team
  pairs: { a: string; b: string; projects: string[] }[]; // shared project history (shown, not scored)
  warnings: { role?: string; personId?: string; text: string }[];
  notes: string[];
  threshold: number;
}

/** A person added to a role beyond its one slot (Challenge Team). `slot` is the requirement index. */
export type ExtraMember = Candidate & { slot: number };

export interface TeamEvaluation {
  slots: (Candidate | null)[]; // one per requirement, in order
  extras: ExtraMember[];       // people added beyond one per role
  fit: TeamFit;
  coverage: number;
  value: ValueEstimate | null; // null: value is fixed by the matched opportunity
}

export interface AskResponse {
  kind: "team";
  query: string;
  opportunityId: string | null;
  opportunityTitle: string;
  requirements: RoleRequirement[];
  team: Candidate[];
  gaps: Gap[];
  coverage: number;
  value: ValueEstimate;
  highlight: { nodeIds: string[]; edgeIds: string[] };
  narrative: string;
  provider: Provider;
  elapsedMs: number;
  adjusted?: boolean; // the team was changed in Challenge Team before activation
}

export interface ImpactRecord {
  id: string;
  date: string;
  title: string;
  opportunity_id: string | null;
  people_count: number;
  cost_avoided_amt: number;
  productivity_amt: number;
  recruitment_amt: number;
  revenue_amt: number;
  customer_impact: string;
  strategic_value: string;
  source: string;
  person_ids: string | null;
}

export interface ImpactSummary {
  totals: { costAvoided: number; productivity: number; recruitment: number; revenue: number; total: number };
  records: ImpactRecord[];
  initiatives: { id: string; name: string; allocation_amt: number; outcome: string }[];
  capability: { peopleActivated: number; hiddenSkills: number; projectsStaffed: number; gaps: number; reskilling: number };
}

export interface HiddenTalentPerson {
  personId: string;
  name: string;
  title: string;
  department: string;
  location: string;
  contribution: number; // 0..100
  visibility: number; // 0..100
  gap: number;
  projects: number;
  crossTeamDependency: "low" | "medium" | "high";
  criticalKnowledgeAreas: number;
  recognition: number;
  trend: "rising" | "steady" | "falling";
}

// ---------------------------------------------------------------- Opportunity Discovery (PRD 8.6)
export type DiscoveryType = "revenue" | "external_spend" | "capacity" | "reskill" | "duplicate" | "hidden_expert" | "collaboration" | "risk" | "sme";

export interface DiscoveryCard {
  id: string;
  type: DiscoveryType;
  title: string;
  detail: string;
  evidence: string[];
  metric: string;       // headline figure shown on the card, e.g. "$450k" or "78%"
  valueAmt: number;      // 0 when the value is not financial (risk, social)
  valueLabel: string;
  people: { id: string; name: string }[];
  nodeIds: string[];    // graph highlight
  action: { label: string; query?: string; focusId?: string };
}

export interface DiscoveryResult {
  generatedAt: string;
  cards: DiscoveryCard[];
  totalValueAmt: number;
}

// ---------------------------------------------------------------- Executive Intelligence (PRD 8.7)
export type ExecIntent = "gaps" | "external" | "future" | "dependency" | "revenue" | "value" | "invest";

export interface ExecAnswer {
  kind: "exec";
  query: string;
  intent: ExecIntent;
  question: string;     // the canonical executive question answered
  headline: string;     // the decision, in one sentence (deterministic)
  narrative: string;    // AI brief over the same facts (template fallback)
  metrics: { label: string; value: string; tone: "cost" | "prod" | "rev" | "risk" | "neutral" }[];
  table: { columns: { label: string; numeric?: boolean }[]; rows: { cells: string[]; focusId?: string }[] };
  actions: { label: string; detail: string; query?: string; href?: string }[];
  assumptions: string[];
  highlight: { nodeIds: string[]; edgeIds: string[]; danger: string[] };
  provider: Provider;
  elapsedMs: number;
}

// ---------------------------------------------------------------- Concierge agent
export interface ConciergeRef {
  id: string;
  label: string;
  kind: "person" | "opportunity" | "system" | "skill" | "lens" | "agents";
}

export interface ConciergeAnswer {
  kind: "concierge";
  query: string;
  answer: string;
  mode: "tool-calling" | "planned";
  provider: string;            // vertex | cache | template
  model: string;
  grounded: boolean;           // every figure in the answer was found in a tool result
  steps: { tool: string; args: string; result: string; ms: number; ai?: boolean }[];
  refs: ConciergeRef[];
  followUps: string[];
  highlight: { nodeIds: string[]; stars: string[] };
  elapsedMs: number;
}

export type AskResult = AskResponse | ExecAnswer | ConciergeAnswer;

export interface GrowthPaths {
  readyNow: { opportunityId: string; title: string; role: string; score: number }[];
  nearlyReady: { opportunityId: string; title: string; role: string; readiness: number; weeks: number; costAmt: number; steps: string[] }[];
}

// ---------------------------------------------------------------- People Signals
export type SignalKind = "bridges" | "bottlenecks" | "rising" | "islands" | "forgotten" | "ghosts";

export interface SignalItem {
  id: string;
  title: string;
  subtitle: string;
  metric: string;
  metricLabel: string;
  facts: string[];
  spark?: number[];     // contributions per quarter from 2025 Q1
  sparkLabels?: string[];
  people: { id: string; name: string }[];
  focusId: string;
  nodeIds: string[];
  score: number;
}

export interface SignalResult {
  kind: SignalKind;
  title: string;
  question: string;
  description: string;
  method: string[];
  items: SignalItem[];
  generatedAt: string;
}

// ---------------------------------------------------------------- AI agents
export type AgentId = "connectivity" | "people" | "scout" | "sentinel" | "concierge";

export interface AgentInfo {
  id: AgentId;
  name: string;
  goal: string;
  triggers: string[];
  tools: string[];
  aiStep: string;
  proposes: string[];
  approver: string;
  icon: string;
}

export interface AgentRunView {
  id: number;
  agent: AgentId;
  trigger: string;
  status: "running" | "done" | "failed";
  startedAt: string;
  finishedAt: string | null;
  steps: { tool: string; detail: string; ms: number; ai?: boolean }[];
  summary: string;
  provider: string;
  nodeIds: string[];
}

export interface InboxItem {
  id: number;
  agent: AgentId;
  kind: string;
  title: string;
  detail: string;
  evidence: string[];
  valueAmt: number;
  nodeIds: string[];
  approver: string;
  status: "pending" | "approved" | "dismissed";
  provider: string;
  createdAt: string;
  outcome: string | null;
}

export interface AgentsView {
  agents: (AgentInfo & { state: "idle" | "running"; lastRun: string | null; runs: number })[];
  runs: AgentRunView[];
  inbox: InboxItem[];
  pending: number;
  busy: boolean;
  graphVersion: number;
  queued: number;
}

export interface WhatIfResult {
  removed: { personId: string; name: string }[];
  systems: { id: string; name: string; criticality: string; coverageLost: number; remainingExperts: number }[];
  customers: { id: string; name: string }[];
  incidentsShare: number;
  highlight: { nodeIds: string[]; edgeIds: string[] };
}
