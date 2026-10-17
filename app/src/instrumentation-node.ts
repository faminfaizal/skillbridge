// Node-only part of the boot hook (kept separate so the edge bundle never sees node: imports).
import { ensureRunner } from "./lib/agents/runner.ts";

export function startAgents(): void {
  try {
    ensureRunner();
    console.log("SkillBridge agents: runner started (watching the change log)");
  } catch (e) {
    console.error("SkillBridge agents did not start:", (e as Error).message);
  }
}
