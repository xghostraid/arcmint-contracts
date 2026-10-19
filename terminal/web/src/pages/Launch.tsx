import { useEffect, useState } from "react";
import { api, lamportsToSol, short, type ActionResult } from "../api";
import { Addr, Card, ErrorBox, ExecControls, Field, ResultView, WalletPicker, execBody, useAction, type ExecSettings } from "../components/ui";
import { useApp, useBalances } from "../state";

interface Allocation {
  walletId: number;
  address: string;
  label: string;
  role: "dev" | "bundle";
  lamports: string;
  tokens: string;
  supplyPct: number;
  balance: string;
  enough: boolean;
}
interface Plan {
  mint: string;
  allocations: Allocation[];
  totalLamports: string;
  totalSupplyPct: number;
  marketCapAfterLamports: string;
  txCount: number;
  txLabels: string[];
  willBundle: boolean;
  lookupTable?: { used: boolean; addresses: number; address: string | null; txCountWithout: number };
  warnings: string[];
}
type LaunchResult = ActionResult & { launchId: number | null; plan: Plan };
interface LaunchRecord {
  id: number;
  mint: string;
  name: string;
  symbol: string;
  status: string;
  plan: Plan;
  lookupTable: string | null;
  lookupTableStatus: "active" | "deactivated" | "closed" | null;
  createdAt: string;
}

const MAX_BUNDLE_WALLETS = 18;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function Launch({ onOpenToken }: { onOpenToken: (mint: string) => void }) {
  const { wallets, groups, status } = useApp();
  const active = wallets.filter((w) => w.status === "active");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [uri, setUri] = useState("");
  const [devWallet, setDevWallet] = useState("");
  // Devnet's pump.fun config seeds curves with 0.3 virtual SOL instead of 30, so mainnet-sized buys would exhaust it.
  const defaultBuy = status.network === "mainnet" ? "0.5" : "0.02";
  const [devBuy, setDevBuy] = useState(defaultBuy);
  const [buyers, setBuyers] = useState<number[]>([]);
  const [buyEach, setBuyEach] = useState(defaultBuy);
  const [overrides, setOverrides] = useState<Record<number, string>>({});
  const [exec, setExec] = useState<ExecSettings>({ slippagePct: "10", priorityMicroLamports: String(status.defaults.priorityMicroLamports), mode: "bundle", jitoTipSol: String(status.defaults.jitoTipLamports / 1e9), dryRun: true });
  const [tableMode, setTableMode] = useState<"auto" | "on" | "off">("auto");
  const [history, setHistory] = useState<LaunchRecord[]>([]);
  const [reclaimNote, setReclaimNote] = useState<Record<number, string>>({});
  const { balances, reload } = useBalances(null);
  const upload = useAction<string>();
  const run = useAction<LaunchResult>();
  const reclaim = useAction<{ status: string; error?: string }>();

  const loadHistory = () => void api<LaunchRecord[]>("GET", "/launches").then(setHistory).catch(() => {});
  useEffect(loadHistory, []);

  const buyerRows = buyers.filter((b) => String(b) !== devWallet);
  const body = (dryRun: boolean) => ({
    name,
    symbol,
    uri,
    devWalletId: Number(devWallet),
    devBuySol: devBuy || "0",
    buyers: buyerRows.map((id) => ({ walletId: id, sol: overrides[id] || buyEach })),
    lookupTable: tableMode,
    ...execBody({ ...exec, dryRun }),
    mode: exec.mode === "parallel" ? "bundle" : exec.mode,
  });
  const totalSol = Number(devBuy || 0) + buyerRows.reduce((n, id) => n + Number(overrides[id] || buyEach || 0), 0);
  const plan = run.result?.plan;
  const ready = name && symbol && uri && devWallet && buyerRows.length <= MAX_BUNDLE_WALLETS;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Launch on Pump.fun</h1>
        <span className="muted small">create_v2 + dev buy + bundle buys from your own wallets{status.bundles ? ", landed together in one Jito bundle" : ". No Jito on this network: sent one after another"}.</span>
      </div>
      <div className="cols">
        <div>
          <Card title="1 · Token">
            <div className="grid2">
              <Field label="Name" hint="≤32">
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} />
              </Field>
              <Field label="Symbol" hint="≤10">
                <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} maxLength={10} />
              </Field>
            </div>
            <Field label="Description">
              <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <div className="grid2">
              <Field label="Image" hint="uploaded to pump.fun IPFS">
                <input type="file" accept="image/*" onChange={(e) => setImage(e.target.files?.[0] ?? null)} />
              </Field>
              <div className="field">
                <span className="field-label">&nbsp;</span>
                <button
                  disabled={!image || !name || !symbol || upload.busy}
                  onClick={() =>
                    void upload.run(async () => {
                      const r = await api<{ uri: string }>("POST", "/launch/metadata", { name, symbol, description, image: { base64: await fileToBase64(image!), type: image!.type, filename: image!.name } });
                      setUri(r.uri);
                      return r.uri;
                    })
                  }
                >
                  {upload.busy ? "Uploading…" : "Upload metadata"}
                </button>
              </div>
            </div>
            <Field label="Metadata URI" hint="or paste an existing https:// / ipfs:// JSON">
              <input className="mono" value={uri} onChange={(e) => setUri(e.target.value)} />
            </Field>
            <ErrorBox error={upload.error} />
          </Card>

          <Card title="2 · Dev wallet">
            <div className="grid2">
              <Field label="Creator / dev wallet">
                <select value={devWallet} onChange={(e) => setDevWallet(e.target.value)}>
                  <option value="">Choose…</option>
                  {active.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.label} — {lamportsToSol(balances.native[w.address] ?? 0)} SOL
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Dev buy" hint="SOL, 0 = none">
                <input value={devBuy} onChange={(e) => setDevBuy(e.target.value)} inputMode="decimal" />
              </Field>
            </div>
          </Card>

          <Card title={`3 · Bundle wallets (${buyerRows.length}/${MAX_BUNDLE_WALLETS})`} actions={<button onClick={() => void reload()}>↻</button>}>
            {buyerRows.length > MAX_BUNDLE_WALLETS && <div className="warn">At most {MAX_BUNDLE_WALLETS} bundle wallets: Solana caps a transaction at 64 instructions including inner calls, which limits a 5-transaction bundle to 18 buys even with a lookup table.</div>}
            <WalletPicker wallets={wallets} groups={groups} selected={buyers} onChange={setBuyers} balances={balances} exclude={devWallet ? [Number(devWallet)] : []} />
            <Field label="SOL per bundle wallet" hint="override per wallet below">
              <input value={buyEach} onChange={(e) => setBuyEach(e.target.value)} inputMode="decimal" />
            </Field>
            {buyerRows.length > 0 && (
              <div className="overrides">
                {buyerRows.map((id) => {
                  const w = wallets.find((x) => x.id === id)!;
                  return (
                    <label key={id} className="override">
                      <span>{w.label}</span>
                      <input placeholder={buyEach} value={overrides[id] ?? ""} onChange={(e) => setOverrides({ ...overrides, [id]: e.target.value })} inputMode="decimal" />
                    </label>
                  );
                })}
              </div>
            )}
          </Card>

          <Card title="4 · Execution">
            <ExecControls value={exec} onChange={setExec} bundles={status.bundles} modes={["bundle", "sequential"]} />
            <div className="grid2">
              <Field label="Address lookup table" hint="needed for 9+ bundle wallets">
                <select value={tableMode} onChange={(e) => setTableMode(e.target.value as typeof tableMode)}>
                  <option value="auto">auto: only when it saves transactions</option>
                  <option value="on">always</option>
                  <option value="off">never</option>
                </select>
              </Field>
            </div>
            {tableMode !== "off" && (
              <p className="small muted">
                The table is created and finalized (~13 s on mainnet) before the launch, so it puts the mint and wallet addresses on-chain a few seconds early. It is deactivated after the launch; reclaim its rent from the history below once it has cooled down.
              </p>
            )}
            <p className="small muted">Total buys: {totalSol.toFixed(4)} SOL (cap {status.maxSolPerAction} SOL per action).</p>
            <div className="row">
              <button disabled={!ready || run.busy} onClick={() => void run.run(() => api<LaunchResult>("POST", "/launch", body(true)))}>
                {run.busy && exec.dryRun ? "Simulating…" : "Simulate plan"}
              </button>
              <button
                className="primary"
                disabled={!ready || run.busy}
                onClick={() => {
                  if (!confirm(`Launch ${symbol} and spend ${totalSol.toFixed(4)} SOL across ${buyerRows.length + 1} wallets on ${status.network}?`)) return;
                  void run.run(async () => {
                    const r = await api<LaunchResult>("POST", "/launch", body(false));
                    loadHistory();
                    void reload();
                    return r;
                  });
                }}
              >
                Launch
              </button>
            </div>
            <ErrorBox error={run.error} />
          </Card>
        </div>

        <div>
          <Card title={plan ? (run.result?.dryRun ? "Plan (simulated)" : "Launch result") : "Plan"}>
            {!plan && <p className="muted">Fill in the token and wallets, then simulate to see each wallet’s allocation. Simulation checks the create transaction against the chain; later bundle transactions depend on it and are validated by balance.</p>}
            {plan && (
              <>
                <div className="stats">
                  <div className="stat">
                    <div className="stat-label">Your wallets’ supply</div>
                    <div className="stat-value accent">{plan.totalSupplyPct.toFixed(2)}%</div>
                  </div>
                  <div className="stat">
                    <div className="stat-label">SOL into curve</div>
                    <div className="stat-value">{lamportsToSol(plan.totalLamports)}</div>
                  </div>
                  <div className="stat">
                    <div className="stat-label">Mcap after</div>
                    <div className="stat-value">{lamportsToSol(plan.marketCapAfterLamports, 2)} SOL</div>
                  </div>
                  <div className="stat">
                    <div className="stat-label">Transactions</div>
                    <div className="stat-value">
                      {plan.txCount}
                      {plan.willBundle ? " · 1 bundle" : ""}
                    </div>
                  </div>
                </div>
                {plan.lookupTable && (
                  <p className="small muted">
                    Lookup table: {plan.lookupTable.used ? <span className="ok-text">used</span> : "not used"} · {plan.lookupTable.addresses} addresses · {plan.lookupTable.txCountWithout} transactions without it
                    {plan.lookupTable.address && (
                      <>
                        {" "}
                        · <Addr address={plan.lookupTable.address} />
                      </>
                    )}
                  </p>
                )}
                {plan.warnings.map((w) => (
                  <div key={w} className="warn">
                    {w}
                  </div>
                ))}
                <table className="table compact">
                  <thead>
                    <tr>
                      <th>Wallet</th>
                      <th>Role</th>
                      <th className="num">SOL</th>
                      <th className="num">Tokens</th>
                      <th className="num">Supply</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.allocations.map((a) => (
                      <tr key={a.walletId} className={a.enough ? "" : "bad-row"}>
                        <td>{a.label}</td>
                        <td>{a.role}</td>
                        <td className="num">{lamportsToSol(a.lamports)}</td>
                        <td className="num">{(Number(a.tokens) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 0 })}</td>
                        <td className="num">{a.supplyPct.toFixed(2)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="small muted">
                  Mint {run.result?.dryRun ? "(a fresh one is generated at launch)" : ""}: <Addr address={plan.mint} />
                </p>
                <ResultView result={run.result} />
                {!run.result?.dryRun && run.result?.txs[0]?.status === "confirmed" && (
                  <button className="primary" onClick={() => onOpenToken(plan.mint)}>
                    Open dashboard →
                  </button>
                )}
              </>
            )}
          </Card>

          <Card title="Launch history">
            <table className="table compact">
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td>
                      <b>{h.symbol}</b> {h.name}
                    </td>
                    <td>
                      <span className={`pill ${h.status === "confirmed" ? "ok" : "bad"}`}>{h.status}</span>
                    </td>
                    <td className="num">{h.plan.totalSupplyPct.toFixed(1)}% own</td>
                    <td>
                      <button className="link" onClick={() => onOpenToken(h.mint)}>
                        {short(h.mint)}
                      </button>
                    </td>
                    <td className="small">
                      {h.lookupTable && (
                        <span className="row">
                          <span className="muted">table {h.lookupTableStatus}</span>
                          {h.lookupTableStatus !== "closed" && (
                            <button
                              className="chip"
                              disabled={reclaim.busy}
                              onClick={() =>
                                void reclaim.run(async () => {
                                  const r = await api<{ status: string; error?: string }>("POST", `/launches/${h.id}/reclaim-table`);
                                  setReclaimNote({ ...reclaimNote, [h.id]: r.error ?? "" });
                                  loadHistory();
                                  return r;
                                })
                              }
                            >
                              {h.lookupTableStatus === "active" ? "deactivate" : "reclaim rent"}
                            </button>
                          )}
                          {reclaimNote[h.id] && <span className="muted">{reclaimNote[h.id]}</span>}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {!history.length && (
                  <tr>
                    <td className="muted">No launches yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
            <ErrorBox error={reclaim.error} />
          </Card>
        </div>
      </div>
    </div>
  );
}
