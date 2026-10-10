"use client";

import { useState, type FormEvent } from "react";
import { maxUint256, parseUnits } from "viem";
import { useAccount, useConnect, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { erc20Abi, poolAbi } from "@/lib/abi";
import { ARC_CHAIN_ID, TOKEN_DECIMALS, USDC_ADDRESS, USDC_DECIMALS } from "@/lib/chain";
import type { CatalogToken } from "@/lib/catalog";
import { showToast } from "./ToastHost";

function humanize(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/user rejected|denied|cancelled/i.test(message)) return "Transaction cancelled in wallet";
  if (/Unrecognized chain|chain 5042|switchChain/i.test(message)) {
    return "Switch your wallet to Arc Mainnet (chain 5042).";
  }
  if (/insufficient|allowance|transfer amount/i.test(message)) {
    return "Not enough USDC or token balance for this trade.";
  }
  if (/BuyLimit|CreatorBuy|TradingClosed|AlreadyGraduated/i.test(message)) {
    return "Trade rejected by the curve (limit or graduated).";
  }
  if (/reverted/i.test(message)) return "Trade reverted on-chain.";
  return message || "Trade failed";
}

export function TradeForm({ token }: { token: CatalogToken }) {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending: connecting } = useConnect();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, isPending } = useWriteContract();
  const publicClient = usePublicClient({ chainId: ARC_CHAIN_ID });
  const injected = connectors.find((c) => c.id === "injected") ?? connectors[0];

  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("0.01");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (!isConnected || !address) {
        if (!injected) throw new Error("No injected wallet found");
        await connect({ connector: injected });
        return;
      }
      if (chainId !== ARC_CHAIN_ID) await switchChainAsync({ chainId: ARC_CHAIN_ID });
      if (!publicClient) throw new Error("RPC not ready");
      if (token.graduated) throw new Error("This token has graduated — trading is closed on the curve.");

      const raw = amount.trim();
      if (!raw || Number(raw) <= 0) throw new Error("Enter an amount greater than 0");

      if (side === "buy") {
        const usdcIn = parseUnits(raw, USDC_DECIMALS);
        const allowance = await publicClient.readContract({
          address: USDC_ADDRESS,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address, token.pool],
        });
        if (allowance < usdcIn) {
          const approveHash = await writeContractAsync({
            address: USDC_ADDRESS,
            abi: erc20Abi,
            functionName: "approve",
            args: [token.pool, maxUint256],
            chainId: ARC_CHAIN_ID,
          });
          setBusy(true);
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }
        await publicClient.simulateContract({
          address: token.pool,
          abi: poolAbi,
          functionName: "buy",
          account: address,
          args: [usdcIn, 0n],
        });
        const hash = await writeContractAsync({
          address: token.pool,
          abi: poolAbi,
          functionName: "buy",
          args: [usdcIn, 0n],
          chainId: ARC_CHAIN_ID,
        });
        setBusy(true);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status === "reverted") throw new Error("Trade reverted on-chain.");
        showToast(`Bought $${token.symbol}`, `Spend ${raw} USDC on the curve.`);
      } else {
        const tokensIn = parseUnits(raw, TOKEN_DECIMALS);
        const allowance = await publicClient.readContract({
          address: token.token,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address, token.pool],
        });
        if (allowance < tokensIn) {
          const approveHash = await writeContractAsync({
            address: token.token,
            abi: erc20Abi,
            functionName: "approve",
            args: [token.pool, maxUint256],
            chainId: ARC_CHAIN_ID,
          });
          setBusy(true);
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }
        await publicClient.simulateContract({
          address: token.pool,
          abi: poolAbi,
          functionName: "sell",
          account: address,
          args: [tokensIn, 0n],
        });
        const hash = await writeContractAsync({
          address: token.pool,
          abi: poolAbi,
          functionName: "sell",
          args: [tokensIn, 0n],
          chainId: ARC_CHAIN_ID,
        });
        setBusy(true);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status === "reverted") throw new Error("Trade reverted on-chain.");
        showToast(`Sold $${token.symbol}`, `Sold ${raw} tokens back to the curve.`);
      }
    } catch (err) {
      const message = humanize(err);
      if (message !== "Transaction cancelled in wallet") setError(message);
      else setError(message);
    } finally {
      setBusy(false);
    }
  }

  const label = side === "buy" ? "USDC amount" : `${token.symbol} amount`;

  return (
    <form className="create-form trade-form" onSubmit={onSubmit}>
      <div className="trade-sides">
        <button type="button" className={side === "buy" ? "wallet-btn primary" : "wallet-btn"} onClick={() => setSide("buy")}>
          Buy
        </button>
        <button type="button" className={side === "sell" ? "wallet-btn primary" : "wallet-btn"} onClick={() => setSide("sell")}>
          Sell
        </button>
      </div>
      <label>
        {label}
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          placeholder={side === "buy" ? "0.01" : "0"}
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
              setError("No injected wallet found. Install MetaMask on Arc Mainnet.");
              return;
            }
            void connect({ connector: injected });
          }}
        >
          {connecting ? "Connecting…" : "Connect wallet"}
        </button>
      ) : (
        <button className="wallet-btn primary wide" type="submit" disabled={isPending || busy}>
          {busy || isPending ? "Confirming…" : side === "buy" ? "Buy" : "Sell"}
        </button>
      )}
      <p className="hint">Trades go to the live bonding curve on Arc. Approves USDC or the token only when needed.</p>
    </form>
  );
}
