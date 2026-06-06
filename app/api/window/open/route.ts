import { NextResponse } from "next/server";
import { openWindow } from "@/lib/engine";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { appName } = await req.json().catch(() => ({}));
  if (!appName || typeof appName !== "string") {
    return NextResponse.json({ error: "appName required" }, { status: 400 });
  }
  try {
    const { windowId, html } = await openWindow(appName);
    return NextResponse.json({ windowId, html });
  } catch (e) {
    console.error("open failed", e);
    return NextResponse.json({ error: "open failed" }, { status: 502 });
  }
}
