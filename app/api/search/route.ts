import { NextResponse } from "next/server";
import { searchApps } from "@/lib/engine";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { query } = await req.json().catch(() => ({}));
  if (!query || typeof query !== "string") {
    return NextResponse.json({ error: "query required" }, { status: 400 });
  }
  const cards = await searchApps(query);
  return NextResponse.json({ cards });
}
