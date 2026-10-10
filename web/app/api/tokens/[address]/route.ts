import { NextRequest, NextResponse } from "next/server";
import { loadToken } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ address: string }> },
) {
  const { address } = await context.params;
  const token = await loadToken(address);
  if (!token) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ token, trades: [], source: "chain" });
}
