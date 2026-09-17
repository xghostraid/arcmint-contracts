import { NextRequest, NextResponse } from "next/server";
import { loadCatalog } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const catalog = await loadCatalog(true);
  const url = req.nextUrl;
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const creator = (url.searchParams.get("creator") ?? "").trim().toLowerCase();
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 100) || 100));
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);

  // Never drop TEST / smoke tickers — production arcmint.fun hides those and the board looks empty.
  let tokens = catalog.tokens;
  if (q) {
    tokens = tokens.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.symbol.toLowerCase().includes(q) ||
        t.token.toLowerCase().includes(q),
    );
  }
  if (creator) {
    tokens = tokens.filter((t) => t.creator.toLowerCase() === creator);
  }

  const page = tokens.slice(offset, offset + limit);
  return NextResponse.json(
    {
      syncedAt: catalog.syncedAt,
      launchCount: catalog.launchCount,
      total: tokens.length,
      limit,
      offset,
      tokens: page,
      source: catalog.source,
      toBlock: catalog.toBlock,
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
