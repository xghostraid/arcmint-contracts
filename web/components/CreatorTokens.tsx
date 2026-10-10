"use client";

import { useAccount } from "wagmi";
import { LiveBoard } from "./LiveBoard";
import type { CatalogToken } from "@/lib/catalog";

export function CreatorTokens({ tokens }: { tokens: CatalogToken[] }) {
  const { address, isConnected } = useAccount();
  if (!isConnected || !address) {
    return <p className="empty">Connect a wallet to see tokens you created.</p>;
  }
  return (
    <LiveBoard
      initial={tokens}
      creator={address}
      empty="You have not launched a token yet."
      notify={false}
    />
  );
}
