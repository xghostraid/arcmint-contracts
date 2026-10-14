"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CatalogToken } from "@/lib/catalog";
import { TokenGrid } from "./TokenCard";
import { showToast } from "./ToastHost";

type TokensResponse = {
  launchCount: number;
  total: number;
  toBlock: number;
  tokens: CatalogToken[];
};

function tokenKey(token: CatalogToken) {
  return token.token.toLowerCase();
}

export function LiveBoard({
  initial,
  empty,
  creator,
  query = "",
  showStats = false,
  notify = true,
}: {
  initial: CatalogToken[];
  empty: string;
  creator?: string;
  query?: string;
  showStats?: boolean;
  notify?: boolean;
}) {
  const [tokens, setTokens] = useState(initial);
  const [launchCount, setLaunchCount] = useState(initial.length);
  const [toBlock, setToBlock] = useState(0);
  const seen = useRef(new Set(initial.map(tokenKey)));
  const lastCount = useRef(initial.length);
  const ready = useRef(false);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const creatorLc = creator?.toLowerCase();
    return tokens.filter((t) => {
      if (creatorLc && t.creator.toLowerCase() !== creatorLc) return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        t.symbol.toLowerCase().includes(q) ||
        t.token.toLowerCase().includes(q)
      );
    });
  }, [tokens, query, creator]);

  useEffect(() => {
    let cancelled = false;

    async function apply(data: TokensResponse, announce: boolean) {
      if (!Array.isArray(data.tokens)) return;
      const next = data.tokens;
      if (typeof data.launchCount === "number") {
        setLaunchCount(data.launchCount);
        lastCount.current = data.launchCount;
      }
      if (typeof data.toBlock === "number") setToBlock(data.toBlock);
      setTokens(next);
      if (announce && notify && ready.current) {
        for (const token of next) {
          const key = tokenKey(token);
          if (seen.current.has(key)) continue;
          seen.current.add(key);
          showToast(`$${token.symbol} is live`, `${token.name} just launched on the factory.`);
        }
      } else {
        for (const token of next) seen.current.add(tokenKey(token));
      }
    }

    async function pullFull(announce: boolean) {
      const res = await fetch(`/api/tokens?limit=100&_=${Date.now()}`, { cache: "no-store" });
      const data = (await res.json()) as TokensResponse;
      if (!cancelled) await apply(data, announce);
    }

    async function tick() {
      try {
        const headRes = await fetch(`/api/tokens/count?_=${Date.now()}`, { cache: "no-store" });
        const head = (await headRes.json()) as { launchCount?: number };
        const count = Number(head.launchCount ?? 0);
        if (count !== lastCount.current) {
          await pullFull(true);
        }
      } catch {
        await pullFull(true).catch(() => undefined);
      }
    }

    pullFull(false)
      .then(() => {
        ready.current = true;
      })
      .catch(() => undefined);

    const id = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void tick();
    }, 2_000);

    const onFocus = () => {
      void tick();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [notify]);

  return (
    <>
      {showStats ? (
        <p className="stats">
          {launchCount} factory launches · {visible.length} on this board
          {visible.length ? ` · ${visible.map((t) => `$${t.symbol}`).join(" · ")}` : ""}
          {toBlock ? <span className="muted"> · block {toBlock}</span> : null}
        </p>
      ) : null}
      <TokenGrid tokens={visible} empty={empty} />
    </>
  );
}
