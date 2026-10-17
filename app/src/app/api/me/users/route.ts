import { NextResponse } from "next/server";
import { demoUsers } from "../../../../lib/me/users.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/me/users: the ten demo users for the temporary "Viewing as" switcher (replaced by SSO at go-live)
export async function GET() {
  return NextResponse.json(demoUsers());
}
