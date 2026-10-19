import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type Group, type Status, type Wallet } from "./api";

interface AppState {
  status: Status;
  wallets: Wallet[];
  groups: Group[];
  refresh: () => Promise<void>;
  refreshStatus: () => Promise<void>;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside provider");
  return v;
}

export function AppProvider({ status, refreshStatus, children }: { status: Status; refreshStatus: () => Promise<void>; children: ReactNode }) {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const refresh = useCallback(async () => {
    const [w, g] = await Promise.all([api<Wallet[]>("GET", "/wallets?archived=1"), api<Group[]>("GET", "/groups")]);
    setWallets(w);
    setGroups(g);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return <Ctx.Provider value={{ status, wallets, groups, refresh, refreshStatus }}>{children}</Ctx.Provider>;
}

export interface Balances {
  native: Record<string, string>;
  token?: Record<string, string>;
}

export function useBalances(walletIds: number[] | null, mint?: string) {
  const [balances, setBalances] = useState<Balances>({ native: {} });
  const [loading, setLoading] = useState(false);
  const key = `${walletIds?.join(",") ?? "all"}|${mint ?? ""}`;
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setBalances(await api<Balances>("POST", "/balances", { walletIds: walletIds ?? undefined, mint: mint || undefined }));
    } catch {
      setBalances({ native: {} });
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    void load();
  }, [load]);
  return { balances, loading, reload: load };
}
