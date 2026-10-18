import { handlePush } from "../../../../lib/cloud/push.ts";
import { tick } from "../../../../lib/agents/runner.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/events/push?token=... : Pub/Sub push subscription endpoint. 403 on a bad token, 400 on a malformed
// envelope, 204 once recorded; then the agent runner processes the change log at once.
export async function POST(req: Request) {
  try {
    const r = await handlePush(req);
    if (r.status !== 204) return new Response(null, { status: r.status });
    void tick(true);
    return new Response(null, { status: 204 });
  } catch (e) {
    console.error("[cloud] push failed:", (e as Error).message);
    return new Response(null, { status: 500 });
  }
}
