import { NextResponse } from "next/server";
import { ask } from "../../../lib/engine/ask.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { query, sessionId } = (await req.json().catch(() => ({}))) as { query?: string; sessionId?: string };
  if (!query || !query.trim()) return NextResponse.json({ error: "Type what you are trying to achieve." }, { status: 400 });
  try {
    const sid = typeof sessionId === "string" && /^[\w-]{8,64}$/.test(sessionId) ? sessionId : undefined;
    return NextResponse.json(await ask(query.trim().slice(0, 500), { sessionId: sid }));
  } catch (e) {
    return NextResponse.json({ error: `Could not answer: ${(e as Error).message}` }, { status: 500 });
  }
}
