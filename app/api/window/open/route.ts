import { NextResponse } from "next/server";
import { openWindow } from "@/lib/engine";
import { guardRequest, errorResponse } from "@/lib/http-guard";
import type { AppDetail } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const blocked = guardRequest(req);
  if (blocked) return blocked;

  const { appName, blurb, query } = await req.json().catch(() => ({}));
  if (!appName || typeof appName !== "string") {
    return NextResponse.json({ error: "appName required" }, { status: 400 });
  }
  if (blurb !== undefined && typeof blurb !== "string") {
    return NextResponse.json({ error: "blurb required" }, { status: 400 });
  }
  if (query !== undefined && typeof query !== "string") {
    return NextResponse.json({ error: "query required" }, { status: 400 });
  }
  // Stay undefined when neither is present so WINDOW_SYSTEM's output is byte-identical to today's.
  // Trim, newline-collapse and the MAX_BLURB_LEN/MAX_QUERY_LEN caps are applied engine-side.
  const detail: AppDetail | undefined =
    blurb === undefined && query === undefined ? undefined : { blurb, query };

  try {
    const { windowId, html, usage } = await openWindow(appName, detail);
    return NextResponse.json({ windowId, html, usage });
  } catch (e) {
    console.error("open failed", e);
    return errorResponse(e, "open");
  }
}
