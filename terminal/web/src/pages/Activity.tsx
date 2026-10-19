import { useEffect, useState } from "react";
import { api, getToken, short, type Activity as Entry } from "../api";
import { Card } from "../components/ui";
import { useApp } from "../state";

export function Activity() {
  const { wallets } = useApp();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [live, setLive] = useState(false);
  const labels = new Map(wallets.map((w) => [w.address, w.label]));

  useEffect(() => {
    void api<Entry[]>("GET", "/activity").then(setEntries);
    const es = new EventSource(`/api/events?token=${encodeURIComponent(getToken() ?? "")}`);
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    es.addEventListener("activity", (e) => setEntries((prev) => [JSON.parse((e as MessageEvent).data) as Entry, ...prev].slice(0, 500)));
    return () => es.close();
  }, []);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Activity</h1>
        <span className={`pill ${live ? "ok" : "muted"}`}>{live ? "live" : "offline"}</span>
      </div>
      <Card>
        <table className="table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Kind</th>
              <th>Status</th>
              <th>Summary</th>
              <th>Wallet</th>
              <th>Tx</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="muted nowrap">{new Date(e.createdAt).toLocaleString()}</td>
                <td>{e.kind}</td>
                <td>
                  <span className={`pill ${e.status === "ok" ? "ok" : e.status === "failed" ? "bad" : "muted"}`}>{e.status}</span>
                </td>
                <td>
                  {e.summary}
                  {e.detail?.error && <div className="err-cell">{e.detail.error.slice(0, 200)}</div>}
                </td>
                <td>{e.walletAddress ? <span className="own">{labels.get(e.walletAddress) ?? short(e.walletAddress)}</span> : ""}</td>
                <td className="mono">{e.signature ? short(e.signature) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!entries.length && <p className="muted">Nothing yet.</p>}
      </Card>
    </div>
  );
}
