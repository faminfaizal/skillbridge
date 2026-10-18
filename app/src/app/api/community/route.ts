import { NextResponse } from "next/server";
import { board, postRequest } from "../../../lib/engine/community.ts";
import { BadInput, photoFrom } from "../../../lib/engine/intake.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/community: the request board with matched volunteers
export async function GET() {
  return NextResponse.json({ requests: board() });
}

// POST /api/community: multipart {org, text, file} or JSON {org, text}: read the request, store it, offer the best volunteer
export async function POST(req: Request) {
  try {
    let input: { org?: string; text?: string; file?: Awaited<ReturnType<typeof photoFrom>> };
    if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const form = await req.formData().catch(() => null);
      if (!form) throw new BadInput("The form could not be read.");
      input = { org: String(form.get("org") ?? ""), text: String(form.get("text") ?? ""), file: await photoFrom(form.get("file")) };
    } else {
      const body = (await req.json().catch(() => ({}))) as { org?: string; text?: string };
      input = { org: String(body.org ?? ""), text: String(body.text ?? "") };
    }
    const request = await postRequest(input);
    return NextResponse.json({ request, requests: board() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof BadInput ? 400 : 422 });
  }
}
