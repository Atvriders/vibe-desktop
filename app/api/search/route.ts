import { NextResponse } from "next/server";
import { searchApps } from "@/lib/engine";
import { guardRequest, errorResponse } from "@/lib/http-guard";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const blocked = guardRequest(req);
  if (blocked) return blocked;

  const { query } = await req.json().catch(() => ({}));
  if (!query || typeof query !== "string") {
    return NextResponse.json({ error: "query required" }, { status: 400 });
  }
  try {
    const cards = await searchApps(query);
    return NextResponse.json({ cards });
  } catch (e) {
    console.error("search failed", e);
    return errorResponse(e, "search");
  }
}
