// Runs once when the Next.js server starts: start the agent runner so data changes are picked up without anyone
// opening the agents panel. Node runtime only (the runner needs node:sqlite); the edge build drops this branch.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startAgents } = await import("./instrumentation-node");
    startAgents();
  }
}
