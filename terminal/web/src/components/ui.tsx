import { useMemo, useState, type ReactNode } from "react";
import { lamportsToSol, short, tokenAmount, type ActionResult, type Group, type Wallet } from "../api";
import type { Balances } from "../state";

export function Card({ title, actions, children }: { title?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      {(title || actions) && (
        <header className="card-head">
          <h3>{title}</h3>
          <div className="row">{actions}</div>
        </header>
      )}
      {children}
    </section>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {hint && <em>{hint}</em>}
      </span>
      {children}
    </label>
  );
}

export function Addr({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="addr"
      title={address}
      onClick={() => {
        void navigator.clipboard?.writeText(address);
        setCopied(true);
        setTimeout(() => setCopied(false), 900);
      }}
    >
      {copied ? "copied" : short(address)}
    </button>
  );
}

export function ErrorBox({ error }: { error: string | null }) {
  return error ? <div className="error">{error}</div> : null;
}

export function useAction<T>() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<T | null>(null);
  const run = async (fn: () => Promise<T>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      setResult(r);
      return r;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, result, run, setResult, setError };
}

const STATUS_CLASS: Record<string, string> = { confirmed: "ok", simulated: "sim", failed: "bad", skipped: "muted" };

export function ResultView({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return (
    <div className="result">
      <div className="row small">
        <span className="pill">{result.dryRun ? "simulation" : result.mode}</span>
        {result.bundleId && <span className="muted">bundle {short(result.bundleId)}</span>}
        {result.note && <span className="warn-text">{result.note}</span>}
      </div>
      <table className="table compact">
        <tbody>
          {result.txs.map((t) => (
            <tr key={t.signature}>
              <td>
                <span className={`pill ${STATUS_CLASS[t.status]}`}>{t.status}</span>
              </td>
              <td>{t.label}</td>
              <td className="mono">{result.explorer[t.signature] ? <a href={result.explorer[t.signature]} target="_blank" rel="noreferrer">{short(t.signature)}</a> : short(t.signature)}</td>
              <td className="err-cell">{t.error}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Select wallets individually or a whole group at once; shows SOL and optional token balances. */
export function WalletPicker({
  wallets,
  groups,
  selected,
  onChange,
  balances,
  decimals,
  tokenLabel,
  exclude = [],
}: {
  wallets: Wallet[];
  groups: Group[];
  selected: number[];
  onChange: (ids: number[]) => void;
  balances?: Balances;
  decimals?: number;
  tokenLabel?: string;
  exclude?: number[];
}) {
  const active = useMemo(() => wallets.filter((w) => w.status === "active" && !exclude.includes(w.id)), [wallets, exclude]);
  const sel = new Set(selected);
  const toggle = (id: number) => onChange(sel.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const pickGroup = (gid: number | null) => onChange([...new Set([...selected, ...active.filter((w) => w.groupId === gid).map((w) => w.id)])]);
  const groupName = (gid: number | null) => groups.find((g) => g.id === gid)?.name ?? "—";
  return (
    <div className="picker">
      <div className="row wrap small">
        <span className="muted">Select:</span>
        <button type="button" className="chip" onClick={() => onChange(active.map((w) => w.id))}>
          all ({active.length})
        </button>
        {groups.map((g) => (
          <button type="button" key={g.id} className="chip" onClick={() => pickGroup(g.id)}>
            {g.name}
          </button>
        ))}
        <button type="button" className="chip" onClick={() => onChange([])}>
          none
        </button>
        <span className="muted">{selected.length} selected</span>
      </div>
      <div className="picker-list">
        <table className="table compact">
          <thead>
            <tr>
              <th />
              <th>Wallet</th>
              <th>Group</th>
              <th className="num">SOL</th>
              {balances?.token && <th className="num">{tokenLabel ?? "Token"}</th>}
            </tr>
          </thead>
          <tbody>
            {active.map((w) => (
              <tr key={w.id} className={sel.has(w.id) ? "selected" : ""} onClick={() => toggle(w.id)}>
                <td>
                  <input type="checkbox" checked={sel.has(w.id)} readOnly />
                </td>
                <td>
                  {w.label} <Addr address={w.address} />
                </td>
                <td className="muted">{groupName(w.groupId)}</td>
                <td className="num">{balances?.native[w.address] !== undefined ? lamportsToSol(balances.native[w.address]!) : "…"}</td>
                {balances?.token && <td className="num">{balances.token[w.address] !== undefined ? tokenAmount(balances.token[w.address]!, decimals ?? 6) : "…"}</td>}
              </tr>
            ))}
            {!active.length && (
              <tr>
                <td colSpan={5} className="muted">
                  No wallets yet. Generate or import some on the Wallets page.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export interface ExecSettings {
  slippagePct: string;
  priorityMicroLamports: string;
  mode: "parallel" | "sequential" | "bundle";
  jitoTipSol: string;
  dryRun: boolean;
}

export function execBody(s: ExecSettings) {
  return {
    slippageBps: Math.round(Number(s.slippagePct) * 100),
    priorityMicroLamports: Number(s.priorityMicroLamports),
    mode: s.mode,
    jitoTipSol: s.jitoTipSol,
    dryRun: s.dryRun,
  };
}

export function ExecControls({ value, onChange, bundles, modes = ["parallel", "sequential", "bundle"] }: { value: ExecSettings; onChange: (v: ExecSettings) => void; bundles: boolean; modes?: ExecSettings["mode"][] }) {
  const set = <K extends keyof ExecSettings>(k: K, v: ExecSettings[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="grid4">
      <Field label="Slippage %">
        <input value={value.slippagePct} onChange={(e) => set("slippagePct", e.target.value)} inputMode="decimal" />
      </Field>
      <Field label="Priority fee" hint="µlamports/CU">
        <input value={value.priorityMicroLamports} onChange={(e) => set("priorityMicroLamports", e.target.value)} inputMode="numeric" />
      </Field>
      <Field label="Execution" hint={value.mode === "bundle" && !bundles ? "no Jito here → sequential" : undefined}>
        <select value={value.mode} onChange={(e) => set("mode", e.target.value as ExecSettings["mode"])}>
          {modes.map((m) => (
            <option key={m} value={m}>
              {m === "bundle" ? "Jito bundle (atomic)" : m}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Jito tip" hint="SOL">
        <input value={value.jitoTipSol} onChange={(e) => set("jitoTipSol", e.target.value)} disabled={value.mode !== "bundle" || !bundles} inputMode="decimal" />
      </Field>
      <label className="check">
        <input type="checkbox" checked={value.dryRun} onChange={(e) => set("dryRun", e.target.checked)} /> Simulate only (don’t send)
      </label>
    </div>
  );
}
