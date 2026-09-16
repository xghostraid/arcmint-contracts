import { notFound } from "next/navigation";
import { loadToken } from "@/lib/catalog";
import { EXPLORER_URL } from "@/lib/chain";
import { formatUsdFromMicro, shortenAddress, timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function TokenPage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;
  const token = await loadToken(address);
  if (!token) notFound();

  return (
    <main className="detail">
      <p className="sub">{token.graduated ? "Graduated" : "Live on the curve"} · {timeAgo(token.createdAt)}</p>
      <h1>${token.symbol}</h1>
      <p className="sub">{token.name}</p>
      <div className="kv panel" style={{ maxWidth: 640, marginTop: 20 }}>
        <div><b>Token</b><span>{token.token}</span></div>
        <div><b>Pool</b><span>{token.pool}</span></div>
        <div><b>Creator</b><span>{token.creator}</span></div>
        <div><b>Market cap</b><span>{formatUsdFromMicro(token.marketCapUsdc)}</span></div>
        <div><b>Metadata</b><span>{token.metadataURI || "—"}</span></div>
      </div>
      <p className="hint" style={{ marginTop: 16 }}>
        Creator {shortenAddress(token.creator)} ·{" "}
        <a href={`${EXPLORER_URL}/address/${token.token}`} target="_blank" rel="noreferrer">
          Open in explorer
        </a>
      </p>
    </main>
  );
}
