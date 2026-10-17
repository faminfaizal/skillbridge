import { NextResponse } from "next/server";
import { decide } from "../../../../../lib/agents/inbox.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/agents/inbox/:id {decision: "approve" | "dismiss"}: a human decision on an agent proposal
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { decision } = (await req.json().catch(() => ({}))) as { decision?: string };
  if (decision !== "approve" && decision !== "dismiss") return NextResponse.json({ error: "decision must be approve or dismiss" }, { status: 400 });
  try {
    return NextResponse.json(decide(Number(params.id), decision));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 409 });
  }
}
