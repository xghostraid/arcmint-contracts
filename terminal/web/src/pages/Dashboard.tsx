import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CandlestickSeries, ColorType, HistogramSeries, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { api, lamportsToSol, onServerEvent, short, signedSol, tokenAmount, type Candle, type Holders, type Overview, type PnlReport, type TokenProfile, type Trade } from "../api";
import { Addr, Card, ErrorBox, useAction } from "../components/ui";
import { useApp } from "../state";
import { Stat } from "./Trade";

const INTERVALS = [
  { label: "1m", sec: 60 },
  { label: "5m", sec: 300 },
  { label: "15m", sec: 900 },
  { label: "1h", sec: 3_600 },
];

/** Market cap in SOL from a lamports-per-base-unit price. */
const mcapSol = (price: number, supply: string) => (price * Number(supply)) / 1e9;

function CandleChart({ candles, supply }: { candles: Candle[]; supply: string }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<{ c: ISeriesApi<"Candlestick">; v: ISeriesApi<"Histogram"> } | null>(null);
  useEffect(() => {
    if (!el.current) return;
    const c = createChart(el.current, {
      height: 320,
      layout: { background: { type: ColorType.Solid, color: "#141417" }, textColor: "#8b8b95" },
      grid: { vertLines: { color: "#1d1d22" }, horzLines: { color: "#1d1d22" } },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: "#26262c" },
      rightPriceScale: { borderColor: "#26262c" },
      autoSize: true,
    });
    const cs = c.addSeries(CandlestickSeries, { upColor: "#22c55e", downColor: "#ef4444", borderVisible: false, wickUpColor: "#22c55e", wickDownColor: "#ef4444", priceFormat: { type: "price", precision: 2, minMove: 0.01 } });
    const vs = c.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, color: "#ff5a1f55" });
    c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    chart.current = c;
    series.current = { c: cs, v: vs };
    return () => {
      c.remove();
      chart.current = null;
      series.current = null;
    };
  }, []);
  useEffect(() => {
    if (!series.current) return;
    series.current.c.setData(candles.map((k) => ({ time: k.time as UTCTimestamp, open: mcapSol(k.open, supply), high: mcapSol(k.high, supply), low: mcapSol(k.low, supply), close: mcapSol(k.close, supply) })));
    series.current.v.setData(candles.map((k) => ({ time: k.time as UTCTimestamp, value: Number(k.volumeLamports) / 1e9, color: k.close >= k.open ? "#22c55e55" : "#ef444455" })));
  }, [candles, supply]);
  return <div ref={el} className="chart" />;
}

export function Dashboard({ initialMint, onTrade }: { initialMint?: string; onTrade: (mint: string) => void }) {
  const { groups } = useApp();
  const [tokens, setTokens] = useState<TokenProfile[]>([]);
  const [mint, setMint] = useState(initialMint ?? "");
  const [address, setAddress] = useState("");
  const [interval, setBucket] = useState(60);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [holders, setHolders] = useState<Holders | null>(null);
  const [pnl, setPnl] = useState<PnlReport | null>(null);
  const [onlyOwn, setOnlyOwn] = useState(false);
  const track = useAction<TokenProfile>();
  const load = useAction<unknown>();
  const sync = useAction<{ added: number }>();

  const loadTokens = useCallback(() => void api<TokenProfile[]>("GET", "/tokens").then(setTokens).catch(() => {}), []);
  useEffect(loadTokens, [loadTokens]);
  useEffect(() => {
    if (!mint && tokens[0]) setMint(tokens[0].mint);
  }, [tokens, mint]);

  const refreshFast = useCallback(async () => {
    if (!mint) return;
    const [o, c, t] = await Promise.all([api<Overview>("GET", `/dashboard/${mint}`), api<Candle[]>("GET", `/dashboard/${mint}/candles?interval=${interval}`), api<Trade[]>("GET", `/dashboard/${mint}/trades?limit=150`)]);
    setOverview(o);
    setCandles(c);
    setTrades(t);
  }, [mint, interval]);
  const refreshSlow = useCallback(async () => {
    if (!mint) return;
    const [h, p] = await Promise.all([api<Holders>("GET", `/dashboard/${mint}/holders`), api<PnlReport>("GET", `/dashboard/${mint}/pnl`)]);
    setHolders(h);
    setPnl(p);
  }, [mint]);

  useEffect(() => {
    setOverview(null);
    setHolders(null);
    setPnl(null);
    setTrades([]);
    setCandles([]);
    if (mint) void load.run(async () => Promise.all([refreshFast(), refreshSlow()]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mint]);
  useEffect(() => {
    if (mint) void api<Candle[]>("GET", `/dashboard/${mint}/candles?interval=${interval}`).then(setCandles);
  }, [mint, interval]);

  // Live trades: prepend at once, refresh aggregates at most every few seconds.
  const pending = useRef<{ fast?: ReturnType<typeof setTimeout>; slow?: ReturnType<typeof setTimeout> }>({});
  useEffect(() => {
    if (!mint) return;
    return onServerEvent("trade", (data) => {
      const t = data as Trade;
      if (t.mint !== mint) return;
      setTrades((prev) => (prev.some((x) => x.id === t.id) ? prev : [t, ...prev].slice(0, 300)));
      pending.current.fast ??= setTimeout(() => {
        pending.current.fast = undefined;
        void refreshFast();
      }, 1_500);
      pending.current.slow ??= setTimeout(() => {
        pending.current.slow = undefined;
        void refreshSlow();
      }, 8_000);
    });
  }, [mint, refreshFast, refreshSlow]);
  useEffect(() => {
    const p = pending.current;
    return () => {
      clearTimeout(p.fast);
      clearTimeout(p.slow);
      p.fast = undefined;
      p.slow = undefined;
    };
  }, [mint]);

  const info = overview?.info;
  const profile = tokens.find((t) => t.mint === mint);
  const decimals = info?.decimals ?? profile?.decimals ?? 6;
  const supply = info?.supply ?? profile?.supply ?? "0";
  const shown = useMemo(() => (onlyOwn ? trades.filter((t) => t.own) : trades), [trades, onlyOwn]);
  const groupName = (g: number | null) => (g === null ? "—" : (groups.find((x) => x.id === g)?.name ?? `#${g}`));
  const pctOfSupply = (raw: string) => (Number(supply) > 0 ? (Number(raw) / Number(supply)) * 100 : 0);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Dashboard</h1>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void track.run(async () => {
              const p = await api<TokenProfile>("POST", "/tokens/track", { address: address.trim() });
              setAddress("");
              loadTokens();
              setMint(p.mint);
              return p;
            });
          }}
        >
          <input className="mono" style={{ width: 360 }} placeholder="Track a mint or PumpSwap pool address" value={address} onChange={(e) => setAddress(e.target.value)} />
          <button className="primary" disabled={address.trim().length < 32 || track.busy}>
            {track.busy ? "Tracking…" : "Track"}
          </button>
        </form>
      </div>
      <ErrorBox error={track.error} />

      <div className="token-tabs">
        {tokens.map((t) => (
          <button key={t.mint} className={`chip ${t.mint === mint ? "active" : ""}`} onClick={() => setMint(t.mint)} title={t.ingestError ?? t.mint}>
            {t.symbol ?? short(t.mint)} <span className="muted">{t.venue ?? ""}</span>
            {t.ingestError && <span className="warn-text"> !</span>}
          </button>
        ))}
        {!tokens.length && <span className="muted small">No tracked tokens yet. Launches are tracked automatically; paste any mint or PumpSwap pool above.</span>}
      </div>

      {mint && (
        <>
          <Card>
            <div className="token-card">
              <div>
                <div className="token-name">
                  {info?.name ?? profile?.name ?? "Token"} <span className="muted">{info?.symbol ?? profile?.symbol ?? ""}</span>
                </div>
                <Addr address={mint} />
              </div>
              <Stat label="Venue" value={info?.venue ?? "none"} sub={info?.venueNote} />
              {info?.market && (
                <>
                  <Stat label="Market cap" value={`${lamportsToSol(info.market.marketCapLamports, 2)} SOL`} />
                  <Stat label="Price" value={`${((info.market.priceLamportsPerToken * 10 ** decimals) / 1e9).toExponential(3)} SOL`} />
                  <Stat label="Liquidity" value={`${lamportsToSol(info.market.liquidityLamports, 2)} SOL`} />
                </>
              )}
              {info?.curve && !info.curve.complete && <Stat label="Curve" value={`${info.curve.progressPct.toFixed(1)}%`} />}
              {overview && <Stat label="24h volume" value={`${lamportsToSol(overview.stats24h.volumeLamports, 2)} SOL`} sub={`${overview.stats24h.buys} buys · ${overview.stats24h.sells} sells · yours ${lamportsToSol(overview.stats24h.ownVolumeLamports, 2)} SOL`} />}
              <div className="grow" />
              <div className="row">
                <button
                  disabled={sync.busy}
                  onClick={() =>
                    void sync.run(async () => {
                      const r = await api<{ added: number }>("POST", `/dashboard/${mint}/sync`);
                      await Promise.all([refreshFast(), refreshSlow()]);
                      loadTokens();
                      return r;
                    })
                  }
                >
                  {sync.busy ? "Syncing…" : "↻ Sync"}
                </button>
                <button className="primary" onClick={() => onTrade(mint)}>
                  Trade →
                </button>
              </div>
            </div>
            {sync.result && <p className="small muted">{sync.result.added} new trade(s) ingested.</p>}
            {profile?.ingestError && <div className="warn">Ingestion: {profile.ingestError}</div>}
            <ErrorBox error={load.error ?? sync.error} />
          </Card>

          <div className="cols">
            <div>
              <Card
                title="Market cap (SOL)"
                actions={INTERVALS.map((i) => (
                  <button key={i.sec} className={`chip ${interval === i.sec ? "active" : ""}`} onClick={() => setBucket(i.sec)}>
                    {i.label}
                  </button>
                ))}
              >
                <CandleChart candles={candles} supply={supply} />
                {!candles.length && <p className="small muted">No trades ingested yet. Trades appear here as they are indexed (polling + WebSocket); “Sync” pulls now.</p>}
              </Card>

              <Card title="PnL by wallet" actions={pnl && <span className="small muted">at {((pnl.priceLamportsPerToken * 10 ** decimals) / 1e9).toExponential(3)} SOL/token</span>}>
                {pnl ? (
                  <>
                    <div className="stats">
                      <Stat label="Holding" value={`${pnl.total.supplyPct.toFixed(2)}%`} sub={`${tokenAmount(pnl.total.holdingTokens, decimals)} tokens`} />
                      <Stat label="Value" value={`${lamportsToSol(pnl.total.valueLamports, 3)} SOL`} />
                      <Stat label="Realized" value={`${signedSol(pnl.total.realizedLamports, 3)} SOL`} />
                      <Stat label="Unrealized" value={`${signedSol(pnl.total.unrealizedLamports, 3)} SOL`} />
                    </div>
                    {pnl.groups.length > 1 && (
                      <table className="table compact">
                        <thead>
                          <tr>
                            <th>Group</th>
                            <th className="num">Cost basis</th>
                            <th className="num">Value</th>
                            <th className="num">Realized</th>
                            <th className="num">Unrealized</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pnl.groups.map((g) => (
                            <tr key={String(g.groupId)}>
                              <td>{g.name}</td>
                              <td className="num">{lamportsToSol(g.costBasisLamports)}</td>
                              <td className="num">{lamportsToSol(g.valueLamports)}</td>
                              <td className={`num ${Number(g.realizedLamports) >= 0 ? "ok-text" : "bad-text"}`}>{signedSol(g.realizedLamports)}</td>
                              <td className={`num ${Number(g.unrealizedLamports) >= 0 ? "ok-text" : "bad-text"}`}>{signedSol(g.unrealizedLamports)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    <div className="scroll">
                      <table className="table compact">
                        <thead>
                          <tr>
                            <th>Wallet</th>
                            <th>Group</th>
                            <th className="num">Holding</th>
                            <th className="num">Bought</th>
                            <th className="num">Sold</th>
                            <th className="num">Realized</th>
                            <th className="num">Unrealized</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pnl.wallets.map((w) => (
                            <tr key={w.walletId}>
                              <td>
                                {w.label}
                                {w.untrackedTokens !== "0" && (
                                  <span className="warn-text small" title="Tokens held beyond this wallet's ingested fills (transfers in, or fills not indexed yet); they are valued but carry no cost basis.">
                                    {" "}
                                    +{tokenAmount(w.untrackedTokens, decimals)} untracked
                                  </span>
                                )}
                              </td>
                              <td className="muted">{groupName(w.groupId)}</td>
                              <td className="num">{pctOfSupply(w.holdingTokens).toFixed(2)}%</td>
                              <td className="num">{lamportsToSol(w.boughtLamports)}</td>
                              <td className="num">{lamportsToSol(w.soldLamports)}</td>
                              <td className={`num ${Number(w.realizedLamports) >= 0 ? "ok-text" : "bad-text"}`}>{signedSol(w.realizedLamports)}</td>
                              <td className={`num ${Number(w.unrealizedLamports) >= 0 ? "ok-text" : "bad-text"}`}>{signedSol(w.unrealizedLamports)}</td>
                            </tr>
                          ))}
                          {!pnl.wallets.length && (
                            <tr>
                              <td colSpan={7} className="muted">
                                None of your wallets has traded or holds this token.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <p className="small muted">Average-cost basis from your wallets’ indexed fills (fees included in SOL amounts); unrealized PnL values tracked holdings at spot.</p>
                  </>
                ) : (
                  <p className="muted">Loading…</p>
                )}
              </Card>
            </div>

            <div>
              <Card
                title="Live trades"
                actions={
                  <label className="check">
                    <input type="checkbox" checked={onlyOwn} onChange={(e) => setOnlyOwn(e.target.checked)} /> only mine
                  </label>
                }
              >
                <div className="scroll tall">
                  <table className="table compact">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Side</th>
                        <th className="num">SOL</th>
                        <th className="num">Tokens</th>
                        <th className="num">Mcap</th>
                        <th>Trader</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((t) => (
                        <tr key={t.id} className={t.own ? "own-row" : ""}>
                          <td className="muted nowrap">{new Date(t.blockTime * 1000).toLocaleTimeString()}</td>
                          <td className={t.side === "buy" ? "ok-text" : "bad-text"}>{t.side}</td>
                          <td className="num">{lamportsToSol(t.solLamports)}</td>
                          <td className="num">{tokenAmount(t.tokens, decimals)}</td>
                          <td className="num">{mcapSol(t.price, supply).toFixed(1)}</td>
                          <td>{t.own ? <span className="own">{t.own.label}</span> : <Addr address={t.trader} />}</td>
                        </tr>
                      ))}
                      {!shown.length && (
                        <tr>
                          <td colSpan={6} className="muted">
                            No trades yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card title={`Holders${holders?.holderCount ? ` · ${holders.holderCount}` : ""}`}>
                {holders ? (
                  <>
                    <div className="stats">
                      <Stat label="Your wallets" value={`${holders.own.pct.toFixed(2)}%`} sub={`${holders.own.wallets} wallet(s)`} />
                      <Stat label="Top 10 (excl. curve/pool)" value={`${holders.holders.filter((h) => h.kind !== "bonding_curve" && h.kind !== "pool").slice(0, 10).reduce((n, h) => n + h.pct, 0).toFixed(2)}%`} />
                    </div>
                    {!holders.complete && <p className="small muted">This RPC doesn’t allow a full holder scan; showing the largest accounts only.</p>}
                    <div className="scroll">
                      <table className="table compact">
                        <tbody>
                          {holders.holders.slice(0, 50).map((h) => (
                            <tr key={h.owner} className={h.kind === "own" ? "own-row" : ""}>
                              <td>{h.own ? <span className="own">{h.own.label}</span> : <Addr address={h.owner} />}</td>
                              <td>
                                <span className={`pill ${h.kind === "own" ? "sim" : "muted"}`}>{h.kind.replace("_", " ")}</span>
                              </td>
                              <td className="num">{tokenAmount(h.amount, decimals)}</td>
                              <td className="num">{h.pct.toFixed(2)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <p className="muted">Loading…</p>
                )}
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
