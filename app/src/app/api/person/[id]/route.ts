import { NextResponse } from "next/server";
import { personProfile } from "../../../../lib/engine/person.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const profile = personProfile(params.id);
  if (!profile) return NextResponse.json({ error: "Person not found" }, { status: 404 });
  return NextResponse.json(profile);
}
