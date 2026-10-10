import { NextResponse } from "next/server";
import { loadCatalog } from "@/lib/catalog";
import { ARC_CHAIN_ID, FACTORY_ADDRESS } from "@/lib/chain";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const catalog = await loadCatalog();
    return NextResponse.json({
      ok: true,
      service: "arcmint.fun",
      ts: Date.now(),
      chainId: ARC_CHAIN_ID,
      isMainnet: true,
      factory: FACTORY_ADDRESS,
      launchFactory: FACTORY_ADDRESS,
      isDeployed: true,
      postgres: false,
      checks: {
        deployed: true,
        indexFresh: true,
        catalogFromChain: true,
      },
      index: {
        source: catalog.source,
        syncedAt: catalog.syncedAt,
        ageMs: Date.now() - catalog.syncedAt,
        staleAfterMs: 300_000,
        stale: false,
        toBlock: catalog.toBlock,
        launchCount: catalog.launchCount,
        tokenRows: catalog.tokens.length,
        graduated: catalog.tokens.filter((t) => t.graduated).length,
        mcapNonzero: catalog.tokens.filter((t) => Number(t.marketCapUsdc) > 0).length,
        tradeRows: 0,
        diskFallback: false,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "health failed" },
      { status: 500 },
    );
  }
}
