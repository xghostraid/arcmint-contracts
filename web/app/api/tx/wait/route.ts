import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { asTxHash, launchedFromLogs } from "@/lib/receipt";
import { invalidateCatalog, loadCatalog, loadToken } from "@/lib/catalog";
import { ARC_RPC, FACTORY_ADDRESS, arcMainnet } from "@/lib/chain";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const client = createPublicClient({
  chain: arcMainnet,
  transport: http(ARC_RPC, { timeout: 45_000 }),
});

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { hash?: string } | null;
  const hash = asTxHash(body?.hash ?? "");
  if (!hash) {
    return NextResponse.json({ ok: false, error: "Missing launch transaction hash" }, { status: 400 });
  }

  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 90_000, pollingInterval: 1_500 });
  if (receipt.status === "reverted") {
    return NextResponse.json(
      { ok: false, error: "Launch transaction reverted on-chain", hash, status: receipt.status },
      { status: 400 },
    );
  }

  const launched = launchedFromLogs(receipt.logs);
  invalidateCatalog();
  const catalog = await loadCatalog(true);
  const tokenRow = launched?.token ? await loadToken(launched.token) : null;

  return NextResponse.json({
    ok: true,
    hash,
    status: receipt.status,
    factory: FACTORY_ADDRESS,
    token: launched?.token ?? null,
    pool: launched?.pool ?? null,
    creator: launched?.creator ?? null,
    listed: Boolean(tokenRow),
    launchCount: catalog.launchCount,
    tokenRows: catalog.tokens.length,
  });
}
