import { NextResponse } from "next/server";
import { deleteSession } from "@/lib/sessions";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { windowId } = await req.json().catch(() => ({}));
  if (typeof windowId === "string") deleteSession(windowId);
  return new NextResponse(null, { status: 204 });
}
