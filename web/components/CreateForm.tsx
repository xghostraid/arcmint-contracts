"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { zeroAddress } from "viem";
import { useAccount, useConnect, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { factoryAbi } from "@/lib/abi";
import { ARC_CHAIN_ID, EXPLORER_URL, FACTORY_ADDRESS } from "@/lib/chain";
import { requestLaunchNotifications, showToast } from "./ToastHost";

const MAX_METADATA_CHARS = 2048;

function humanizeLaunchError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/user rejected|denied|cancelled/i.test(message)) return "Transaction cancelled in wallet";
  if (/Unrecognized chain|addEthereumChain|chain 5042|switchChain/i.test(message)) {
    return "Switch your wallet to Arc Mainnet (chain 5042).";
  }
  if (/insufficient funds|exceeds allowance|gas/i.test(message)) {
    return "Not enough USDC on Arc Mainnet to cover gas.";
  }
  if (/InvalidFee/i.test(message)) return "Creator fee is above the factory maximum.";
  if (/InvalidTeam/i.test(message)) return "Team allocation settings are invalid.";
  if (/reverted/i.test(message)) return "Launch transaction reverted on-chain.";
  if (/failed to fetch|network|cors/i.test(message)) return "Network error talking to Arc RPC. Try again.";
  return message || "Launch failed";
}

function sanitizeMetadata(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (value.startsWith("data:")) {
    throw new Error("Do not paste a data URL as metadata — that bloated payload is what stopped launches. Use ipfs:// or leave this blank.");
  }
  if (value.length > MAX_METADATA_CHARS) {
    throw new Error("Metadata URI is too long for a launch transaction. Use a short ipfs:// CID or leave it blank.");
  }
  return value;
}

type WaitResponse = {
  ok: boolean;
  error?: string;
  token?: `0x${string}` | null;
  listed?: boolean;
};

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

  async function ensureArcChain() {
    if (chainId === ARC_CHAIN_ID) return;
    await switchChainAsync({ chainId: ARC_CHAIN_ID });
  }

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
      await ensureArcChain();
      if (!publicClient) throw new Error("RPC not ready");

      const launchName = name.trim();
      const ticker = symbol.trim().toUpperCase();
      if (!launchName || !ticker) throw new Error("Name and symbol are required");
      const uri = sanitizeMetadata(metadataURI);
      const params = {
        name: launchName,
        symbol: ticker,
        metadataURI: uri,
        creatorFeeBps: 100,
        curveType: 0,
        teamAllocationBps: 0,
        teamWallet: zeroAddress,
        vestingCliff: 0,
        vestingDuration: 0,
        liquidityLocked: true,
        ownershipRenounced: false,
      } as const;

      await publicClient.simulateContract({
        address: FACTORY_ADDRESS,
        abi: factoryAbi,
        functionName: "createLaunch",
        account: address,
        args: [params],
      });

      const hash = await writeContractAsync({
        address: FACTORY_ADDRESS,
        abi: factoryAbi,
        functionName: "createLaunch",
        chainId: ARC_CHAIN_ID,
        args: [params],
      });
      setConfirming(true);
      showToast(`Launch submitted`, "Waiting for Arc to include the transaction…");

      let token: `0x${string}` | null = null;
      try {
        const waited = await fetch("/api/tx/wait", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ hash }),
        });
        const payload = (await waited.json()) as WaitResponse;
        if (!waited.ok || !payload.ok) {
          throw new Error(payload.error || "Launch transaction reverted");
        }
        token = payload.token ?? null;
      } catch (waitErr) {
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status === "reverted") throw waitErr instanceof Error ? waitErr : new Error("Launch transaction reverted");
        await fetch("/api/tokens/ingest", { method: "POST" }).catch(() => undefined);
      }

      if (!token) {
        const receipt = await publicClient.waitForTransactionReceipt({ hash }).catch(() => null);
        if (receipt) {
          const { launchedFromLogs } = await import("@/lib/receipt");
          token = launchedFromLogs(receipt.logs)?.token ?? null;
        }
      }

      await fetch("/api/tokens/ingest", { method: "POST" }).catch(() => undefined);

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
      const message = humanizeLaunchError(err);
      if (message === "Transaction cancelled in wallet") {
        setError(message);
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
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required={isConnected}
          maxLength={32}
          placeholder="Test Token"
        />
      </label>
      <label>
        Symbol
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          required={isConnected}
          maxLength={12}
          placeholder="TEST"
        />
      </label>
      <label>
        Metadata URI (optional)
        <input
          value={metadataURI}
          onChange={(e) => setMetadataURI(e.target.value)}
          placeholder="ipfs://… — leave blank if IPFS is down"
        />
      </label>
      {error ? <p className="form-error">{error}</p> : null}
      {!isConnected ? (
        <button
          className="wallet-btn primary wide"
          type="button"
          disabled={connecting}
          onClick={() => {
            if (!injected) {
              setError("No injected wallet found. Install MetaMask (or another injected wallet) on Arc Mainnet.");
              return;
            }
            setError(null);
            void connect({ connector: injected });
          }}
        >
          {connecting ? "Connecting…" : "Connect wallet"}
        </button>
      ) : (
        <button className="wallet-btn primary wide" type="submit" disabled={isPending || confirming}>
          {confirming ? "Confirming…" : isPending ? "Sign in wallet…" : "Launch token"}
        </button>
      )}
      <p className="hint">
        Image/IPFS is not required. The factory is called directly, then the catalog is refreshed from chain so the token
        shows on Live immediately. Explorer: {EXPLORER_URL}
      </p>
    </form>
  );
}
