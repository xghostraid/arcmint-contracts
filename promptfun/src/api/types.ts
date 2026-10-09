export interface Chain {
  key: string;
  name: string;
  family: "solana" | "evm";
  testnet: boolean;
  nativeSymbol: string;
}

export interface Links {
  explorer: string | null;
  launchTx: string | null;
  pumpfun: string | null;
}

export interface Market {
  priceNative: string | null;
  marketCapNative: string | null;
  priceUsd: string | null;
  marketCapUsd: string | null;
  graduated: boolean | null;
  source: string | null;
  reason: string | null;
  readAt: string | null;
}

export interface Holders {
  count: number | null;
  exact: boolean;
  source: string | null;
  reason: string | null;
  readAt: string | null;
}

export interface CreatorFees {
  symbol: string;
  paid: string | null;
  waiting: string | null;
  payouts: number | null;
  lastPaidAt: string | null;
  complete: boolean;
  source: string | null;
  reason: string | null;
  readAt: string | null;
}

export interface CoinSummary {
  id: string;
  chain: Chain;
  venue: "spl" | "pumpfun" | "erc20";
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  supply: string;
  imageUrl: string | null;
  creator: string;
  launchedAt: string;
  links: Links;
  market: Market;
  holders: Holders;
  creatorFees: CreatorFees;
}

export interface FeeRecipient {
  address: string;
  shareBps: number;
  role: "creator" | "promptfun" | "other";
  paid: string | null;
}

export interface FeeSplit {
  recipients: FeeRecipient[] | null;
  locked: boolean | null;
  source: string | null;
  reason: string | null;
  readAt: string | null;
}

export interface Share {
  text: string;
  intentUrl: string;
}

export interface CoinDetail extends CoinSummary {
  description: string;
  metadataUri: string | null;
  launchTx: string;
  recordedFrom: "receipt" | "chain-import";
  verified: string[];
  feeSplit: FeeSplit;
  share: Share;
}

export interface CoinsListResponse {
  coins: CoinSummary[];
  total: number;
  sort: string;
  limit: number;
  offset: number;
  generatedAt: string;
}

export interface StatsResponse {
  coins: number;
  byChain: Record<string, number>;
  mainnetCoins: number;
  creatorFeesPaid: Array<{ symbol: string; amount: string; coins: number; complete: boolean }>;
  generatedAt: string;
}
