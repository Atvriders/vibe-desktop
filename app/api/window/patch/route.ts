import { NextResponse } from "next/server";
import { patchWindow, UnknownWindowError } from "@/lib/engine";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { windowId, elementId, domSnapshot } = await req.json().catch(() => ({}));
  if (!windowId || !elementId) {
    return NextResponse.json({ error: "windowId and elementId required" }, { status: 400 });
  }
  try {
    const { ops, cacheReadTokens } = await patchWindow(windowId, elementId, domSnapshot);
    return NextResponse.json({ ops, cacheReadTokens });
  } catch (e) {
    if (e instanceof UnknownWindowError) {
      return NextResponse.json({ error: "unknown window" }, { status: 404 });
    }
    console.error("patch failed", e);
    return NextResponse.json({ error: "patch failed" }, { status: 502 });
  }
}
