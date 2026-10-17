import { NextResponse } from "next/server";
import { currentUser } from "../../../../lib/me/users.ts";
import { profileBundle } from "../../../../lib/me/profile.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/me/export?as=P-...: download everything SkillBridge holds about me (PDPA access and portability)
export async function GET(req: Request) {
  const me = currentUser(req);
  if (!me) return NextResponse.json({ error: "Choose a demo user first." }, { status: 401 });
  const b = profileBundle(me);
  if (!b) return NextResponse.json({ error: "Person not found" }, { status: 404 });
  const { catalog: _catalog, team: _team, ...mine } = b;
  const body = JSON.stringify({ exportedAt: new Date().toISOString(), note: "Everything SkillBridge holds about you.", ...mine }, null, 2);
  return new NextResponse(body, {
    headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="skillbridge-${me}.json"` },
  });
}
