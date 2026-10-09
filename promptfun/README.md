# promptfun.fun MCP server

Say what you want in chat ("launch a token called Moon with a million supply", "send 0.1 SOL to …"). promptfun turns it into an exact transaction. You review the decoded steps and the network fee, then approve in **your own wallet**. promptfun reads the result back from the chain.

- **Host:** Claude custom connector first. ChatGPT is dropped for v1; standard MCP at `/mcp`.
- **Sponsored testnet launches:** `PROMPTFUN_ENABLE_SPONSORED_LAUNCHES=1` + sponsor key; user confirms via `confirm_launch` in the card.
- **No keys on the server.** No user keys, mint keys, fee payer, or relayer. Your wallet signs. On Solana, the server relays only a transaction that is byte-identical to the preview, and only after every signature verifies.
- **No fake results.** Previews are decoded from the transaction bytes. Receipts are read from the chain. Each chain reports an honest status.
- **No promptfun fee.** Every preview shows the network fee, labelled as paid to the chain.

## Status

| Chain | Launch | Transfer | Status |
|---|---|---|---|
| Solana local validator | Token-2022 SPL | SOL, SPL | **verified**: `npm run test:e2e` |
| Solana devnet | Token-2022 SPL | SOL, SPL | **verified**: public devnet run on 2026-10-09 (below), signed by a Wallet Standard test wallet. Not yet signed with Phantom itself. |
| Solana mainnet | pump.fun only | — | **gated** behind `PROMPTFUN_ENABLE_PUMPFUN_MAINNET=1`. The transaction is built with the official `@pump-fun/pump-sdk` and decoded, but promptfun has never broadcast one. |
| Local EVM (Anvil) | fixed-supply ERC-20 | ETH, ERC-20 | **verified**: `npm run test:e2e` and a browser run with an EIP-6963 test wallet (`npm run demo:evm`) |
| Robinhood Chain Testnet (46630) | fixed-supply ERC-20 | ETH, ERC-20 | **verified**: public testnet run on 2026-10-09 (below), signed by an EIP-6963 test wallet. Not yet signed with MetaMask itself. |
| Ethereum Sepolia, Base Sepolia, then Arbitrum Sepolia, OP Sepolia, Polygon Amoy, BNB Testnet | fixed-supply ERC-20 | native, ERC-20 | **configured**: same adapter as Anvil and Robinhood Chain Testnet, but not run on these networks yet, because the demo key has no testnet ETH there |
| The matching EVM mainnets | fixed-supply ERC-20 | native, ERC-20 | **gated** behind `PROMPTFUN_ENABLE_EVM_MAINNETS=1`. Never broadcast. |

### Devnet evidence (2026-10-09)

Driven through the MCP tools with the official MCP SDK client (`scripts/devnet-demo.ts`). Each action was approved on the approval page in Chrome.

- Launch: mint [`9T2ZGEjb…faikds`](https://explorer.solana.com/address/9T2ZGEjbngvadmgZQouQgHRaA2pDFLkcpb3Mo2faikds?cluster=devnet), tx [`Lvr3Gs42…KfEY`](https://explorer.solana.com/tx/Lvr3Gs42ZPMteZZZrDG48g3S9peoC6pg2UneTWPa5GHy2rUTwqe5Jmeuna8r42XPusL8SYcXVk6iB4bR9LKf1EY?cluster=devnet).
- Token transfer: tx [`2ZRSbzmC…5SE7`](https://explorer.solana.com/tx/2ZRSbzmC3fDyGrG4g3f9xJkCLkaRZdSpwtWhPs57i2eyYPaLRHBUBhUpfB919bHXyC5abhxWQBAUjFttMW7G5SE7?cluster=devnet).
- SOL transfer: tx [`2o5CqE8g…4KsQ`](https://explorer.solana.com/tx/2o5CqE8gtZGhiAxCKGht5awAQmGBahvXxLaYDf1gmd6c6m5CwW7U5X1BcAnAhLvMk9Un5xNBkfYnBSeNNj5K4KsQ?cluster=devnet).

The wallet was the **demo test wallet** in `scripts/demo-wallet.ts`. It's a Wallet Standard wallet that the page discovers the same way it discovers Phantom, with the devnet key held by the test harness. Every signing request shows a visible prompt labelled as a test wallet.

### Robinhood Chain Testnet evidence (2026-10-09)

Driven the same way with `scripts/evm-demo.ts` and the EIP-6963 test wallet in `scripts/demo-evm-wallet.ts`, from `0x618E2D806D8C6826F9e403ffB23cDF629156F521`.

- Launch: token [`0x9381DFa4…FA5c6`](https://explorer.testnet.chain.robinhood.com/address/0x9381DFa468Bf1a15432EC0Ca3A2Aef84274FA5c6), tx [`0x046eb9dc…28e5`](https://explorer.testnet.chain.robinhood.com/tx/0x046eb9dc67e3e65795938f81d37c80d143414e96fc8d1fbb4f92b644283e28e5). The deployed code is byte-identical to promptfun's token, and name, symbol, decimals, supply, and the deployer's balance were read back.
- Token transfer: tx [`0x5f693398…331b`](https://explorer.testnet.chain.robinhood.com/tx/0x5f693398390001d95eedf3d599c322ed3f2fb594796024705729a5394de5331b), checked against the Transfer event.
- ETH transfer: tx [`0x61d6027a…d6dc`](https://explorer.testnet.chain.robinhood.com/tx/0x61d6027a1221a52af8cc7a37dbe3468a80d42958b9e9b16e862774da6f86d6dc).

The three cost about 0.0000063 ETH in network fees together.

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

Claude can't reach `127.0.0.1`. See [docs/connect-claude.md](docs/connect-claude.md).

## Tools

| Tool | What it does | Annotations |
|---|---|---|
| `get_capabilities` | Chains, actions, honest per-chain status and evidence, limitations | read-only |
| `prepare_launch` | Read-only preview with simulation and card. | read-only |
| `confirm_launch` / `confirm_launch_by_text` | Sponsored send after in-chat confirm. | write |
| `prepare_transfer` | Same, for sending the native coin or a token | write, not destructive |
| `get_action_status` | Current state. Once confirmed, the receipt read from the chain plus explorer links. | read-only |
| `get_balance` | Native or token balance, read from the chain | read-only |

### EVM launches

An EVM launch deploys `contracts/PromptfunToken.sol`, which is OpenZeppelin's `ERC20` with the whole supply minted once to the deployer. It has no owner, no mint, no pause, and no upgrade path. The contract is compiled when first used, with a pinned `solc` 0.8.37 (EVM version `paris`, so it runs on every listed chain), and no bytecode is checked in.

Wallets send EVM transactions themselves (`eth_sendTransaction`), so the server can't check bytes before broadcast. Instead it checks the transaction afterwards. It reads the transaction by hash and requires `from`, `to`, data, value, and chain ID to match the preview exactly. For a launch it also requires the deployed code to be byte-identical to the code the simulation produced, then reads name, symbol, decimals, supply, and the deployer's balance. Any difference is reported as `failed` with a MISMATCH line, never as success.

Fees come from `eth_estimateGas` × the live base fee plus tip, rounded up to 8 decimals. On OP-stack chains (Base, OP) the L1 data fee from the GasPriceOracle predeploy is added. On Arbitrum Nitro chains (Robinhood Chain, Arbitrum) the gas estimate already includes L1 costs.

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
- **EVM:** `eth_estimateGas` × the live base fee plus tip, plus the L1 data fee on OP-stack chains. Rounded up, and the cap if the base fee rises is shown too.
- **USD** is shown only on mainnets, from a live Pyth Hermes price under 2 minutes old. Testnet coins have no value, so they get no USD.
- **promptfun fee:** none.

## Production deploy

Ship the Node service from this folder (`promptfun/`):

- **Docker:** `docker build -t promptfun-mcp . && docker run -p 8787:8787 --env-file .env promptfun-mcp`
- **Fly.io:** `fly volumes create promptfun_data -r iad` (once), then `fly deploy` (uses `fly.toml` + persistent `/data` for SQLite).
- **Railway:** point the service **Root Directory** at `promptfun/` (uses `railway.toml` + `Dockerfile`).

Copy `.env.example` into your host’s environment UI (never commit secrets). Set `PROMPTFUN_PUBLIC_URL` to `https://promptfun.fun` when the Vercel site proxies `/mcp` and `/api` to this service.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `HOST` / `PORT` | `127.0.0.1` / `8787` | Listen address |
| `PROMPTFUN_PUBLIC_URL` | `http://127.0.0.1:$PORT` | Public origin for approval links. Also the allowed `Host` for `/mcp`. |
| `PROMPTFUN_DB` | `./data/promptfun.sqlite` | Intent store (`node:sqlite`). It holds no keys. |
| `PROMPTFUN_ENABLE_LOCALNET` | off | Enable `solana-localnet` (`solana-test-validator`) and `evm-localnet` (`anvil`) |
| `PROMPTFUN_ENABLE_PUMPFUN_MAINNET` | off | Enable pump.fun launches on Solana mainnet. **Spends real SOL.** Single-user local runs only. |
| `PROMPTFUN_ENABLE_EVM_MAINNETS` | off | Enable EVM mainnets. **Spends real ETH, BNB, or POL.** Single-user local runs only. |
| `PROMPTFUN_RPC_<CHAIN_KEY>` | public RPCs | Override an RPC, for example `PROMPTFUN_RPC_SOLANA_DEVNET` |
| `PROMPTFUN_INTENT_TTL_MS` | 900000 | Intent lifetime |
| `PROMPTFUN_MAX_INTENTS_PER_HOUR` | 120 | Global creation rate limit |
| `PROMPTFUN_KUBO_API_URL` | off | Kubo HTTP API (e.g. `http://127.0.0.1:5001`) for IPFS pins. Without it, dev uses in-memory CIDs plus `/api/img?cid=`. |
| `PROMPTFUN_IPFS_GATEWAY` | `https://ipfs.io/ipfs` | Public gateway prefix for metadata `image` URLs when not using the in-memory serve path. |
| `PROMPTFUN_IPFS_IMAGE_PATH` | `/api/img` | Set to `0` to omit the local image proxy from metadata JSON. |
| `PROMPTFUN_PICTURE_TTL_MS` | 86400000 | How long uploaded pictures stay in SQLite before purge. |

## Tests

```bash
npm run typecheck
npm test                          # unit tests, no network
solana-test-validator --reset &   # Agave CLI
anvil &                           # Foundry
npm run test:e2e                  # MCP client → tools → approval API → local chains (Solana and EVM)
npm run demo:devnet               # the real public devnet run (needs a funded devnet key; opens Chrome)
npm run demo:evm                  # browser run on anvil with the EIP-6963 test wallet
```

## Security

- The model is untrusted. It can only create an intent, and nothing moves without the user's wallet signature.
- The client is untrusted. The server checks the signed bytes against the preview and verifies every signature.
- The approval page runs with a strict CSP (no inline script, `frame-ancestors 'none'`), no cookies, and no third-party scripts. POSTs must be JSON and come from the same origin.
- Mainnets are off by default.
- Launches can't use promptfun's name or a major token's symbol (SOL, USDC, ETH, …).
- Intent ids are 128-bit random capabilities. Anyone holding an approval link can only spend their *own* funds by approving it.

## Not done yet

- Public Ethereum Sepolia and Base Sepolia runs. They need testnet ETH for the demo key on those networks.
- OAuth, pump.fun sponsored mainnet, remote KMS signer (local signer is dev/test only).
- OAuth, which is required before mainnets go on a shared server.
- WalletConnect (mobile) and passkeys.
- A run with Phantom or MetaMask themselves, which needs a human with the extension.
- Listing in the public ChatGPT app directory, which OpenAI's policy blocks. See the connection guide.

## Layout

```
src/
  app.ts, http.ts, stdio.ts   HTTP server (/mcp, approval page and API), entry points
  mcp/                        MCP server, tools, intent card, result text
  intents/                    intent service, SQLite store, types
  chains/                     registry, adapter interface
    solana/                   adapter, byte decoder, pump.fun builder
    evm/                      chain list, adapter, call decoder, token compiler
  web/page.ts                 server-rendered approval page
contracts/                    PromptfunToken.sol (fixed-supply ERC-20 on OpenZeppelin)
public/                       approve.js (Wallet Standard and EIP-6963), approve.css, fonts (OFL)
scripts/                      demo drivers; Wallet Standard and EIP-6963 test wallets
test/unit, test/e2e
```
