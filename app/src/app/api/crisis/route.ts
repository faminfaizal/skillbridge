import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { latestCrisis, respond, SAMPLE_SITREP } from "../../../lib/engine/crisis.ts";
import { BadInput, photoFrom, type IntakeFile } from "../../../lib/engine/intake.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAMPLE = () => path.resolve(process.cwd(), "public/samples/sitrep-katherine.png");

function sample(): { file?: IntakeFile; fallbackText: string; text: string } {
  try {
    return { file: { mimeType: "image/png", data: fs.readFileSync(SAMPLE()) }, fallbackText: SAMPLE_SITREP, text: "" };
  } catch {
    return { text: SAMPLE_SITREP, fallbackText: SAMPLE_SITREP };
  }
}

// GET /api/crisis: the latest incident response plan (or null)
export async function GET() {
  return NextResponse.json({ crisis: latestCrisis() });
}

// POST /api/crisis: multipart {text, file (PNG/JPEG/WebP, 4 MB)} or JSON {text, sample}: read the report, staff the team, propose it
export async function POST(req: Request) {
  try {
    let input: { text?: string; file?: IntakeFile; fallbackText?: string };
    if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const form = await req.formData().catch(() => null);
      if (!form) throw new BadInput("The form could not be read.");
      input = form.get("sample") === "true" ? sample() : { text: String(form.get("text") ?? ""), file: await photoFrom(form.get("file")) };
    } else {
      const body = (await req.json().catch(() => ({}))) as { text?: string; sample?: boolean };
      input = body.sample ? sample() : { text: String(body.text ?? "") };
    }
    if (!input.text?.trim() && !input.file) throw new BadInput("Paste the situation report or add a photo of it.");
    return NextResponse.json({ crisis: await respond(input) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof BadInput ? 400 : 422 });
  }
}
