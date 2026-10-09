# promptfun.fun MCP server

Say what you want in chat ("launch a token called Moon with a million supply", "send 0.1 SOL to …"). promptfun turns it into an exact transaction. You review the decoded steps and the network fee, then approve in **your own wallet**. promptfun reads the result back from the chain.

- **Host:** ChatGPT (as an Apps SDK app or connector) is the primary target. The server is standard MCP (Streamable HTTP at `/mcp`), so Claude and other MCP clients work too.
- **No keys on the server.** No user keys, mint keys, fee payer, or relayer. Your wallet signs. On Solana, the server relays only a transaction that is byte-identical to the preview, and only after every signature verifies.
- **No fake results.** Previews are decoded from the transaction bytes. Receipts are read from the chain. Each chain reports an honest status.
- **No promptfun fee.** Every preview shows the network fee, labelled as paid to the chain.

## Status

| Chain | Launch | Transfer | Status |
|---|---|---|---|
| Solana local validator | Token-2022 SPL | SOL, SPL | **verified**: `npm run test:e2e` |
| Solana devnet | Token-2022 SPL | SOL, SPL | **verified**: public devnet run on 2026-10-09 (below), signed by a Wallet Standard test wallet. Not yet signed with Phantom itself. |
| Solana mainnet | pump.fun only | — | **gated** behind `PROMPTFUN_ENABLE_PUMPFUN_MAINNET=1`. The transaction is built with the official `@pump-fun/pump-sdk` and decoded, but promptfun has never broadcast one. |
| Ethereum, Robinhood Chain, Base (in that order), then Arbitrum, Optimism, Polygon, BNB | ERC-20 | native, ERC-20 | Listed in `get_capabilities` but **disabled**: the EVM adapter is in progress. Testnets will be `configured`, mainnets `gated`. |

### Devnet evidence (2026-10-09)

Driven through the MCP tools with the official MCP SDK client (`scripts/devnet-demo.ts`). Each action was approved on the approval page in Chrome.

- Launch: mint [`9T2ZGEjb…faikds`](https://explorer.solana.com/address/9T2ZGEjbngvadmgZQouQgHRaA2pDFLkcpb3Mo2faikds?cluster=devnet), tx [`Lvr3Gs42…KfEY`](https://explorer.solana.com/tx/Lvr3Gs42ZPMteZZZrDG48g3S9peoC6pg2UneTWPa5GHy2rUTwqe5Jmeuna8r42XPusL8SYcXVk6iB4bR9LKf1EY?cluster=devnet).
- Token transfer: tx [`2ZRSbzmC…5SE7`](https://explorer.solana.com/tx/2ZRSbzmC3fDyGrG4g3f9xJkCLkaRZdSpwtWhPs57i2eyYPaLRHBUBhUpfB919bHXyC5abhxWQBAUjFttMW7G5SE7?cluster=devnet).
- SOL transfer: tx [`2o5CqE8g…4KsQ`](https://explorer.solana.com/tx/2o5CqE8gtZGhiAxCKGht5awAQmGBahvXxLaYDf1gmd6c6m5CwW7U5X1BcAnAhLvMk9Un5xNBkfYnBSeNNj5K4KsQ?cluster=devnet).

The wallet was the **demo test wallet** in `scripts/demo-wallet.ts`. It's a Wallet Standard wallet that the page discovers the same way it discovers Phantom, with the devnet key held by the test harness. Every signing request shows a visible prompt labelled as a test wallet.

## Quick start (local)

```bash
cd promptfun
npm ci
npm run dev                 # http://127.0.0.1:8787, MCP at /mcp
```

Then point an MCP client at `http://127.0.0.1:8787/mcp`, for example the official Inspector:

```bash
npx @modelcontextprotocol/inspector --cli http://127.0.0.1:8787/mcp --transport http --method tools/list
```

When a `prepare_*` tool returns, open its `approveUrl` in a desktop browser that has Phantom, Solflare, or Backpack installed. Set the wallet to **devnet** first.

ChatGPT can't reach `127.0.0.1`. See [docs/connect-chatgpt.md](docs/connect-chatgpt.md).

## Tools

| Tool | What it does | Annotations |
|---|---|---|
| `get_capabilities` | Chains, actions, honest per-chain status and evidence, limitations | read-only |
| `prepare_launch` | Validates a launch and returns an approval link plus the in-chat card. Moves nothing. | write (creates a pending intent), not destructive |
| `prepare_transfer` | Same, for sending the native coin or a token | write, not destructive |
| `get_action_status` | Current state. Once confirmed, the receipt read from the chain plus explorer links. | read-only |
| `get_balance` | Native or token balance, read from the chain | read-only |

`prepare_*` and `get_action_status` link the MCP Apps card `ui://promptfun/intent-card-v1.html` (`text/html;profile=mcp-app`) through `_meta.ui.resourceUri`, with `openai/outputTemplate` as ChatGPT's alias. The card shows the decoded steps, the network fee, and the status. It opens the approval page with `ui/open-link`, falling back to `window.openai.openExternal`. Every result also includes plain text with the link, for hosts that don't render the card.

## How an action flows

1. The model calls `prepare_launch` or `prepare_transfer` with typed fields. The server validates them against the chain registry and policy, and stores a single-use intent that expires in 15 minutes.
2. The user opens `/approve/<id>` and connects a Wallet Standard wallet.
3. The page calls `POST /api/intents/<id>/build`. The server compiles the exact transaction, decodes it back into plain-language steps (anything outside the allowlist is refused), simulates it, and prices it with live chain data.
4. The wallet signs (`solana:signTransaction`). The page posts the signed bytes to `/submit`. The server checks they match the preview byte for byte and that every signature verifies, then relays.
5. The server reads the transaction from the chain. For a launch it checks supply, decimals, holder balance, name and symbol, and authorities. For a transfer it checks the recipient's balance change. Only then does it report `confirmed`.

Solana SPL mints are created at an address derived from the user's key (`createAccountWithSeed`), so the wallet is the only signer. pump.fun requires the mint itself to sign. For that, the approval page generates a one-time Ed25519 key in the browser, signs with it, and discards it. The server only ever sees the public key.

## Fees

Previews show **"Network fee (paid to <chain>, not promptfun)"**:

- **Solana:** `getFeeForMessage` on the exact message, plus rent deposits, which come live from `getMinimumBalanceForRentExemption` for each new account. Nothing is hard-coded.
- **EVM (when it lands):** `estimateGas` × the live fee, plus the L1 data fee on rollups.
- **USD** is shown only on mainnets, from a live Pyth Hermes price under 2 minutes old. Testnet coins have no value, so they get no USD.
- **promptfun fee:** none.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `HOST` / `PORT` | `127.0.0.1` / `8787` | Listen address |
| `PROMPTFUN_PUBLIC_URL` | `http://127.0.0.1:$PORT` | Public origin for approval links. Also the allowed `Host` for `/mcp`. |
| `PROMPTFUN_DB` | `./data/promptfun.sqlite` | Intent store (`node:sqlite`). It holds no keys. |
| `PROMPTFUN_ENABLE_LOCALNET` | off | Enable `solana-localnet` (`solana-test-validator`) |
| `PROMPTFUN_ENABLE_PUMPFUN_MAINNET` | off | Enable pump.fun launches on Solana mainnet. **Spends real SOL.** Single-user local runs only. |
| `PROMPTFUN_ENABLE_EVM_MAINNETS` | off | Enable EVM mainnets, once the adapter exists |
| `PROMPTFUN_RPC_<CHAIN_KEY>` | public RPCs | Override an RPC, for example `PROMPTFUN_RPC_SOLANA_DEVNET` |
| `PROMPTFUN_INTENT_TTL_MS` | 900000 | Intent lifetime |
| `PROMPTFUN_MAX_INTENTS_PER_HOUR` | 120 | Global creation rate limit |

## Tests

```bash
npm run typecheck
npm test                          # unit tests, no network
solana-test-validator --reset &   # Agave CLI
npm run test:e2e                  # MCP client → tools → approval API → local chain
npm run demo:devnet               # the real public devnet run (needs a funded devnet key; opens Chrome)
```

## Security

- The model is untrusted. It can only create an intent, and nothing moves without the user's wallet signature.
- The client is untrusted. The server checks the signed bytes against the preview and verifies every signature.
- The approval page runs with a strict CSP (no inline script, `frame-ancestors 'none'`), no cookies, and no third-party scripts. POSTs must be JSON and come from the same origin.
- Mainnets are off by default.
- Launches can't use promptfun's name or a major token's symbol (SOL, USDC, ETH, …).
- Intent ids are 128-bit random capabilities. Anyone holding an approval link can only spend their *own* funds by approving it.

## Not done yet

- The EVM adapter, coming next in the order Ethereum, Robinhood Chain, Base.
- OAuth, which is required before mainnets go on a shared server.
- WalletConnect (mobile) and passkeys.
- Image and IPFS upload.
- A run with Phantom itself, which needs a human with the extension.
- Listing in the public ChatGPT app directory, which OpenAI's policy blocks. See the connection guide.

## Layout

```
src/
  app.ts, http.ts, stdio.ts   HTTP server (/mcp, approval page and API), entry points
  mcp/                        MCP server, tools, intent card, result text
  intents/                    intent service, SQLite store, types
  chains/                     registry, adapter interface
    solana/                   adapter, byte decoder, pump.fun builder
    evm/                      chain list (adapter next)
  web/page.ts                 server-rendered approval page
public/                       approve.js (Wallet Standard), approve.css, fonts (OFL)
scripts/                      devnet demo driver, Wallet Standard test wallet
test/unit, test/e2e
```
