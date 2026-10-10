import { NextRequest, NextResponse } from "next/server";
import { loadCatalog } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const catalog = await loadCatalog();
  const limit = Math.min(50, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 20) || 20));
  const items = catalog.tokens.slice(0, limit).map((t) => ({
    type: "launch",
    token: t.token,
    pool: t.pool,
    creator: t.creator,
    name: t.name,
    symbol: t.symbol,
    blockTime: t.createdAt,
  }));
  return NextResponse.json({
    syncedAt: catalog.syncedAt,
    total: items.length,
    items,
    source: catalog.source,
  });
}
