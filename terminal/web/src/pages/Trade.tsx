import { useEffect, useState } from "react";
import { api, lamportsToSol, type ActionResult, type TokenInfo } from "../api";
import { Addr, Card, ErrorBox, ExecControls, Field, ResultView, WalletPicker, execBody, useAction, type ExecSettings } from "../components/ui";
import { useApp, useBalances } from "../state";

interface Leg {
  label: string;
  lamports: string;
  tokens: string;
}
type TradeResult = ActionResult & { venue: string; legs: Leg[] };

export function Trade({ initialMint }: { initialMint?: string }) {
  const { wallets, groups, status } = useApp();
  const [mintInput, setMintInput] = useState(initialMint ?? "");
  const [mint, setMint] = useState(initialMint ?? "");
  const [selected, setSelected] = useState<number[]>([]);
  const [buySol, setBuySol] = useState("0.05");
  const [sellPct, setSellPct] = useState("50");
  const [exec, setExec] = useState<ExecSettings>({
    slippagePct: "5",
    priorityMicroLamports: String(status.defaults.priorityMicroLamports),
    mode: "parallel",
    jitoTipSol: String(status.defaults.jitoTipLamports / 1e9),
    dryRun: false,
  });
  const token = useAction<TokenInfo>();
  const trade = useAction<TradeResult>();
  const { balances, reload } = useBalances(null, token.result ? mint : undefined);

  useEffect(() => {
    if (mint) void token.run(() => api<TokenInfo>("GET", `/tokens/${mint}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mint]);

  const info = token.result;
  const go = (side: "buy" | "sell") =>
    trade.run(async () => {
      const body = side === "buy" ? { mint, walletIds: selected, solPerWallet: buySol, ...execBody(exec) } : { mint, walletIds: selected, percent: Number(sellPct), ...execBody(exec) };
      const r = await api<TradeResult>("POST", `/trade/${side}`, body);
      void reload();
      void token.run(() => api<TokenInfo>("GET", `/tokens/${mint}`));
      return r;
    });

  const held = selected.reduce((n, id) => {
    const w = wallets.find((x) => x.id === id);
    return n + Number((w && balances.token?.[w.address]) ?? 0);
  }, 0);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Trade</h1>
      </div>
      <Card>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            setMint(mintInput.trim());
          }}
        >
          <input className="grow mono" placeholder="Token mint address" value={mintInput} onChange={(e) => setMintInput(e.target.value)} />
          <button className="primary">Load</button>
        </form>
        <ErrorBox error={token.error} />
        {info && (
          <div className="token-card">
            <div>
              <div className="token-name">
                {info.name ?? "Unknown token"} <span className="muted">{info.symbol ?? ""}</span>
              </div>
              <Addr address={info.mint} />
            </div>
            <Stat label="Venue" value={info.venue ?? "none"} sub={info.venueNote} />
            {info.curve && (
              <>
                <Stat label="Market cap" value={`${lamportsToSol(info.curve.marketCapLamports, 2)} SOL`} />
                <Stat label="Curve progress" value={`${info.curve.progressPct.toFixed(1)}%`} sub={info.curve.complete ? "graduated" : "bonding"} />
                <Stat label="Creator" value={info.creatorIsOwn ? "your wallet" : "external"} />
              </>
            )}
          </div>
        )}
      </Card>

      {info && (
        <div className="cols">
          <Card title="Wallets" actions={<button onClick={() => void reload()}>↻</button>}>
            <WalletPicker wallets={wallets} groups={groups} selected={selected} onChange={setSelected} balances={balances} decimals={info.decimals} tokenLabel={info.symbol ?? "Token"} />
            <p className="small muted">Selected wallets hold {(held / 10 ** info.decimals).toLocaleString("en-US", { maximumFractionDigits: 0 })} {info.symbol}.</p>
          </Card>
          <div>
            <Card title="Order">
              <ExecControls value={exec} onChange={setExec} bundles={status.bundles} />
              <div className="split">
                <div>
                  <Field label="Buy: SOL per wallet" hint={`total ${(Number(buySol) * selected.length).toFixed(3)} SOL`}>
                    <input value={buySol} onChange={(e) => setBuySol(e.target.value)} inputMode="decimal" />
                  </Field>
                  <button className="buy" disabled={!selected.length || trade.busy || !info.venue} onClick={() => void go("buy")}>
                    {exec.dryRun ? "Simulate buy" : `Buy with ${selected.length} wallet(s)`}
                  </button>
                </div>
                <div>
                  <Field label="Sell: % of each wallet’s balance">
                    <div className="row">
                      <input value={sellPct} onChange={(e) => setSellPct(e.target.value)} inputMode="decimal" />
                      {[25, 50, 100].map((p) => (
                        <button type="button" className="chip" key={p} onClick={() => setSellPct(String(p))}>
                          {p}%
                        </button>
                      ))}
                    </div>
                  </Field>
                  <button className="sell" disabled={!selected.length || trade.busy || !info.venue} onClick={() => void go("sell")}>
                    {exec.dryRun ? "Simulate sell" : `Sell from ${selected.length} wallet(s)`}
                  </button>
                </div>
              </div>
              <ErrorBox error={trade.error} />
            </Card>
            {trade.result && (
              <Card title={`Result · ${trade.result.venue}`}>
                <ResultView result={trade.result} />
                <table className="table compact">
                  <thead>
                    <tr>
                      <th>Wallet</th>
                      <th className="num">SOL</th>
                      <th className="num">{info.symbol}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trade.result.legs.map((l) => (
                      <tr key={l.label}>
                        <td>{l.label}</td>
                        <td className="num">{lamportsToSol(l.lamports)}</td>
                        <td className="num">{(Number(l.tokens) / 10 ** info.decimals).toLocaleString("en-US", { maximumFractionDigits: 0 })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}
