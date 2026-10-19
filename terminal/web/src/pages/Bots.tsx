import { Fragment, useCallback, useEffect, useState } from "react";
import { api, lamportsToSol, onServerEvent, short, type Strategy, type StrategyIntent, type StrategyKind, type TokenProfile } from "../api";
import { Addr, Card, ErrorBox, Field, WalletPicker, useAction } from "../components/ui";
import { useApp } from "../state";

interface StrategyList {
  killSwitch: boolean;
  maxActionsPerMinute: number;
  strategies: Strategy[];
}
interface LaunchRow {
  mint: string;
  symbol: string;
  status: string;
}

const KINDS: { kind: StrategyKind; label: string; blurb: string }[] = [
  { kind: "dca", label: "DCA", blurb: "Buy a fixed SOL amount, or sell a share of each wallet's balance, every interval for a set number of runs." },
  { kind: "limit", label: "Limit order", blurb: "Buy or sell once when market cap or price crosses a level. Checked every few seconds; fills at the market price then, not exactly at the level." },
  { kind: "counter", label: "Counter-trade", blurb: "Answer outside traders: sell into their buys and/or buy their dips, sized as a share of their trade. Your own wallets' trades are never answered." },
  { kind: "snipe", label: "Snipe (own launch)", blurb: "Round-robin buys from your wallets right after your own launch until a supply share or market cap target is reached. Only works on tokens you launched here." },
];

const STATUS_PILL: Record<string, string> = { running: "ok", paused: "", stopped: "", completed: "sim", failed: "bad" };

type Form = Record<string, string>;
const DEFAULTS: Form = {
  side: "buy",
  solPerWallet: "0.01",
  percent: "25",
  intervalSec: "60",
  runs: "10",
  metric: "marketCapSol",
  op: "gte",
  value: "100",
  checkSec: "5",
  expiresHours: "",
  reactTo: "buys",
  minTradeSol: "0.5",
  sharePct: "25",
  maxPerReactionSol: "0.2",
  cooldownSec: "15",
  minTokensPerWallet: "0",
  targetSupplyPct: "10",
  maxMarketCapSol: "60",
  solPerBuy: "0.01",
  slippagePct: "5",
  mode: "parallel",
};

function buildConfig(kind: StrategyKind, f: Form, walletIds: number[]) {
  const n = (k: string) => Number(f[k]);
  const exec = { walletIds, slippageBps: Math.round(n("slippagePct") * 100), mode: f.mode };
  switch (kind) {
    case "dca":
      return { ...exec, side: f.side, intervalSec: n("intervalSec"), runs: n("runs"), ...(f.side === "buy" ? { solPerWallet: n("solPerWallet") } : { percentPerRun: n("percent") }) };
    case "limit":
      return {
        ...exec,
        side: f.side,
        trigger: { metric: f.metric, op: f.op, value: n("value") },
        checkSec: n("checkSec"),
        ...(f.expiresHours ? { expiresAt: Date.now() + n("expiresHours") * 3_600_000 } : {}),
        ...(f.side === "buy" ? { solPerWallet: n("solPerWallet") } : { percent: n("percent") }),
      };
    case "counter":
      return { ...exec, reactTo: f.reactTo, minTradeSol: n("minTradeSol"), sharePct: n("sharePct"), maxPerReactionSol: n("maxPerReactionSol"), cooldownSec: n("cooldownSec"), minTokensPerWallet: n("minTokensPerWallet") };
    case "snipe":
      return { ...exec, targetSupplyPct: n("targetSupplyPct"), maxMarketCapSol: n("maxMarketCapSol"), solPerBuy: n("solPerBuy"), intervalSec: n("intervalSec") };
  }
}

function spends(kind: StrategyKind, f: Form) {
  if (kind === "dca" || kind === "limit") return f.side === "buy";
  if (kind === "counter") return f.reactTo !== "buys";
  return true;
}

function describe(s: Strategy): string {
  const c = s.config as Record<string, unknown>;
  const t = c.trigger as { metric: string; op: string; value: number } | undefined;
  switch (s.kind) {
    case "dca":
      return `${c.side} ${c.side === "buy" ? `${c.solPerWallet} SOL/wallet` : `${c.percentPerRun}%/run`} every ${c.intervalSec}s × ${c.runs}`;
    case "limit":
      return `${c.side} ${c.side === "buy" ? `${c.solPerWallet} SOL/wallet` : `${c.percent}%`} when ${t?.metric === "priceSol" ? "price" : "mcap"} ${t?.op === "gte" ? "≥" : "≤"} ${t?.value} SOL`;
    case "counter":
      return `answer ${c.reactTo} ≥ ${c.minTradeSol} SOL with ${c.sharePct}% (max ${c.maxPerReactionSol} SOL)`;
    case "snipe":
      return `${c.solPerBuy} SOL buys until ${c.targetSupplyPct}% supply or ${c.maxMarketCapSol} SOL mcap`;
  }
}

export function Bots() {
  const { wallets, groups, status, refreshStatus } = useApp();
  const [list, setList] = useState<StrategyList | null>(null);
  const [tokens, setTokens] = useState<TokenProfile[]>([]);
  const [launches, setLaunches] = useState<LaunchRow[]>([]);
  const [kind, setKind] = useState<StrategyKind>("dca");
  const [name, setName] = useState("");
  const [mint, setMint] = useState("");
  const [budget, setBudget] = useState("0.1");
  const [start, setStart] = useState(true);
  const [walletIds, setWalletIds] = useState<number[]>([]);
  const [form, setForm] = useState<Form>(DEFAULTS);
  const [open, setOpen] = useState<number | null>(null);
  const [intents, setIntents] = useState<StrategyIntent[]>([]);
  const create = useAction<Strategy>();
  const act = useAction<unknown>();

  const load = useCallback(async () => {
    setList(await api<StrategyList>("GET", "/strategies"));
  }, []);
  const loadIntents = useCallback(async (id: number) => setIntents((await api<{ intents: StrategyIntent[] }>("GET", `/strategies/${id}`)).intents), []);

  useEffect(() => {
    void load();
    void api<TokenProfile[]>("GET", "/tokens").then(setTokens).catch(() => {});
    void api<LaunchRow[]>("GET", "/launches").then(setLaunches).catch(() => {});
  }, [load]);
  useEffect(
    () =>
      onServerEvent("bot", () => {
        void load();
        void refreshStatus();
        if (open !== null) void loadIntents(open);
      }),
    [load, loadIntents, open, refreshStatus],
  );

  const set = (k: string, v: string) => setForm({ ...form, [k]: v });
  const ownMints = launches.filter((l) => l.status !== "failed");
  const mintOptions = kind === "snipe" ? ownMints.map((l) => ({ mint: l.mint, label: l.symbol })) : tokens.map((t) => ({ mint: t.mint, label: t.symbol ?? short(t.mint) }));
  const needsBudget = spends(kind, form);
  const blurb = KINDS.find((k) => k.kind === kind)!.blurb;

  const toggleKill = (on: boolean) =>
    act.run(async () => {
      if (on && !confirm("Pause every running bot now and block new bot actions until the kill switch is turned off?")) return;
      await api("POST", "/strategies/kill-switch", { on });
      await Promise.all([load(), refreshStatus()]);
    });
  const lifecycle = (s: Strategy, verb: "start" | "pause" | "stop" | "delete") =>
    act.run(async () => {
      if (verb === "delete") {
        if (!confirm(`Delete bot "${s.name}" and its history?`)) return;
        await api("DELETE", `/strategies/${s.id}`);
        if (open === s.id) setOpen(null);
      } else await api("POST", `/strategies/${s.id}/${verb}`);
      await Promise.all([load(), refreshStatus()]);
    });

  return (
    <div className="page">
      <div className="page-head">
        <h1>Bots</h1>
        <div className="row">
          {list && <span className="small muted">All bots share a cap of {list.maxActionsPerMinute} actions/minute.</span>}
          {list?.killSwitch ? (
            <button className="primary" disabled={act.busy} onClick={() => void toggleKill(false)}>
              Kill switch ON · release
            </button>
          ) : (
            <button className="danger" disabled={act.busy} onClick={() => void toggleKill(true)}>
              ⏻ Kill switch
            </button>
          )}
        </div>
      </div>
      {!status.vault.keepUnlocked && <div className="warn">Bots stop when the vault auto-locks. Turn on “Keep unlocked while idle” in Settings to run them unattended.</div>}
      <ErrorBox error={act.error} />

      <div className="cols">
        <Card title="New bot">
          <div className="token-tabs">
            {KINDS.map((k) => (
              <button
                key={k.kind}
                className={`chip ${kind === k.kind ? "active" : ""}`}
                onClick={() => {
                  setKind(k.kind);
                  setMint("");
                }}
              >
                {k.label}
              </button>
            ))}
          </div>
          <p className="small muted">{blurb}</p>
          <div className="grid2">
            <Field label="Token" hint={kind === "snipe" ? "your launches" : "tracked tokens"}>
              <select value={mint} onChange={(e) => setMint(e.target.value)}>
                <option value="">Choose…</option>
                {mintOptions.map((o) => (
                  <option key={o.mint} value={o.mint}>
                    {o.label} · {short(o.mint)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Name" hint="optional">
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
            </Field>
          </div>
          {kind === "snipe" && !ownMints.length && <p className="small muted">Launch a token first; sniping is limited to your own launches.</p>}
          {kind !== "snipe" && !tokens.length && <p className="small muted">Track a token on the Dashboard first.</p>}

          <div className="grid4">
            {(kind === "dca" || kind === "limit") && (
              <Field label="Side">
                <select value={form.side} onChange={(e) => set("side", e.target.value)}>
                  <option value="buy">buy</option>
                  <option value="sell">sell</option>
                </select>
              </Field>
            )}
            {(kind === "dca" || kind === "limit") &&
              (form.side === "buy" ? (
                <Field label="SOL per wallet">
                  <input value={form.solPerWallet} onChange={(e) => set("solPerWallet", e.target.value)} inputMode="decimal" />
                </Field>
              ) : (
                <Field label={kind === "dca" ? "% of balance per run" : "% of balance"}>
                  <input value={form.percent} onChange={(e) => set("percent", e.target.value)} inputMode="decimal" />
                </Field>
              ))}
            {(kind === "dca" || kind === "snipe") && (
              <Field label="Interval" hint="seconds">
                <input value={form.intervalSec} onChange={(e) => set("intervalSec", e.target.value)} inputMode="numeric" />
              </Field>
            )}
            {kind === "dca" && (
              <Field label="Runs">
                <input value={form.runs} onChange={(e) => set("runs", e.target.value)} inputMode="numeric" />
              </Field>
            )}
            {kind === "limit" && (
              <>
                <Field label="When">
                  <select value={form.metric} onChange={(e) => set("metric", e.target.value)}>
                    <option value="marketCapSol">market cap (SOL)</option>
                    <option value="priceSol">price (SOL/token)</option>
                  </select>
                </Field>
                <Field label="Is">
                  <select value={form.op} onChange={(e) => set("op", e.target.value)}>
                    <option value="gte">≥ at or above</option>
                    <option value="lte">≤ at or below</option>
                  </select>
                </Field>
                <Field label="Level" hint="SOL">
                  <input value={form.value} onChange={(e) => set("value", e.target.value)} inputMode="decimal" />
                </Field>
                <Field label="Check every" hint="seconds">
                  <input value={form.checkSec} onChange={(e) => set("checkSec", e.target.value)} inputMode="numeric" />
                </Field>
                <Field label="Expires after" hint="hours, blank = never">
                  <input value={form.expiresHours} onChange={(e) => set("expiresHours", e.target.value)} inputMode="decimal" />
                </Field>
              </>
            )}
            {kind === "counter" && (
              <>
                <Field label="Answer">
                  <select value={form.reactTo} onChange={(e) => set("reactTo", e.target.value)}>
                    <option value="buys">outside buys (sell into them)</option>
                    <option value="sells">outside sells (buy the dip)</option>
                    <option value="both">both</option>
                  </select>
                </Field>
                <Field label="Min outside trade" hint="SOL">
                  <input value={form.minTradeSol} onChange={(e) => set("minTradeSol", e.target.value)} inputMode="decimal" />
                </Field>
                <Field label="Trade back" hint="% of their SOL">
                  <input value={form.sharePct} onChange={(e) => set("sharePct", e.target.value)} inputMode="decimal" />
                </Field>
                <Field label="Max per reaction" hint="SOL">
                  <input value={form.maxPerReactionSol} onChange={(e) => set("maxPerReactionSol", e.target.value)} inputMode="decimal" />
                </Field>
                <Field label="Cooldown" hint="seconds">
                  <input value={form.cooldownSec} onChange={(e) => set("cooldownSec", e.target.value)} inputMode="numeric" />
                </Field>
                <Field label="Keep per wallet" hint="whole tokens">
                  <input value={form.minTokensPerWallet} onChange={(e) => set("minTokensPerWallet", e.target.value)} inputMode="decimal" />
                </Field>
              </>
            )}
            {kind === "snipe" && (
              <>
                <Field label="SOL per buy">
                  <input value={form.solPerBuy} onChange={(e) => set("solPerBuy", e.target.value)} inputMode="decimal" />
                </Field>
                <Field label="Stop at supply" hint="% held">
                  <input value={form.targetSupplyPct} onChange={(e) => set("targetSupplyPct", e.target.value)} inputMode="decimal" />
                </Field>
                <Field label="Stop at mcap" hint="SOL">
                  <input value={form.maxMarketCapSol} onChange={(e) => set("maxMarketCapSol", e.target.value)} inputMode="decimal" />
                </Field>
              </>
            )}
            <Field label="Slippage %">
              <input value={form.slippagePct} onChange={(e) => set("slippagePct", e.target.value)} inputMode="decimal" />
            </Field>
            <Field label="Execution">
              <select value={form.mode} onChange={(e) => set("mode", e.target.value)}>
                <option value="parallel">parallel</option>
                <option value="sequential">sequential</option>
                <option value="bundle">Jito bundle</option>
              </select>
            </Field>
            <Field label="Budget" hint={needsBudget ? "max SOL spent, total" : "sells only, optional"}>
              <input value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="decimal" />
            </Field>
          </div>

          <h4>Wallets</h4>
          <WalletPicker wallets={wallets} groups={groups} selected={walletIds} onChange={setWalletIds} />
          <div className="row">
            <label className="check">
              <input type="checkbox" checked={start} onChange={(e) => setStart(e.target.checked)} /> Start immediately
            </label>
            <div className="grow" />
            <button
              className="primary"
              disabled={!mint || !walletIds.length || create.busy}
              onClick={() =>
                void create.run(async () => {
                  const s = await api<Strategy>("POST", "/strategies", { kind, name, mint, budgetSol: Number(budget || 0), start, config: buildConfig(kind, form, walletIds) });
                  await Promise.all([load(), refreshStatus()]);
                  return s;
                })
              }
            >
              Create bot
            </button>
          </div>
          <p className="small muted">Every bot is capped by its budget, the per-action cap ({status.maxSolPerAction} SOL), and the shared rate limit. Each action is recorded before it is sent, so a restart never repeats a trade.</p>
          <ErrorBox error={create.error} />
        </Card>

        <Card title={`Bots${list ? ` · ${list.strategies.filter((s) => s.status === "running").length} running` : ""}`} actions={<button onClick={() => void load()}>↻</button>}>
          <table className="table compact">
            <thead>
              <tr>
                <th>Bot</th>
                <th>Status</th>
                <th className="num">Spent / budget</th>
                <th className="num">Received</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list?.strategies.map((s) => (
                <Fragment key={s.id}>
                  <tr className={open === s.id ? "selected" : ""}>
                    <td>
                      <button
                        className="link"
                        onClick={() => {
                          const next = open === s.id ? null : s.id;
                          setOpen(next);
                          setIntents([]);
                          if (next !== null) void loadIntents(next);
                        }}
                      >
                        {s.name}
                      </button>{" "}
                      <span className="pill">{s.kind}</span>
                      <div className="small muted">{describe(s)}</div>
                      {s.note && <div className={`small ${s.status === "failed" ? "bad-text" : "muted"}`}>{s.note}</div>}
                    </td>
                    <td>
                      <span className={`pill ${STATUS_PILL[s.status] ?? ""}`}>{s.status}</span>
                      <div className="small muted">
                        {s.runs} run(s)
                        {s.status === "running" && s.nextRunAt ? ` · next ${new Date(s.nextRunAt).toLocaleTimeString()}` : ""}
                      </div>
                    </td>
                    <td className="num nowrap">
                      {lamportsToSol(s.spentLamports)} / {lamportsToSol(s.budgetLamports)}
                    </td>
                    <td className="num">{lamportsToSol(s.receivedLamports)}</td>
                    <td>
                      <div className="row">
                        {(s.status === "paused" || s.status === "failed") && (
                          <button className="chip" disabled={act.busy || list.killSwitch} onClick={() => void lifecycle(s, "start")}>
                            start
                          </button>
                        )}
                        {s.status === "running" && (
                          <button className="chip" disabled={act.busy} onClick={() => void lifecycle(s, "pause")}>
                            pause
                          </button>
                        )}
                        {(s.status === "running" || s.status === "paused") && (
                          <button className="chip" disabled={act.busy} onClick={() => void lifecycle(s, "stop")}>
                            stop
                          </button>
                        )}
                        {s.status !== "running" && (
                          <button className="chip danger" disabled={act.busy} onClick={() => void lifecycle(s, "delete")}>
                            delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {open === s.id && (
                    <tr>
                      <td colSpan={5}>
                        <div className="small muted">
                          Token <Addr address={s.mint} /> · wallets {s.config.walletIds.length}
                        </div>
                        <div className="scroll">
                          <table className="table compact">
                            <tbody>
                              {intents.map((i) => (
                                <tr key={i.id}>
                                  <td className="muted nowrap">{new Date(i.createdAt).toLocaleTimeString()}</td>
                                  <td className={i.side === "buy" ? "ok-text" : "bad-text"}>{i.side}</td>
                                  <td>
                                    <span className={`pill ${i.status === "ok" ? "ok" : i.status === "failed" ? "bad" : ""}`}>{i.status}</span>
                                  </td>
                                  <td className="small">
                                    {i.result?.error && <span className="bad-text">{i.result.error}</span>}
                                    {i.result?.signatures?.map((sig) => (
                                      <span key={sig.signature} className={sig.status === "confirmed" ? "" : "bad-text"} title={sig.error}>
                                        {sig.label} {short(sig.signature)}{" "}
                                      </span>
                                    ))}
                                  </td>
                                </tr>
                              ))}
                              {!intents.length && (
                                <tr>
                                  <td className="muted">No actions yet.</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {list && !list.strategies.length && (
                <tr>
                  <td colSpan={5} className="muted">
                    No bots yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
