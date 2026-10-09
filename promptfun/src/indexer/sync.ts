import type { Config } from "../config.js";
import { findChain } from "../chains/registry.js";
import type { IntentStore } from "../intents/store.js";
import type { Intent, LaunchParams } from "../intents/types.js";
import { coinId, type CoinRecord } from "./record.js";
import { defaultLiveSnapshot } from "./live.js";

export function coinFromIntent(config: Config, intent: Intent): CoinRecord | null {
  if (intent.kind !== "launch_token" || intent.status !== "confirmed" || !intent.receipt || intent.receipt.status !== "success") {
    return null;
  }
  const chain = findChain(config, intent.chain);
  if (!chain) return null;
  const params = intent.params as LaunchParams;
  const address = intent.receipt.tokenAddress ?? intent.built?.tokenAddress;
  if (!address) return null;
  const launchTx = intent.submission?.id ?? intent.receipt.id;
  const verified = [...intent.receipt.verified];
  const record: CoinRecord = {
    id: coinId(chain.key, address),
    chainKey: chain.key,
    venue: params.venue,
    address,
    name: params.name,
    symbol: params.symbol,
    decimals: params.decimals,
    supply: params.supply,
    imageUrl: null,
    creator: intent.built?.signer ?? "unknown",
    launchedAt: intent.receipt.confirmedAt,
    launchTx,
    description: params.description,
    metadataUri: params.metadataUri || null,
    recordedFrom: "receipt",
    verified,
    intentId: intent.id,
    live: defaultLiveSnapshot(chain, params.venue),
  };
  return record;
}

export function syncCoinsFromIntents(config: Config, intents: IntentStore): CoinRecord[] {
  const out: CoinRecord[] = [];
  for (const intent of intents.withStatus("confirmed")) {
    const coin = coinFromIntent(config, intent);
    if (coin) out.push(coin);
  }
  return out;
}
