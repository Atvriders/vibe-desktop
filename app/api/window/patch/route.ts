// SSRF-safe: this route never fetches a user URL — "browser" pages are hallucinated by Claude, not fetched.
import { NextResponse } from "next/server";
import { patchWindow, UnknownWindowError } from "@/lib/engine";
import { guardRequest, errorResponse } from "@/lib/http-guard";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const blocked = guardRequest(req);
  if (blocked) return blocked;

  const { windowId, elementId, x, y, action, inputs, domSnapshot, instruction } =
    await req.json().catch(() => ({}));
  if (!windowId || typeof windowId !== "string" || typeof x !== "number" || typeof y !== "number") {
    return NextResponse.json({ error: "windowId, x and y required" }, { status: 400 });
  }
  if (domSnapshot !== undefined && typeof domSnapshot !== "string") {
    return NextResponse.json({ error: "domSnapshot required" }, { status: 400 });
  }
  if (instruction !== undefined && typeof instruction !== "string") {
    return NextResponse.json({ error: "instruction required" }, { status: 400 });
  }
  const safeAction: "click" | "contextmenu" | "submit" =
    action === "contextmenu" || action === "submit" ? action : "click";
  // A non-object `inputs` would otherwise be walked by Object.entries in patchWindow
  // and paste index keys straight into the prompt. Values are filtered too: the body
  // is `any`, so validating only the container would ship objects and nulls onward
  // still typed as strings.
  const safeInputs: Record<string, string> =
    inputs && typeof inputs === "object" && !Array.isArray(inputs)
      ? Object.fromEntries(
          Object.entries(inputs as Record<string, unknown>).filter(([, v]) => typeof v === "string"),
        ) as Record<string, string>
      : {};

  try {
    const { ops, stopReason, usage } = await patchWindow(windowId, {
      elementId: typeof elementId === "string" ? elementId : null,
      x,
      y,
      action: safeAction,
      inputs: safeInputs,
      domSnapshot,
      instruction,
    });
    return NextResponse.json({ ops, stopReason, usage });
  } catch (e) {
    // Most specific first: a dead session must not look like a model outage.
    if (e instanceof UnknownWindowError) {
      return NextResponse.json({ error: "unknown window" }, { status: 404 });
    }
    console.error("patch failed", e);
    return errorResponse(e, "patch");
  }
}
