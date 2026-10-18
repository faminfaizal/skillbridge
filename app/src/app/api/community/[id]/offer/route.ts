import { NextResponse } from "next/server";
import { board, offer } from "../../../../../lib/engine/community.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/community/:id/offer: the People Growth agent offers the best volunteer (a proposal in the inbox)
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const r = offer(params.id);
  return NextResponse.json({ ...r, requests: board() }, { status: r.proposed || r.inboxId ? 200 : 409 });
}
