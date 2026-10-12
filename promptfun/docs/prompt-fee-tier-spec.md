# Creator fees and $PROMPT tier spec

**Status:** Locked (Oct 2026). Site: [promptfun.fun/#prompt-fees](https://promptfun.fun/#prompt-fees) · [Creator fees doc](https://promptfun.fun/docs/creator-fees.html)

## Definitions

- **Creator fees:** SOL from pump.fun bonding-curve trades owed to the coin’s configured fee-sharing recipients.
- **Network fees:** Solana transaction cost; on sponsored mainnet, promptfun pays from the sponsor wallet.
- **promptfun platform cut:** **0%** of pump.fun creator fees. Tier splits divide pump.fun’s creator-fee share only.

## Phases

| Phase | On-chain creator fee behavior | `creatorWallet` at prepare_launch |
|-------|--------------------------------|-----------------------------------|
| **Pre-mint (now)** | **100%** locks to **promptfun official wallet** (treasury). | **Required for ops:** stored on intent for manual payout records; not used for on-chain split until $PROMPT tier is active. |
| **Post-mint** | **≥ 1 whole $PROMPT** in `creatorWallet` at prepare_launch → **100%** to creator wallet. Else → **50%** creator / **50%** treasury. | Same wallet; RPC balance check when `PROMPTFUN_PROMPT_MINT` is set **and** mint exists on chain. |

## Official wallet (ops)

**Pubkey (production reference):** `HAon3RnrtQt3jNMBfXrTceWSjq7N5ume6APenYBUcYkK`

| Env | Purpose |
|-----|---------|
| `PROMPTFUN_TREASURY_PUBKEY` | Preferred treasury for pre-mint fees and post-mint non-holder 50%. |
| `PROMPTFUN_SPONSOR_FEE_RECIPIENT` | Fallback when treasury unset (same pubkey as sponsor fee recipient in prod). |

Manual creator payouts off-chain until $PROMPT on-chain tiers are active.

## Post-mint tier rules

1. **Minimum balance:** 1 whole $PROMPT (`PROMPTFUN_PROMPT_MIN_BALANCE` optional override, raw units).
2. **Wallet checked:** `creatorWallet`, or signed-in claim-later Privy wallet when omitted.
3. **On chain:** `updateFeeShares` with 10_000 bps to one address or 5_000 + 5_000 split.
4. **If mint env missing or mint not on chain:** Pre-mint behavior (100% treasury on chain).

## MCP / env

| Env | Purpose |
|-----|---------|
| `PROMPTFUN_PROMPT_MINT` | SPL mint pubkey; unset until live. |
| `PROMPTFUN_PROMPT_MIN_BALANCE` | Optional raw minimum for 100% tier. |

## Code

- `promptfun/src/chains/solana/prompt-tier.ts`
- `prepare_launch` in `promptfun/src/intents/service.ts`
- `buildPumpfunLaunchSponsored` in `promptfun/src/chains/solana/pumpfun.ts`
