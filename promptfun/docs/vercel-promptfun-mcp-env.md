# Vercel — promptfun-mcp environment

**Project:** `promptfun-mcp` (container, root directory `promptfun/`)  
**Team:** `ghosts-projects-142d49da`  
**Git:** `github.com/xghostraid/arcmint-contracts` → `main`  
**Public URL:** `https://promptfun-mcp.vercel.app` (Claude should use **`https://promptfun.fun/mcp`** via the site proxy)

Set variables in **Vercel → promptfun-mcp → Settings → Environment Variables** for **Production** (and Preview if you test PRs).

## Required for production MCP (mainnet pump.fun + explore)

| Variable | Example / notes |
|----------|-----------------|
| **`PROMPTFUN_PUBLIC_URL`** | `https://promptfun.fun` — approval links and MCP Host check (no trailing slash) |
| **`PROMPTFUN_OAUTH_SIGNING_SECRET`** | Long random string (`openssl rand -hex 32`) |
| **`BLOB_READ_WRITE_TOKEN`** | From Vercel **Storage → Blob → promptfun-pictures → Connect to project**. Enables: picture bytes + metadata JSON, panel handoff JSON, **intent catalog** (`intents/{id}.json`), and **explore rehydration** when SQLite is empty. Alias: `PROMPTFUN_BLOB_READ_WRITE_TOKEN`. |
| **`PROMPTFUN_ENABLE_PUMPFUN_MAINNET`** | `1` |
| **`PROMPTFUN_ENABLE_SPONSORED_MAINNET`** | `1` — in-chat sponsored launches (no Phantom on mainnet pump.fun) |
| **`PROMPTFUN_ENABLE_SPONSORED_LAUNCHES`** | `1` |
| **`PROMPTFUN_SPONSOR_SECRET_KEY`** | Base58 sponsor keypair secret (never commit) |
| **`PROMPTFUN_SPONSOR_FEE_RECIPIENT`** | Sponsor pubkey (optional; defaults in code) |

Without **`BLOB_READ_WRITE_TOKEN`**, serverless instances cannot share intents (prepare on instance A → confirm on B fails) and **`/api/coins`** stays empty after redeploy until new mainnet launches confirm.

## Strongly recommended

| Variable | Purpose |
|----------|---------|
| **`PROMPTFUN_PINATA_JWT`** | Public IPFS pins when Kubo is not used |
| **`PROMPTFUN_MONTHLY_BUDGET_USD`** | Sponsored spend cap tracking |
| **`PROMPTFUN_OPS_TOKEN`** | Protected ops routes |
| **`PROMPTFUN_PRIVY_APP_ID`** / **`PROMPTFUN_PRIVY_APP_SECRET`** | Claim-later creator wallets when OAuth is on |

## Optional / gates

| Variable | Purpose |
|----------|---------|
| **`PROMPTFUN_DB`** | Default `./data/promptfun.sqlite` — **ephemeral on Vercel** unless you attach external DB (Turso, etc.) |
| **`PROMPTFUN_ENABLE_PUMPFUN_DEVNET`** | Devnet pump.fun |
| **`PROMPTFUN_ENABLE_EVM_MAINNETS`** | EVM mainnets (off by default) |
| **`PROMPTFUN_INDEX_TESTNET_DEMOS`** | Index devnet demos in coin API (off in prod explore) |
| **`PROMPTFUN_OAUTH_ENABLED`** / **`PROMPTFUN_OAUTH_REQUIRED`** | OAuth on MCP |
| **`PROMPTFUN_PROMPT_MINT`** / **`PROMPTFUN_TREASURY_PUBKEY`** | Creator fee tier — see `docs/prompt-fee-tier-spec.md` |

Full local template: **`promptfun/.env.example`**.

## Verify Blob intent mirror (ops)

From `promptfun/` with production token in env (do not log the token):

```bash
BLOB_READ_WRITE_TOKEN='…' npx tsx scripts/verify-intent-blob-mirror.mts
```

Prints intent count and sample ids from `intents/` prefix (no secret values).

## Related site project (promptfun-fun)

Marketing site proxies `/mcp` and `/api/*` to MCP:

| Variable | Value |
|----------|--------|
| **`PROMPTFUN_BACKEND_URL`** | `https://promptfun-mcp.vercel.app` |

See project Context **`docs/vercel-promptfun-fun.md`**.
