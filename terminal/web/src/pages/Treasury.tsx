import { useState } from "react";
import { api, lamportsToSol, type ActionResult } from "../api";
import { Card, ErrorBox, Field, ResultView, WalletPicker, useAction } from "../components/ui";
import { useApp, useBalances } from "../state";

type TreasuryResult = ActionResult & { legs: { from: string; to: string; lamports: string }[] };

export function Treasury() {
  return (
    <div className="page">
      <div className="page-head">
        <h1>Treasury</h1>
        <span className="muted small">Plain on-chain SOL transfers between your own wallets, or out to an address you choose.</span>
      </div>
      <div className="cols">
        <Distribute />
        <Sweep />
      </div>
    </div>
  );
}

function Distribute() {
  const { wallets, groups, status } = useApp();
  const active = wallets.filter((w) => w.status === "active");
  const [from, setFrom] = useState<string>("");
  const [targets, setTargets] = useState<number[]>([]);
  const [splitMode, setSplitMode] = useState<"each" | "total">("each");
  const [amount, setAmount] = useState("0.1");
  const [dryRun, setDryRun] = useState(false);
  const { balances, reload } = useBalances(null);
  const a = useAction<TreasuryResult>();
  const n = targets.filter((t) => String(t) !== from).length;
  const each = splitMode === "each" ? Number(amount) : n ? Number(amount) / n : 0;
  const eachStr = each.toFixed(9).replace(/\.?0+$/, "");

  return (
    <Card title="Distribute (one → many)">
      <Field label="From wallet">
        <select value={from} onChange={(e) => setFrom(e.target.value)}>
          <option value="">Choose…</option>
          {active.map((w) => (
            <option key={w.id} value={w.id}>
              {w.label} — {lamportsToSol(balances.native[w.address] ?? 0)} SOL
            </option>
          ))}
        </select>
      </Field>
      <WalletPicker wallets={wallets} groups={groups} selected={targets} onChange={setTargets} balances={balances} exclude={from ? [Number(from)] : []} />
      <div className="grid4">
        <Field label="Amount" hint="SOL">
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Meaning">
          <select value={splitMode} onChange={(e) => setSplitMode(e.target.value as "each" | "total")}>
            <option value="each">per wallet</option>
            <option value="total">total, split evenly</option>
          </select>
        </Field>
        <label className="check">
          <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} /> Simulate only
        </label>
      </div>
      <p className="small muted">
        {n} wallet(s) × {eachStr || 0} SOL = {(each * n).toFixed(4)} SOL (cap {status.maxSolPerAction} SOL per action)
      </p>
      <button
        className="primary"
        disabled={!from || !n || a.busy}
        onClick={() =>
          void a.run(async () => {
            const r = await api<TreasuryResult>("POST", "/treasury/distribute", { fromWalletId: Number(from), toWalletIds: targets.filter((t) => String(t) !== from), solEach: eachStr, dryRun });
            void reload();
            return r;
          })
        }
      >
        {dryRun ? "Simulate" : "Distribute"}
      </button>
      <ErrorBox error={a.error} />
      <ResultView result={a.result} />
    </Card>
  );
}

function Sweep() {
  const { wallets, groups } = useApp();
  const active = wallets.filter((w) => w.status === "active");
  const [sources, setSources] = useState<number[]>([]);
  const [destKind, setDestKind] = useState<"wallet" | "address">("wallet");
  const [destWallet, setDestWallet] = useState("");
  const [destAddress, setDestAddress] = useState("");
  const [reserve, setReserve] = useState("0");
  const [fixed, setFixed] = useState("");
  const [dryRun, setDryRun] = useState(false);
  const { balances, reload } = useBalances(null);
  const a = useAction<TreasuryResult>();
  const total = sources.reduce((n, id) => n + Number(balances.native[active.find((w) => w.id === id)?.address ?? ""] ?? 0), 0);

  return (
    <Card title="Sweep / withdraw (many → one)">
      <WalletPicker wallets={wallets} groups={groups} selected={sources} onChange={setSources} balances={balances} exclude={destKind === "wallet" && destWallet ? [Number(destWallet)] : []} />
      <div className="grid4">
        <Field label="Destination">
          <select value={destKind} onChange={(e) => setDestKind(e.target.value as "wallet" | "address")}>
            <option value="wallet">one of my wallets</option>
            <option value="address">external address</option>
          </select>
        </Field>
        {destKind === "wallet" ? (
          <Field label="To wallet">
            <select value={destWallet} onChange={(e) => setDestWallet(e.target.value)}>
              <option value="">Choose…</option>
              {active.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label="To address">
            <input className="mono" value={destAddress} onChange={(e) => setDestAddress(e.target.value)} placeholder="Solana address" />
          </Field>
        )}
        <Field label="Keep in each" hint="SOL">
          <input value={reserve} onChange={(e) => setReserve(e.target.value)} inputMode="decimal" disabled={!!fixed} />
        </Field>
        <Field label="Fixed amount each" hint="blank = everything">
          <input value={fixed} onChange={(e) => setFixed(e.target.value)} inputMode="decimal" />
        </Field>
      </div>
      <label className="check">
        <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} /> Simulate only
      </label>
      <p className="small muted">Selected wallets hold {lamportsToSol(total)} SOL. Each wallet pays its own network fee.</p>
      <button
        className="primary"
        disabled={!sources.length || a.busy || (destKind === "wallet" ? !destWallet : !destAddress)}
        onClick={() =>
          void a.run(async () => {
            const r = await api<TreasuryResult>("POST", "/treasury/sweep", {
              fromWalletIds: sources,
              toWalletId: destKind === "wallet" ? Number(destWallet) : undefined,
              toAddress: destKind === "address" ? destAddress.trim() : undefined,
              reserveSol: reserve || "0",
              solEach: fixed || undefined,
              dryRun,
            });
            void reload();
            return r;
          })
        }
      >
        {dryRun ? "Simulate" : fixed ? "Withdraw" : "Sweep"}
      </button>
      <ErrorBox error={a.error} />
      <ResultView result={a.result} />
    </Card>
  );
}
