import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { data } from "../../../lib/engine/data.ts";
import { BadInput } from "../../../lib/engine/intake.ts";
import { readVacancy } from "../../../lib/engine/jd.ts";
import { searchPositions } from "../../../lib/engine/positions.ts";
import { matchVacancy } from "../../../lib/engine/vacancy.ts";
import type { VacancyInput } from "../../../lib/types.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAMPLE = "position-profile-network-analytics-lead.docx";
const sample = () => ({ filename: SAMPLE, data: fs.readFileSync(path.resolve(process.cwd(), "public/samples", SAMPLE)) });

// GET /api/vacancy?q=  posts by title, post id or holder name; without q: the skills list for the picker
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q");
  if (q !== null) return NextResponse.json({ positions: searchPositions(q) });
  const skills = [...data().skills.values()].map((s) => ({ id: s.id, name: s.name, family: s.family })).sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ skills });
}

// POST /api/vacancy
//   JSON {positionId} or {title, level?, responsibilities?, must, nice}  -> {vacancy, shortlist, privateCount, basis}
//   multipart {file} or {sample: "true"}, or JSON {sample: true}        -> {parsed, unmapped, provider, read} (check step)
export async function POST(req: Request) {
  try {
    if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const form = await req.formData().catch(() => null);
      if (!form) throw new BadInput("The form could not be read.");
      if (form.get("sample") === "true") return NextResponse.json(await readVacancy(sample()));
      const f = form.get("file");
      if (!(f instanceof File)) throw new BadInput("Choose a job description file.");
      return NextResponse.json(await readVacancy({ filename: f.name, data: Buffer.from(await f.arrayBuffer()) }));
    }
    const body = (await req.json().catch(() => ({}))) as Partial<VacancyInput> & { sample?: boolean };
    if (body.sample) return NextResponse.json(await readVacancy(sample()));
    const input: VacancyInput = {
      title: String(body.title ?? ""), level: body.level ? String(body.level) : null, positionId: body.positionId ? String(body.positionId) : null,
      responsibilities: Array.isArray(body.responsibilities) ? body.responsibilities.map(String).slice(0, 8) : [],
      competencies: Array.isArray(body.competencies) ? body.competencies.map(String).slice(0, 6) : [],
      must: Array.isArray(body.must) ? body.must.map(String) : [], nice: Array.isArray(body.nice) ? body.nice.map(String) : [],
    };
    return NextResponse.json(matchVacancy(input));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof BadInput ? 400 : 422 });
  }
}
