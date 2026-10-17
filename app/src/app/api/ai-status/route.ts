import { NextResponse } from "next/server";
import { aiStatus } from "../../../lib/llm.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/ai-status[?refresh=1]: which AI provider is answering right now (no secrets in the response)
export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get("refresh") === "1";
  return NextResponse.json(await aiStatus(force));
}
