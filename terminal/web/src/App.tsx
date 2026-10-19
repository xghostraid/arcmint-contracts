import { useCallback, useEffect, useState } from "react";
import { api, getToken, onServerEvent, setToken, setUnauthorizedHandler, type Status } from "./api";
import { AppProvider } from "./state";
import { Unlock } from "./pages/Unlock";
import { Wallets } from "./pages/Wallets";
import { Trade } from "./pages/Trade";
import { Treasury } from "./pages/Treasury";
import { Launch } from "./pages/Launch";
import { Activity } from "./pages/Activity";
import { Settings } from "./pages/Settings";
import { Dashboard } from "./pages/Dashboard";
import { Bots } from "./pages/Bots";

const PAGES = ["Dashboard", "Wallets", "Trade", "Bots", "Treasury", "Launch", "Activity", "Settings"] as const;
type Page = (typeof PAGES)[number];

function pageFromHash(): Page {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, "").split("?")[0] ?? "");
  return (PAGES as readonly string[]).includes(h) ? (h as Page) : "Dashboard";
}

export function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [authed, setAuthed] = useState(!!getToken());
  const [page, setPage] = useState<Page>(pageFromHash());
  const hashMint = new URLSearchParams(location.hash.split("?")[1] ?? "").get("mint") ?? undefined;
  const [tradeMint, setTradeMint] = useState<string | undefined>(hashMint);
  const [dashMint, setDashMint] = useState<string | undefined>(hashMint);

  const refreshStatus = useCallback(async () => setStatus(await api<Status>("GET", "/status")), []);
  useEffect(() => {
    void refreshStatus();
    setUnauthorizedHandler(() => {
      setAuthed(false);
      void refreshStatus();
    });
    const onHash = () => setPage(pageFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [refreshStatus]);

  const unlocked = authed && !!status?.vault.unlocked;
  useEffect(() => (unlocked ? onServerEvent("bot", () => void refreshStatus()) : undefined), [unlocked, refreshStatus]);

  if (!status) return <div className="center muted">Connecting…</div>;
  if (!authed || !status.vault.unlocked) {
    return (
      <Unlock
        status={status}
        onDone={() => {
          setAuthed(true);
          void refreshStatus();
        }}
      />
    );
  }

  const go = (p: Page) => {
    location.hash = `/${p}`;
    setPage(p);
  };

  return (
    <AppProvider status={status} refreshStatus={refreshStatus}>
      <div className="shell">
        <nav className="side">
          <div className="brand">▲ Terminal</div>
          <span className={`net net-${status.network}`}>{status.network}</span>
          {PAGES.map((p) => (
            <button key={p} className={`nav ${p === page ? "active" : ""}`} onClick={() => go(p)}>
              {p}
              {p === "Bots" && status.botsRunning > 0 && <span className="nav-badge">{status.botsRunning}</span>}
            </button>
          ))}
          <div className="grow" />
          <button
            className="nav"
            onClick={() =>
              void api("POST", "/vault/lock").finally(() => {
                setToken(null);
                setAuthed(false);
                void refreshStatus();
              })
            }
          >
            🔒 Lock
          </button>
        </nav>
        <main className="main">
          {status.network === "mainnet" && <div className="banner">MAINNET — real funds. Cap: {status.maxSolPerAction} SOL per action.</div>}
          {status.killSwitch && (
            <div className="banner">
              Kill switch is ON: all bots are paused.{" "}
              <button className="link" onClick={() => go("Bots")}>
                Manage bots
              </button>
            </div>
          )}
          {page === "Dashboard" && (
            <Dashboard
              key={dashMint ?? ""}
              initialMint={dashMint}
              onTrade={(mint) => {
                setTradeMint(mint);
                go("Trade");
              }}
            />
          )}
          {page === "Wallets" && <Wallets />}
          {page === "Trade" && <Trade key={tradeMint ?? ""} initialMint={tradeMint} />}
          {page === "Bots" && <Bots />}
          {page === "Treasury" && <Treasury />}
          {page === "Launch" && (
            <Launch
              onOpenToken={(mint) => {
                setDashMint(mint);
                go("Dashboard");
              }}
            />
          )}
          {page === "Activity" && <Activity />}
          {page === "Settings" && <Settings />}
        </main>
      </div>
    </AppProvider>
  );
}
