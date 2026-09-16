"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { decodeEventLog, zeroAddress } from "viem";
import { useAccount, useConnect, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { factoryAbi } from "@/lib/abi";
import { ARC_CHAIN_ID, EXPLORER_URL, FACTORY_ADDRESS } from "@/lib/chain";
import { requestLaunchNotifications, showToast } from "./ToastHost";

export function CreateForm() {
  const router = useRouter();
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending: connecting } = useConnect();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, isPending } = useWriteContract();
  const publicClient = usePublicClient({ chainId: ARC_CHAIN_ID });
  const injected = connectors.find((c) => c.id === "injected") ?? connectors[0];

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [metadataURI, setMetadataURI] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    requestLaunchNotifications();
    try {
      if (!isConnected || !address) {
        if (!injected) throw new Error("No injected wallet found");
        await connect({ connector: injected });
        return;
      }
      if (chainId !== ARC_CHAIN_ID) {
        await switchChainAsync({ chainId: ARC_CHAIN_ID });
      }
      if (!publicClient) throw new Error("RPC not ready");
      const hash = await writeContractAsync({
        address: FACTORY_ADDRESS,
        abi: factoryAbi,
        functionName: "createLaunch",
        chainId: ARC_CHAIN_ID,
        args: [
          {
            name: name.trim(),
            symbol: symbol.trim().toUpperCase(),
            metadataURI: metadataURI.trim(),
            creatorFeeBps: 0,
            curveType: 0,
            teamAllocationBps: 0,
            teamWallet: zeroAddress,
            vestingCliff: 0,
            vestingDuration: 0,
            liquidityLocked: true,
            ownershipRenounced: false,
          },
        ],
      });
      setConfirming(true);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status === "reverted") throw new Error("Launch transaction reverted");

      let token: `0x${string}` | null = null;
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: factoryAbi,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === "Launched") {
            token = decoded.args.token;
            break;
          }
        } catch {
          /* other logs */
        }
      }

      await fetch("/api/tokens/ingest", { method: "POST" }).catch(() => undefined);

      const ticker = symbol.trim().toUpperCase();
      if (token) {
        showToast(`$${ticker} is live`, "Token launched on the curve — opening it now.");
        router.push(`/token/${token}`);
        router.refresh();
        return;
      }
      showToast(
        `$${ticker} launched`,
        "Launch confirmed on-chain. Catalog is refreshing — check Live if the token page is slow.",
      );
      router.push("/");
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Launch failed";
      if (/user rejected|denied|cancelled/i.test(message)) {
        setError("Transaction cancelled in wallet");
        return;
      }
      setError(message);
    } finally {
      setConfirming(false);
    }
  }

  return (
    <form className="create-form" onSubmit={onSubmit}>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={32} placeholder="Test Token" />
      </label>
      <label>
        Symbol
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          required
          maxLength={12}
          placeholder="TEST"
        />
      </label>
      <label>
        Metadata URI (optional)
        <input
          value={metadataURI}
          onChange={(e) => setMetadataURI(e.target.value)}
          placeholder="ipfs://…"
        />
      </label>
      {error ? <p className="form-error">{error}</p> : null}
      <button className="wallet-btn primary wide" type="submit" disabled={isPending || confirming || connecting}>
        {!isConnected ? "Connect wallet" : confirming ? "Confirming…" : isPending ? "Sign in wallet…" : "Launch token"}
      </button>
      <p className="hint">
        Confirmed launches toast immediately, then appear on Live from chain — not a private database.
        Explorer: {EXPLORER_URL}
      </p>
    </form>
  );
}
