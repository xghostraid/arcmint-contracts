# OAuth / quotas / ops slice — integration gaps

The auth foundation from PR #8 lives under `promptfun/src/auth/` and `promptfun/src/platform/` but is **not** wired into the running server yet.

## Landed in tree

- Token helpers (`auth/token.ts`), PKCE (`auth/pkce.ts`), Bearer parsing (`auth/mcp.ts`).
- RFC 9728-style metadata builders (`auth/metadata.ts`).
- Magic-link OAuth server class (`auth/oauth-server.ts`) backed by `platform/store.ts`.
- Install/bootstrap scripts under `promptfun/scripts/` for a fuller slice tarball (not committed).

## Still missing before production OAuth

- HTTP routes: `/oauth/register`, `/oauth/authorize`, `/oauth/token`, `/oauth/magic/verify` (replace `404` stubs on `/.well-known/oauth*` in `app.ts`).
- `PROMPTFUN_OAUTH_REQUIRED=1` gate on `/mcp` using `authenticateBearer` + `WWW-Authenticate`.
- Quotas (2/day, 5/month), monthly budget ledger, kill-switch ops API.
- `ClaimLaterWalletProvider` / Privy integration and `docs/custody.md`.
- Unit tests: `oauth.test.ts`, `quota-budget.test.ts`, `wallet-provider.test.ts`.

MCP `get_capabilities` still documents **No sign in** until the above ships.
