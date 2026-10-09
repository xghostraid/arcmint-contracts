# Claim-later wallet custody (Privy)

promptfun beats getplugged.fun row #11 by giving **user-owned embedded Solana wallets** tied to the sign-in email, instead of keeping 100% of creator fees when the user has no external wallet.

## What we store

- **Platform DB:** `sub`, email, Privy user id, Solana address (public), timestamps.
- **We never store:** Privy app secret, wallet private keys, or seed phrases (env-only `PROMPTFUN_PRIVY_APP_ID` / `PROMPTFUN_PRIVY_APP_SECRET`).

## Who controls the wallet

- Wallets are **Privy embedded wallets** created with `owner: { user_id }` (user-owned).
- The user proves email ownership via OAuth magic link or MCP Bearer token before we create or reveal an address.
- Export, recovery, and signing for withdrawals use Privy's user-facing flows for that email—not promptfun's sponsor key.

## When fees lock to this wallet

On sponsored pump.fun launches, if `prepare_launch` omits `creatorWallet` and the MCP caller is signed in (`PROMPTFUN_OAUTH_*` + Bearer token), promptfun resolves or creates the user's Solana wallet and sets `feeRecipient` to that address on chain.

## User-facing surfaces

| Surface | Purpose |
|---|---|
| `GET /claim` | Email magic link to reveal the Solana payout address |
| `GET/POST /api/claim/wallet` | JSON wallet for authenticated MCP/OAuth Bearer callers |
| MCP `get_claim_wallet` | Same data inside Claude |

## Ops checklist

1. Create a Privy app; enable embedded Solana wallets.
2. Set `PROMPTFUN_PRIVY_APP_ID` and `PROMPTFUN_PRIVY_APP_SECRET` in the deployment environment (never in git).
3. Enable OAuth (`PROMPTFUN_OAUTH_ENABLED=1` or required).
4. Confirm `/api/status` shows `claimWalletEnabled: true`.
