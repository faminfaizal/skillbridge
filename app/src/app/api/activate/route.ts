import { NextResponse } from "next/server";
import { activate } from "../../../lib/engine/impact.ts";
import type { ValueEstimate } from "../../../lib/types.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { opportunityId?: string | null; title?: string; personIds?: string[]; value?: ValueEstimate; strategic?: string };
  if (!b.title || !b.personIds?.length || !b.value) return NextResponse.json({ error: "Nothing to activate: ask for a team first." }, { status: 400 });
  const record = activate(b.opportunityId ?? null, b.title, b.personIds, b.value, b.strategic ?? "Capability activated internally");
  return NextResponse.json(record);
}
