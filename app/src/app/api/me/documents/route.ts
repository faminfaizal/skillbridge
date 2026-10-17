import fs from "node:fs";
import { NextResponse } from "next/server";
import { currentUser } from "../../../../lib/me/users.ts";
import { profileBundle } from "../../../../lib/me/profile.ts";
import { documentPath, uploadDocument } from "../../../../lib/me/documents.ts";
import { BadInput } from "../../../../lib/me/write.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/me/documents (multipart: file, kind): store, read the text, suggest skills; returns the updated bundle
export async function POST(req: Request) {
  const me = currentUser(req);
  if (!me) return NextResponse.json({ error: "Choose a demo user first." }, { status: 401 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
  try {
    const { message } = await uploadDocument(me, file, String(form?.get("kind") ?? "CV"));
    return NextResponse.json({ message, bundle: profileBundle(me) });
  } catch (e) {
    const bad = e instanceof BadInput;
    return NextResponse.json({ error: bad ? (e as Error).message : `Upload failed: ${(e as Error).message}` }, { status: bad ? 400 : 500 });
  }
}

// GET /api/me/documents?id=DOC-...&as=P-...: the owner's own file
export async function GET(req: Request) {
  const me = currentUser(req);
  if (!me) return NextResponse.json({ error: "Choose a demo user first." }, { status: 401 });
  const doc = documentPath(me, new URL(req.url).searchParams.get("id") ?? "");
  if (!doc || !fs.existsSync(doc.path)) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  return new NextResponse(fs.readFileSync(doc.path), {
    headers: { "content-type": doc.mime, "content-disposition": `inline; filename="${doc.filename.replace(/"/g, "")}"`, "x-content-type-options": "nosniff" },
  });
}
