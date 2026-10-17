import { NextResponse } from "next/server";
import { currentUser } from "../../../../lib/me/users.ts";
import { constellation } from "../../../../lib/me/constellation.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/me/constellation: the signed-in person's own graph (two rings plus profile-only links), laid out radially
export async function GET(req: Request) {
  const me = currentUser(req);
  if (!me) return NextResponse.json({ error: "Choose a demo user first." }, { status: 401 });
  const c = constellation(me);
  return c ? NextResponse.json(c) : NextResponse.json({ error: "Person not found" }, { status: 404 });
}
