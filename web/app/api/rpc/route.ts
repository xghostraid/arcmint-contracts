import { NextRequest, NextResponse } from "next/server";
import { ARC_RPC } from "@/lib/chain";

export const dynamic = "force-dynamic";

/** Browser-safe JSON-RPC proxy so launch confirmations are not blocked by origin CORS. */
export async function POST(req: NextRequest) {
  const body = await req.text();
  if (!body || body.length > 1_000_000) {
    return NextResponse.json({ error: "invalid rpc body" }, { status: 400 });
  }
  const upstream = await fetch(ARC_RPC, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "arcmint-catalog",
    },
    body,
  });
  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}
