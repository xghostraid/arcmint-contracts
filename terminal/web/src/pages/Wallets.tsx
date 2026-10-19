import { useMemo, useState } from "react";
import { api, lamportsToSol, type Wallet } from "../api";
import { Addr, Card, ErrorBox, Field, useAction } from "../components/ui";
import { useApp, useBalances } from "../state";

type Panel = null | "generate" | "import" | "export" | "airdrop";

export function Wallets() {
  const { wallets, groups, refresh, status } = useApp();
  const [filter, setFilter] = useState<string>("all");
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [panel, setPanel] = useState<Panel>(null);
  const { balances, reload } = useBalances(null);
  const a = useAction<unknown>();

  const visible = useMemo(
    () =>
      wallets.filter((w) => (showArchived ? true : w.status === "active")).filter((w) => (filter === "all" ? true : filter === "none" ? w.groupId === null : w.groupId === Number(filter))),
    [wallets, filter, showArchived],
  );
  const total = visible.reduce((n, w) => n + Number(balances.native[w.address] ?? 0), 0);
  const sel = new Set(selected);
  const toggle = (id: number) => setSelected(sel.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  const bulk = (patch: { groupId?: number | null; status?: "active" | "archived" }) =>
    a.run(async () => {
      await api("POST", "/wallets/update", { ids: selected, ...patch });
      await refresh();
    });

  return (
    <div className="page">
      <div className="page-head">
        <h1>Wallets</h1>
        <div className="row">
          <button onClick={() => setPanel(panel === "generate" ? null : "generate")}>+ Generate</button>
          <button onClick={() => setPanel(panel === "import" ? null : "import")}>Import</button>
          <NewGroup />
          {status.network !== "mainnet" && <button onClick={() => setPanel(panel === "airdrop" ? null : "airdrop")}>Airdrop (test SOL)</button>}
        </div>
      </div>

      {panel === "generate" && <GeneratePanel onDone={() => { setPanel(null); void refresh().then(reload); }} />}
      {panel === "import" && <ImportPanel onDone={() => { setPanel(null); void refresh().then(reload); }} />}
      {panel === "export" && <ExportPanel ids={selected} onClose={() => setPanel(null)} />}
      {panel === "airdrop" && <AirdropPanel ids={selected} onDone={() => { setPanel(null); void reload(); }} />}

      <Card
        title={
          <span>
            {visible.length} wallets · <span className="accent">{lamportsToSol(total)} SOL</span>
          </span>
        }
        actions={
          <>
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">All groups</option>
              <option value="none">Ungrouped</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.walletCount})
                </option>
              ))}
            </select>
            <label className="check">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> archived
            </label>
            <button onClick={() => void reload()}>↻</button>
          </>
        }
      >
        {selected.length > 0 && (
          <div className="row wrap toolbar">
            <span>{selected.length} selected</span>
            <select defaultValue="" onChange={(e) => e.target.value && void bulk({ groupId: e.target.value === "none" ? null : Number(e.target.value) })}>
              <option value="">Move to group…</option>
              <option value="none">(no group)</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <button onClick={() => void bulk({ status: "archived" })}>Archive</button>
            <button onClick={() => void bulk({ status: "active" })}>Unarchive</button>
            <button className="danger" onClick={() => setPanel("export")}>
              Export keys…
            </button>
            <button onClick={() => setSelected([])}>Clear</button>
          </div>
        )}
        <ErrorBox error={a.error} />
        <table className="table">
          <thead>
            <tr>
              <th>
                <input type="checkbox" checked={visible.length > 0 && visible.every((w) => sel.has(w.id))} onChange={(e) => setSelected(e.target.checked ? visible.map((w) => w.id) : [])} />
              </th>
              <th>Label</th>
              <th>Address</th>
              <th>Group</th>
              <th>Source</th>
              <th className="num">SOL</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((w) => (
              <WalletRow key={w.id} w={w} checked={sel.has(w.id)} onToggle={() => toggle(w.id)} sol={balances.native[w.address]} groupName={groups.find((g) => g.id === w.groupId)?.name} />
            ))}
          </tbody>
        </table>
        {!visible.length && <p className="muted">No wallets here yet.</p>}
      </Card>
    </div>
  );
}

function WalletRow({ w, checked, onToggle, sol, groupName }: { w: Wallet; checked: boolean; onToggle: () => void; sol?: string; groupName?: string }) {
  const { refresh } = useApp();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(w.label);
  const save = async () => {
    setEditing(false);
    if (label.trim() && label !== w.label) {
      await api("POST", "/wallets/update", { ids: [w.id], label });
      await refresh();
    }
  };
  return (
    <tr className={`${checked ? "selected" : ""} ${w.status === "archived" ? "archived" : ""}`}>
      <td>
        <input type="checkbox" checked={checked} onChange={onToggle} />
      </td>
      <td onDoubleClick={() => setEditing(true)} title="Double-click to rename">
        {editing ? <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} onBlur={() => void save()} onKeyDown={(e) => e.key === "Enter" && void save()} /> : w.label}
      </td>
      <td>
        <Addr address={w.address} />
      </td>
      <td className="muted">{groupName ?? "—"}</td>
      <td className="muted">{w.source === "hd" ? `HD #${w.hdIndex}` : "imported"}</td>
      <td className="num">{sol !== undefined ? lamportsToSol(sol) : "…"}</td>
    </tr>
  );
}

function NewGroup() {
  const { refresh } = useApp();
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  const a = useAction<unknown>();
  if (!open) return <button onClick={() => setOpen(true)}>+ Group</button>;
  return (
    <form
      className="row"
      onSubmit={(e) => {
        e.preventDefault();
        void a.run(async () => {
          await api("POST", "/groups", { name });
          setName("");
          setOpen(false);
          await refresh();
        });
      }}
    >
      <input autoFocus placeholder="Group name" value={name} onChange={(e) => setName(e.target.value)} />
      <button className="primary" disabled={!name.trim()}>
        Add
      </button>
      {a.error && <span className="err-cell">{a.error}</span>}
    </form>
  );
}

function GroupSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { groups } = useApp();
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">(no group)</option>
      {groups.map((g) => (
        <option key={g.id} value={g.id}>
          {g.name}
        </option>
      ))}
    </select>
  );
}

function GeneratePanel({ onDone }: { onDone: () => void }) {
  const [count, setCount] = useState("5");
  const [group, setGroup] = useState("");
  const [prefix, setPrefix] = useState("Wallet");
  const a = useAction<unknown>();
  return (
    <Card title="Generate HD wallets">
      <p className="muted small">Derived from the vault’s recovery phrase (m/44'/501'/i'/0', same as Phantom), so the phrase backs them all up.</p>
      <div className="grid4">
        <Field label="Count" hint="1–500">
          <input value={count} onChange={(e) => setCount(e.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Group">
          <GroupSelect value={group} onChange={setGroup} />
        </Field>
        <Field label="Label prefix">
          <input value={prefix} onChange={(e) => setPrefix(e.target.value)} />
        </Field>
      </div>
      <button className="primary" disabled={a.busy} onClick={() => void a.run(async () => { await api("POST", "/wallets/generate", { count: Number(count), groupId: group ? Number(group) : null, labelPrefix: prefix }); onDone(); })}>
        Generate
      </button>
      <ErrorBox error={a.error} />
    </Card>
  );
}

function ImportPanel({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState("");
  const [group, setGroup] = useState("");
  const [accounts, setAccounts] = useState("1");
  const a = useAction<{ created: Wallet[]; skipped: string[] }>();
  return (
    <Card title="Import wallets">
      <Field label="Private keys or recovery phrase" hint="one base58 key or JSON byte array per line, or a 12/24-word phrase">
        <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} className="mono" spellCheck={false} />
      </Field>
      <div className="grid4">
        <Field label="Group">
          <GroupSelect value={group} onChange={setGroup} />
        </Field>
        <Field label="Accounts from phrase" hint="if a phrase">
          <input value={accounts} onChange={(e) => setAccounts(e.target.value)} inputMode="numeric" />
        </Field>
      </div>
      <button
        className="primary"
        disabled={a.busy || !text.trim()}
        onClick={() =>
          void a.run(async () => {
            const r = await api<{ created: Wallet[]; skipped: string[] }>("POST", "/wallets/import", { text, groupId: group ? Number(group) : null, mnemonicAccounts: Number(accounts) });
            setText("");
            if (!r.skipped.length) onDone();
            return r;
          })
        }
      >
        Import
      </button>
      {a.result && (
        <p className="small">
          Imported {a.result.created.length}; {a.result.skipped.length} already in the vault.
        </p>
      )}
      <ErrorBox error={a.error} />
    </Card>
  );
}

function ExportPanel({ ids, onClose }: { ids: number[]; onClose: () => void }) {
  const [pass, setPass] = useState("");
  const a = useAction<{ address: string; label: string; secretKey: string }[]>();
  const download = () => {
    const blob = new Blob([JSON.stringify(a.result, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `wallets-export-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Card title={`Export ${ids.length} private key(s)`} actions={<button onClick={onClose}>Close</button>}>
      <p className="warn-text small">Anyone with these keys controls the funds. The export is recorded in the activity log.</p>
      {!a.result ? (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void a.run(() => api("POST", "/wallets/export", { ids, passphrase: pass }));
          }}
        >
          <input type="password" placeholder="Vault passphrase" value={pass} onChange={(e) => setPass(e.target.value)} autoFocus />
          <button className="danger" disabled={!pass || a.busy}>
            Reveal keys
          </button>
        </form>
      ) : (
        <>
          <textarea readOnly rows={Math.min(10, a.result.length + 1)} className="mono" value={a.result.map((r) => `${r.secretKey}`).join("\n")} />
          <div className="row">
            <button onClick={() => void navigator.clipboard?.writeText(a.result!.map((r) => r.secretKey).join("\n"))}>Copy</button>
            <button onClick={download}>Download JSON</button>
          </div>
        </>
      )}
      <ErrorBox error={a.error} />
    </Card>
  );
}

function AirdropPanel({ ids, onDone }: { ids: number[]; onDone: () => void }) {
  const [amount, setAmount] = useState("2");
  const a = useAction<unknown>();
  return (
    <Card title="Airdrop test SOL">
      <p className="muted small">Local validator or devnet faucet only. {ids.length ? `${ids.length} selected wallet(s).` : "Select wallets in the table first."}</p>
      <div className="row">
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /> SOL each
        <button className="primary" disabled={!ids.length || a.busy} onClick={() => void a.run(async () => { await api("POST", "/dev/airdrop", { walletIds: ids, sol: Number(amount) }); onDone(); })}>
          {a.busy ? "Airdropping…" : "Airdrop"}
        </button>
      </div>
      <ErrorBox error={a.error} />
    </Card>
  );
}
