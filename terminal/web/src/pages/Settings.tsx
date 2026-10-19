import { useEffect, useState } from "react";
import { api, type AlertCategory, type AlertStatus } from "../api";
import { Card, ErrorBox, Field, useAction } from "../components/ui";
import { useApp } from "../state";

interface ChainRow {
  id: string;
  family: string;
  name: string;
  nativeSymbol: string;
  status: "active" | "planned";
  bundles: string;
}

export function Settings() {
  const { status, refreshStatus } = useApp();
  const [chains, setChains] = useState<ChainRow[]>([]);
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [revealPass, setRevealPass] = useState("");
  const change = useAction<string>();
  const reveal = useAction<string>();
  const keep = useAction<unknown>();

  useEffect(() => {
    void api<ChainRow[]>("GET", "/chains").then(setChains);
  }, []);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Settings</h1>
      </div>
      <div className="cols">
        <div>
          <Card title="Node">
            <table className="table compact">
              <tbody>
                <tr>
                  <td>Network</td>
                  <td>
                    <span className={`net net-${status.network}`}>{status.network}</span> {status.chainName}
                  </td>
                </tr>
                <tr>
                  <td>RPC</td>
                  <td className="mono">{status.rpcUrl}</td>
                </tr>
                <tr>
                  <td>Jito bundles</td>
                  <td>{status.bundles ? "available" : "not on this network"}</td>
                </tr>
                <tr>
                  <td>Spend cap</td>
                  <td>{status.maxSolPerAction} SOL per action</td>
                </tr>
                <tr>
                  <td>Bots</td>
                  <td>
                    {status.botsRunning} running{status.killSwitch && <span className="bad-text"> · kill switch on</span>}
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="small muted">Configured with environment variables (see README); restart to change.</p>
          </Card>
          <Card title="Chains">
            <table className="table compact">
              <tbody>
                {chains.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td className="muted">{c.family}</td>
                    <td>
                      <span className={`pill ${c.status === "active" ? "ok" : "muted"}`}>{c.status === "active" ? "supported" : "planned"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
        <div>
          <Card title="Vault">
            <label className="check">
              <input
                type="checkbox"
                checked={status.vault.keepUnlocked}
                onChange={(e) =>
                  void keep.run(async () => {
                    await api("POST", "/vault/keep-unlocked", { enabled: e.target.checked });
                    await refreshStatus();
                  })
                }
              />
              Keep unlocked while idle (needed for 24/7 bots; disables auto-lock)
            </label>
            <h4>Change passphrase</h4>
            <div className="grid2">
              <Field label="Current">
                <input type="password" value={cur} onChange={(e) => setCur(e.target.value)} />
              </Field>
              <Field label="New" hint="10+ characters">
                <input type="password" value={next} onChange={(e) => setNext(e.target.value)} />
              </Field>
            </div>
            <button
              disabled={!cur || next.length < 10 || change.busy}
              onClick={() =>
                void change.run(async () => {
                  await api("POST", "/vault/passphrase", { current: cur, next });
                  setCur("");
                  setNext("");
                  return "Passphrase changed.";
                })
              }
            >
              Change
            </button>
            {change.result && <p className="small ok-text">{change.result}</p>}
            <ErrorBox error={change.error} />
            <h4>Recovery phrase</h4>
            <div className="row">
              <input type="password" placeholder="Passphrase" value={revealPass} onChange={(e) => setRevealPass(e.target.value)} />
              <button className="danger" disabled={!revealPass} onClick={() => void reveal.run(async () => (await api<{ mnemonic: string }>("POST", "/vault/mnemonic", { passphrase: revealPass })).mnemonic)}>
                Reveal
              </button>
            </div>
            {reveal.result && <div className="phrase small">{reveal.result}</div>}
            <ErrorBox error={reveal.error} />
          </Card>
          <AlertsCard />
        </div>
      </div>
    </div>
  );
}

const ALERT_LABELS: Record<AlertCategory, string> = {
  fills: "Bot fills",
  failures: "Failed transactions",
  lowBalance: "Low wallet balance",
  botStatus: "Bot started / paused / finished",
  launches: "Launches",
};

function AlertsCard() {
  const [alerts, setAlerts] = useState<AlertStatus | null>(null);
  const save = useAction<unknown>();
  const test = useAction<string>();
  const load = () => void api<AlertStatus>("GET", "/alerts").then(setAlerts);
  useEffect(load, []);
  if (!alerts) return null;
  return (
    <Card title="Telegram alerts" actions={<span className={`pill ${alerts.enabled ? "ok" : ""}`}>{alerts.enabled ? `chat ${alerts.chatId}` : "off"}</span>}>
      {!alerts.enabled && (
        <p className="small muted">
          Set <span className="mono">TELEGRAM_BOT_TOKEN</span> and <span className="mono">TELEGRAM_CHAT_ID</span> and restart to enable. Alerts are outbound only; the bot never accepts commands.
        </p>
      )}
      {(Object.keys(ALERT_LABELS) as AlertCategory[]).map((k) => (
        <label key={k} className="check">
          <input
            type="checkbox"
            checked={alerts.prefs[k]}
            onChange={(e) =>
              void save.run(async () => {
                const prefs = await api<AlertStatus["prefs"]>("PATCH", "/alerts", { [k]: e.target.checked });
                setAlerts({ ...alerts, prefs });
              })
            }
          />
          {ALERT_LABELS[k]}
        </label>
      ))}
      <div className="row" style={{ marginTop: 10 }}>
        <button
          disabled={!alerts.enabled || test.busy}
          onClick={() =>
            void test.run(async () => {
              const r = await api<{ ok: boolean; error?: string }>("POST", "/alerts/test");
              load();
              if (!r.ok) throw new Error(r.error ?? "Test failed");
              return "Test message sent.";
            })
          }
        >
          Send test
        </button>
        {test.result && <span className="small ok-text">{test.result}</span>}
        {(alerts.queued > 0 || alerts.dropped > 0) && (
          <span className="small muted">
            {alerts.queued} queued · {alerts.dropped} dropped
          </span>
        )}
      </div>
      {alerts.lastError && <p className="small bad-text">Last error: {alerts.lastError}</p>}
      <ErrorBox error={save.error ?? test.error} />
    </Card>
  );
}
