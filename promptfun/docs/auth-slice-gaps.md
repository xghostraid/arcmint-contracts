# OAuth / quotas / ops slice — integration gaps

The auth foundation lives under `promptfun/src/auth/` and `promptfun/src/platform/`.

## Wired when `PROMPTFUN_OAUTH_ENABLED=1` (or `PROMPTFUN_OAUTH_REQUIRED=1`)

- RFC 9728 metadata at `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`.
- HTTP routes: `/oauth/register`, `/oauth/authorize`, `/oauth/token`, `/oauth/magic/verify` (`auth/routes.ts`).
- `PROMPTFUN_OAUTH_REQUIRED=1` gates `/mcp` with `authenticateBearer` + `WWW-Authenticate` (`auth/mcp.ts`).
- Public `GET /api/status` (no secrets).
- Quotas: global 30/hour and 200/day on every sponsored `confirm_launch`; optional per-user 2/day and 5/month when OAuth is on and the user is signed in.
- Monthly budget ledger on every sponsored `confirm_launch` when the platform DB is enabled (anonymous launches roll into sub `anonymous`).
- Ops: `POST /ops/sponsor-pause` with `Authorization: Bearer $PROMPTFUN_OPS_TOKEN` toggles runtime sponsor pause (env `PROMPTFUN_SPONSOR_KILL_SWITCH` still wins).
- Payout cron: `PROMPTFUN_ENABLE_PAYOUT_CRON=1` (default on with sponsored launches) calls pump.fun `distribute_creator_fees` on devnet/testnet when ≥0.003 SOL is waiting.
- `coin_status` / indexer: pump.fun fee split and waiting amounts read from chain on Solana testnets.

## Still missing

- ~~`ClaimLaterWalletProvider` / Privy integration and `docs/custody.md`.~~ **Shipped:** `src/wallets/`, `/claim`, `/api/claim/wallet`, MCP `get_claim_wallet`, `docs/custody.md`.
- ~~`wallet-provider.test.ts`.~~ **Shipped:** `test/unit/wallet-provider.test.ts`.
- Email delivery for magic links (dev exposes link when `PROMPTFUN_OAUTH_EXPOSE_MAGIC_LINK=1`).
- Full ops dashboard (pause toggle exists; no UI).
- Mainnet pump.fun sponsored launches and mainnet fee/market reads.

MCP `get_capabilities` reflects OAuth optional vs required from config.
