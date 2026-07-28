import { NextResponse } from "next/server";
import { deleteSession } from "@/lib/sessions";
import { guardRequest } from "@/lib/http-guard";

export const runtime = "nodejs";

// No try/catch and no errorResponse here: deleteSession is a Map.delete with no
// model call behind it, so there is no failure mode left to map.
export async function POST(req: Request) {
  const blocked = guardRequest(req);
  if (blocked) return blocked;

  const { windowId } = await req.json().catch(() => ({}));
  if (!windowId || typeof windowId !== "string") {
    return NextResponse.json({ error: "windowId required" }, { status: 400 });
  }
  deleteSession(windowId);
  return NextResponse.json({ ok: true });
}
