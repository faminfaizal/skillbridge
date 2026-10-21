// Shapes shared by the profile API and the profile page.
import type { GrowthPaths, Position } from "../types.ts";

export type TabId = "about" | "projects" | "skills" | "evidence" | "documents" | "certs" | "connections" | "feedback"
  | "suggestions" | "growth" | "availability" | "privacy" | "data" | "impact" | "constellation" | "team";

export type Audience = "everyone" | "division" | "managers" | "me";
export type Validation = "pending" | "confirmed" | "declined" | null;

export interface Ref { id: string; name: string }

export interface ProfileBundle {
  me: {
    id: string; name: string; title: string; level: string; email: string; division: string; department: string; location: string;
    hireYear: number; manager: { id: string; name: string; title: string } | null; reports: number; consent: boolean;
  };
  about: { headline: string; bio: string; languages: string[]; locationPref: string };
  position: Position | null; // current post, generated in the data pipeline
  completeness: { pct: number; next: { tab: TabId; text: string } | null; done: string[] };
  badges: Partial<Record<TabId, { count?: number; attention?: number }>>;
  projects: {
    system: { assignmentId: string; projectId: string; name: string; role: string; start: string; end: string; manDays: number; status: string; note: string; hidden: boolean; self: boolean }[];
    own: { id: string; name: string; type: string; role: string; start: string; end: string | null; effort: string; contribution: string; skills: Ref[]; link: string; status: "pending" | "confirmed" | "declined"; decidedBy: string | null; declineNote: string | null }[];
  };
  skills: { skillId: string; name: string; family: string; level: number; source: string; year: number; wantGrow: boolean; validation: Validation; evidence: number }[];
  growOnly: Ref[];
  suggested: { skillId: string; name: string; reason: string }[];
  evidence: {
    auto: { id: string; kind: string; text: string; date: string }[];
    own: { id: string; skillId: string; skill: string; kind: string; refId: string | null; refLabel: string; note: string; date: string; hidden: boolean }[];
  };
  documents: { id: string; filename: string; kind: string; size: number; uploadedAt: string; ai: string; shared: boolean;
    suggestions: { skillId: string; name: string; level: number; quote: string; status: "suggested" | "accepted" | "rejected"; have: boolean }[] }[];
  certs: { era: { certId: string; name: string; skill: string; year: number; self: boolean }[]; own: { id: string; name: string; issuer: string; issued: string; expiry: string }[] };
  connections: {
    workedWith: { id: string; name: string; title: string; shared: number }[];
    own: { id: string; otherId: string; name: string; title: string; kind: "mentor" | "mentee" | "goto"; skill: string | null }[];
  };
  feedback: {
    received: { id: string; from: string; question: string; project: string | null; date: string; text: string; hidden: boolean; thanked: boolean; feedbackId: string | null }[];
    given: { id: string; to: string; question: string; text: string; date: string }[];
    requests: { id: string; fromId: string; from: string; project: string | null; date: string }[];
    prompts: string[];
  };
  suggestions: { skillId: string; name: string; confidence: number; rationale: string; evidence: { kind: string; text: string; date: string }[] }[];
  growth: { interests: string[]; goals: string; targetRoles: string[]; paths: GrowthPaths };
  availability: { pct: number; openProjects: boolean; openSme: boolean; openMentoring: boolean; until: string };
  privacy: { consent: boolean; sections: Record<string, Audience> };
  history: { at: string; actor: string; section: string; summary: string }[];
  reports: { id: string; kind: string; target: string; message: string; status: string; date: string }[];
  impact: { valueAmt: number; records: { id: string; date: string; title: string; valueAmt: number }[]; recognition: number; incidents: number;
    projects: number; knowledge: { title: string; reuse: number }[] };
  team: null | {
    reports: { id: string; name: string; title: string }[];
    projects: { id: string; personId: string; person: string; name: string; type: string; role: string; start: string; end: string | null; effort: string; contribution: string; skills: string[] }[];
    skills: { personId: string; person: string; skillId: string; skill: string; level: number; evidence: number; date: string }[];
  };
  catalog: {
    skills: { id: string; name: string; family: string }[];
    people: { id: string; name: string; title: string }[];
    certifications: { id: string; name: string; skill: string }[];
    myProjects: Ref[];
    myKnowledge: Ref[];
    myIncidents: Ref[];
  };
}

export const LEVELS = [
  { n: 1, label: "Learning", hint: "Studying it or tried it once" },
  { n: 2, label: "With help", hint: "Can do it with guidance" },
  { n: 3, label: "On my own", hint: "Can do it alone, end to end" },
  { n: 4, label: "Advanced", hint: "Handles hard cases, improves how it is done" },
  { n: 5, label: "Others come to me", hint: "Go-to person; teaches others" },
] as const;

export const PROJECT_TYPES = ["POC", "Internal initiative", "Taskforce or committee", "Cross-division help", "Before joining", "Other"] as const;
export const EFFORTS = ["Under 5 days", "5 to 20 days", "20 to 60 days", "Over 60 days"] as const;
export const EFFORT_DAYS: Record<string, number> = { "Under 5 days": 3, "5 to 20 days": 12, "20 to 60 days": 40, "Over 60 days": 80 };
export const AUDIENCES: { id: Audience; label: string }[] = [
  { id: "everyone", label: "Everyone" }, { id: "division", label: "My division" }, { id: "managers", label: "Managers and HR" }, { id: "me", label: "Only me" },
];
/** Default visibility per tab, conservative where content is personal. */
export const DEFAULT_AUDIENCE: Partial<Record<TabId, Audience>> = {
  about: "everyone", projects: "everyone", skills: "everyone", evidence: "everyone", documents: "me", certs: "everyone",
  connections: "division", feedback: "me", growth: "managers", availability: "managers",
};
