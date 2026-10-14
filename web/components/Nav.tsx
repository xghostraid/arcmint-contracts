"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { shortenAddress } from "@/lib/format";

export function Nav() {
  const path = usePathname();
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const injected = connectors.find((c) => c.id === "injected") ?? connectors[0];

  return (
    <header className="nav">
      <Link href="/" className="brand">
        <span className="brand-arc">arc</span>mint<span className="muted">.fun</span>
      </Link>
      <nav className="nav-links">
        <Link className={path === "/" ? "active" : ""} href="/">
          Live
        </Link>
        <Link className={path?.startsWith("/explore") ? "active" : ""} href="/explore">
          Browse
        </Link>
        <Link className={path?.startsWith("/create") ? "active" : ""} href="/create">
          Create
        </Link>
        <Link className={path?.startsWith("/dashboard") ? "active" : ""} href="/dashboard">
          Hub
        </Link>
      </nav>
      {isConnected && address ? (
        <button type="button" className="wallet-btn" onClick={() => disconnect()}>
          {shortenAddress(address)}
        </button>
      ) : (
        <button
          type="button"
          className="wallet-btn primary"
          disabled={isPending || !injected}
          onClick={() => injected && connect({ connector: injected })}
        >
          Connect
        </button>
      )}
    </header>
  );
}
