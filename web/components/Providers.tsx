"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { injected } from "@wagmi/core";
import { WagmiProvider, createConfig, http } from "wagmi";
import { ARC_RPC, arcMainnet } from "@/lib/chain";
import { ToastHost } from "./ToastHost";

function rpcUrl() {
  if (typeof window === "undefined") return ARC_RPC;
  return `${window.location.origin}/api/rpc`;
}

const wagmiConfig = createConfig({
  chains: [arcMainnet],
  connectors: [injected({ shimDisconnect: true })],
  transports: {
    [arcMainnet.id]: http(rpcUrl(), {
      fetchOptions: { headers: { "user-agent": "arcmint-catalog" } },
    }),
  },
  ssr: true,
});

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ToastHost />
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
