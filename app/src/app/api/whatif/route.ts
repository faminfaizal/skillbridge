import { NextResponse } from "next/server";
import { whatIf } from "../../../lib/engine/whatif.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { removePersonIds } = (await req.json().catch(() => ({}))) as { removePersonIds?: string[] };
  if (!removePersonIds?.length) return NextResponse.json({ error: "Choose at least one person." }, { status: 400 });
  return NextResponse.json(whatIf(removePersonIds));
}
