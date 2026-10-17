import { NextResponse } from "next/server";
import { SIGNAL_KINDS, signals } from "../../../../lib/engine/signals.ts";
import type { SignalKind } from "../../../../lib/types.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { kind: string } }) {
  if (!SIGNAL_KINDS.includes(params.kind as SignalKind)) return NextResponse.json({ error: `Unknown signal: ${params.kind}` }, { status: 404 });
  try {
    return NextResponse.json(signals(params.kind as SignalKind));
  } catch (e) {
    return NextResponse.json({ error: `Could not compute ${params.kind}: ${(e as Error).message}` }, { status: 500 });
  }
}
