import Link from "next/link";
import type { CatalogToken } from "@/lib/catalog";
import { formatUsdFromMicro, shortenAddress, timeAgo } from "@/lib/format";

export function TokenCard({ token }: { token: CatalogToken }) {
  return (
    <Link href={`/token/${token.token}`} className="token-card">
      <div className="token-card-top">
        <div className="token-avatar">{token.symbol.slice(0, 2)}</div>
        <div>
          <p className="token-symbol">${token.symbol}</p>
          <p className="token-name">{token.name}</p>
        </div>
        {token.graduated ? <span className="pill">Graduated</span> : <span className="pill live">Live</span>}
      </div>
      <div className="token-meta">
        <span>Mcap {formatUsdFromMicro(token.marketCapUsdc)}</span>
        <span>{timeAgo(token.createdAt)}</span>
        <span>{shortenAddress(token.creator)}</span>
      </div>
    </Link>
  );
}

export function TokenGrid({ tokens, empty }: { tokens: CatalogToken[]; empty: string }) {
  if (!tokens.length) {
    return <p className="empty">{empty}</p>;
  }
  return (
    <div className="token-grid">
      {tokens.map((token) => (
        <TokenCard key={token.token} token={token} />
      ))}
    </div>
  );
}
