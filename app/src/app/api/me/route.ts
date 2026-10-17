import { NextResponse } from "next/server";
import { currentUser } from "../../../lib/me/users.ts";
import { profileBundle } from "../../../lib/me/profile.ts";
import { applyAction, BadInput, decideForTeam, resetProfiles } from "../../../lib/me/write.ts";
import { tick } from "../../../lib/agents/runner.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noUser = () => NextResponse.json({ error: "Choose a demo user first." }, { status: 401 });

// GET /api/me: everything the profile tabs need for the signed-in (demo) user
export async function GET(req: Request) {
  const me = currentUser(req);
  if (!me) return noUser();
  const b = profileBundle(me);
  return b ? NextResponse.json(b) : NextResponse.json({ error: "Person not found" }, { status: 404 });
}

// POST /api/me {section, action, ...fields}: one profile change; returns a confirmation and the updated bundle
export async function POST(req: Request) {
  const me = currentUser(req);
  if (!me) return noUser();
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.section !== "string" || typeof body.action !== "string") {
    return NextResponse.json({ error: "Send a section and an action." }, { status: 400 });
  }
  const { section, action, ...fields } = body as { section: string; action: string } & Record<string, unknown>;
  try {
    let message: string;
    let graph = false;
    if (section === "team") ({ message, graph } = decideForTeam(me, action === "skill" ? "skill" : "project", fields));
    else if (section === "data" && action === "reset") { const n = resetProfiles(me); message = n ? "Your profile is back to its original data." : "Nothing to undo."; graph = n > 0; }
    else ({ message, graph } = applyAction(me, section, action, fields));
    if (graph) void tick(true).catch(() => undefined);
    return NextResponse.json({ message, bundle: profileBundle(me) });
  } catch (e) {
    const status = e instanceof BadInput ? 400 : 500;
    return NextResponse.json({ error: status === 400 ? (e as Error).message : `Could not save: ${(e as Error).message}` }, { status });
  }
}
