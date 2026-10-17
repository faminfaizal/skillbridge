import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let cache: { mtime: number; body: string } | null = null;

export async function GET() {
  const file = path.resolve(process.cwd(), "../data/graph.json");
  if (!fs.existsSync(file)) return NextResponse.json({ error: "graph.json missing: run npm run precompute" }, { status: 503 });
  const mtime = fs.statSync(file).mtimeMs;
  if (!cache || cache.mtime !== mtime) cache = { mtime, body: fs.readFileSync(file, "utf-8") };
  return new NextResponse(cache.body, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
