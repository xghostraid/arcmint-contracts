import { defineChain } from "viem";

export const ARC_CHAIN_ID = 5042;
export const ARC_RPC = process.env.NEXT_PUBLIC_ARC_RPC ?? "https://rpc.mainnet.arc.io";
export const FACTORY_ADDRESS = (
  process.env.NEXT_PUBLIC_FACTORY_ADDRESS ?? "0x0F5d0D0271068568134Fa2ca834756f34C485901"
) as `0x${string}`;
export const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;
export const EXPLORER_URL = "https://explorer.arc.io";

export const arcMainnet = defineChain({
  id: ARC_CHAIN_ID,
  name: "Arc",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: [ARC_RPC] },
  },
  blockExplorers: {
    default: { name: "Arc Explorer", url: EXPLORER_URL },
  },
});
