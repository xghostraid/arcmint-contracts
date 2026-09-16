"use client";

import { useAccount } from "wagmi";
import { TokenGrid } from "./TokenCard";
import type { CatalogToken } from "@/lib/catalog";

export function CreatorTokens({ tokens }: { tokens: CatalogToken[] }) {
  const { address, isConnected } = useAccount();
  if (!isConnected || !address) {
    return <p className="empty">Connect a wallet to see tokens you created.</p>;
  }
  const mine = tokens.filter((t) => t.creator.toLowerCase() === address.toLowerCase());
  return <TokenGrid tokens={mine} empty="You have not launched a token yet." />;
}
