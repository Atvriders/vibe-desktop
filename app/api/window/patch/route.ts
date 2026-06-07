// SSRF-safe: this route never fetches a user URL — "browser" pages are hallucinated by Claude, not fetched.
import { NextResponse } from "next/server";
import { patchWindow, UnknownWindowError } from "@/lib/engine";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { windowId, elementId, x, y, action, inputs, domSnapshot } = await req.json().catch(() => ({}));
  if (!windowId || typeof x !== "number" || typeof y !== "number") {
    return NextResponse.json({ error: "windowId, x and y required" }, { status: 400 });
  }
  try {
    const result = await patchWindow(windowId, {
      elementId: elementId ?? null,
      x,
      y,
      action: action === "contextmenu" ? "contextmenu" : "click",
      inputs: inputs ?? {},
      domSnapshot,
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof UnknownWindowError) {
      return NextResponse.json({ error: "unknown window" }, { status: 404 });
    }
    console.error("patch failed", e);
    return NextResponse.json({ error: "patch failed" }, { status: 502 });
  }
}
