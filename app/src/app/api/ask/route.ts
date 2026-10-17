import { NextResponse } from "next/server";
import { ask } from "../../../lib/engine/ask.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { query } = (await req.json().catch(() => ({}))) as { query?: string };
  if (!query || !query.trim()) return NextResponse.json({ error: "Type what you are trying to achieve." }, { status: 400 });
  try {
    return NextResponse.json(await ask(query.trim().slice(0, 500)));
  } catch (e) {
    return NextResponse.json({ error: `Could not answer: ${(e as Error).message}` }, { status: 500 });
  }
}
