// The executive questions (PRD 4) SkillBridge answers as decisions. Shared by the engine and the UI suggestions.
import type { ExecIntent } from "./types";

export const EXEC_QUESTIONS: Record<ExecIntent, string> = {
  gaps: "Where are our biggest capability gaps?",
  external: "What are we paying external parties for that we already possess?",
  future: "Which skills become critical in 2 years?",
  dependency: "Where are we over-dependent on individuals?",
  revenue: "Which under-utilised capabilities could generate revenue?",
  value: "How much value did internal reuse create this quarter?",
  invest: "Where should we invest the savings?",
  redeploy: "If AI takes over contact-centre work, where can those people go?",
};
