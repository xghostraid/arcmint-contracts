# OAuth / quotas / ops slice — integration gaps

The auth foundation lives under `promptfun/src/auth/` and `promptfun/src/platform/`.

## Wired when `PROMPTFUN_OAUTH_ENABLED=1` (or `PROMPTFUN_OAUTH_REQUIRED=1`)

- RFC 9728 metadata at `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`.
- HTTP routes: `/oauth/register`, `/oauth/authorize`, `/oauth/token`, `/oauth/magic/verify` (`auth/routes.ts`).
- `PROMPTFUN_OAUTH_REQUIRED=1` gates `/mcp` with `authenticateBearer` + `WWW-Authenticate` (`auth/mcp.ts`).
- Public `GET /api/status` (no secrets).
- Quotas (2/day, 5/month UTC) and monthly budget ledger on sponsored `confirm_launch` when a signed-in user is present.
- Ops: `POST /ops/sponsor-pause` with `Authorization: Bearer $PROMPTFUN_OPS_TOKEN` toggles runtime sponsor pause (env `PROMPTFUN_SPONSOR_KILL_SWITCH` still wins).

## Still missing

- `ClaimLaterWalletProvider` / Privy integration and `docs/custody.md`.
- `wallet-provider.test.ts`.
- Email delivery for magic links (dev exposes link when `PROMPTFUN_OAUTH_EXPOSE_MAGIC_LINK=1`).
- Payout cron and full ops dashboard.

MCP `get_capabilities` reflects OAuth optional vs required from config.
