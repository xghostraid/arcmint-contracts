# Terminal

A self-hosted, single-user trading terminal for Solana. You hold your own keys. You can generate and group many wallets, buy and sell from many of them at once, move SOL between them, and launch a Pump.fun token with block-0 buys from your own wallets. Everything runs on your machine or a small VPS, and keys never leave it.

This is **Phase 1** of the [build plan](#roadmap). It is tested on a local validator (with the devnet Pump.fun programs cloned) and against mocks only. **Start on devnet or a local validator. Mainnet moves real money.**

## What's in Phase 1

| Area | What you can do |
|---|---|
| Vault | Create it with a passphrase or restore it from a recovery phrase. It auto-locks when idle. You can change the passphrase and reveal the recovery phrase (the passphrase is required, and the reveal is audited). |
| Wallets | Generate HD wallets (up to 500 at a time, path `m/44'/501'/i'/0'`, the same as Phantom). Import base58 keys, JSON keypairs, or a mnemonic. Groups, labels, archive, balances. Export keys (passphrase again, audited). |
| Trade | Buy (fixed SOL per wallet) or sell (a percentage of each wallet's balance) across selected wallets. Slippage, priority fee, and execution mode: parallel, sequential, or an atomic Jito bundle. Pump.fun bonding-curve coins trade directly. Graduated coins route through Jupiter on mainnet. |
| Treasury | **Distribute** from one wallet to many (a fixed amount each, or a total split evenly). **Sweep** many wallets into one (all but fees, optionally keeping a reserve). **Withdraw** a fixed amount to any address. |
| Launch | Pump.fun `create_v2` plus a dev buy, plus buys from 1–15 of your own bundle wallets. The plan shows each wallet's tokens and share of supply before you send. On mainnet it is sent as one Jito bundle (atomic, same block). On devnet or a local validator the transactions go out sequentially. |
| Activity | An append-only log of every action (including key exports) with a live SSE feed. |

There is deliberately no wash trading or "generate activity", no aged-wallet marketplace, and no privacy funding or cashout. Treasury moves are ordinary on-chain transfers.

## Quick start (local validator, free SOL)

You need Node 22.13+ and the [Solana CLI](https://docs.anza.xyz/cli/install) (`solana-test-validator`).

```bash
cd terminal
npm install
npm run validator          # terminal 1: local validator with pump.fun cloned from devnet
npm run build
TERMINAL_NETWORK=local TERMINAL_MAX_SOL_PER_ACTION=50 npm start   # terminal 2
```

Open http://127.0.0.1:8787. Create the vault and save the recovery phrase. Then:

1. **Wallets:** add a few groups (for example `treasury`, `dev`, `bundle`) and generate wallets into them.
2. Select the treasury wallet and click **Airdrop (test SOL)**. This works on local and devnet only.
3. **Treasury → Distribute:** fund the dev and bundle wallets.
4. **Launch:** enter the name, symbol and metadata URI (or upload an image), then the dev wallet and bundle wallets. Click **Simulate plan**, check the allocation table, then click **Launch**.
5. **Trade:** buy or sell the new mint from any group.
6. **Treasury → Sweep:** consolidate everything back into the treasury wallet.

On the devnet Pump.fun config, a new curve starts with 0.3 virtual SOL (mainnet uses 30), so it fills up with well under 1 SOL of buys. Use small amounts (around 0.01–0.05 SOL per wallet).

For development with hot reload, run `npm run dev -w server` (API on :8787) and `npm run dev -w web` (UI on :5173, which proxies `/api`).

## Devnet

```bash
TERMINAL_NETWORK=devnet npm start
```

The public devnet faucet is often rate-limited. In that case, fund one wallet from https://faucet.solana.com and distribute from it. Pump.fun is deployed on devnet. Jupiter and Jito are not, so bundle mode falls back to sequential sends, and graduated coins can't be sold yet (a direct PumpSwap venue comes in Phase 2).

## Docker / VPS

```bash
cd terminal
cp .env.example .env        # choose network, RPC, caps
docker compose up -d --build
```

- Data (the SQLite database with encrypted keys) lives in the `terminal-data` volume. Back it up together with your recovery phrase.
- The port is published on `127.0.0.1` only. From your laptop, run `ssh -L 8787:127.0.0.1:8787 you@vps` and open http://127.0.0.1:8787.
- Optional TLS and basic auth: set `TERMINAL_DOMAIN` and `TERMINAL_BASIC_AUTH_HASH` in `.env`, then run `docker compose --profile proxy up -d`.
- After a restart the vault is locked until you unlock it in the UI. For bots that run 24/7 (Phase 2), turn on **Settings → Keep unlocked**.

## Configuration

All configuration is through environment variables (see `.env.example`):

| Variable | Default | Notes |
|---|---|---|
| `TERMINAL_NETWORK` | `devnet` | `local`, `devnet`, `mainnet` |
| `TERMINAL_ALLOW_MAINNET` | unset | Must be `1` for mainnet |
| `TERMINAL_RPC_URL` / `TERMINAL_WS_URL` | public RPC for the network | Use a dedicated RPC for real trading |
| `TERMINAL_MAX_SOL_PER_ACTION` | `5` | Hard cap per buy, launch or distribution (total across wallets) |
| `TERMINAL_AUTO_LOCK_MINUTES` | `30` | `0` disables auto-lock |
| `TERMINAL_PRIORITY_MICROLAMPORTS` | `100000` | Default compute-unit price |
| `TERMINAL_JITO_TIP_LAMPORTS` | `1000000` | Default Jito tip (0.001 SOL) |
| `TERMINAL_JITO_URL` | `https://mainnet.block-engine.jito.wtf` | A regional block engine works too |
| `TERMINAL_JUPITER_URL` | `https://lite-api.jup.ag/swap/v1` | |
| `TERMINAL_HOST` / `TERMINAL_PORT` | `127.0.0.1` / `8787` | The Docker image binds `0.0.0.0` inside the container |
| `TERMINAL_DATA_DIR` | `./data` | |

## Security model

- **Envelope encryption.** The passphrase goes through scrypt (N=2¹⁷, r=8, p=1) to produce a key-encryption key. That key wraps a random 256-bit data key. The data key encrypts the HD mnemonic and each wallet secret with AES-256-GCM, and each ciphertext is bound to its wallet address through the authenticated data. Only the data key is kept in memory, and only while the vault is unlocked. A secret is decrypted for one operation and its buffer is zeroed afterwards.
- **Sessions.** Unlocking issues a random bearer token. Locking, whether manual or automatic, wipes the data key and revokes every session.
- **Simulate before send.** If any required simulation fails, nothing is sent. Bundles simulate the first transaction (later ones depend on it) and check every wallet's balance against its planned spend.
- **Caps and gates.** There is a per-action SOL cap, and mainnet needs an explicit environment flag.
- **What it does not protect against.** It does not protect against a compromised host. Anyone with root on the box while the vault is unlocked can read keys from memory. Keep bot wallets small and sweep profits out regularly.

## Architecture

```
web/ (React + Vite)  ──REST + SSE──▶  server/ (Fastify, node:sqlite)
                                       ├─ vault.ts          envelope encryption, auto-lock
                                       ├─ wallets.ts        HD/import/groups/export, signer scope
                                       ├─ chains/
                                       │   ├─ registry.ts   solana-{local,devnet,mainnet}; base/bsc/ethereum planned
                                       │   ├─ families.ts   key formats per chain family (EVM slots in here)
                                       │   └─ solana/       adapter, pack (≤1232 B), executor, jito, jupiter, pumpfun, treasury
                                       └─ services/         trade, treasury, launch (+ activity log)
```

Adding EVM (Phase 4) means a `KeyFamily` for secp256k1, an EVM adapter and executor (viem, nonces, gas, private relays), and EVM venues. Wallet storage, groups, the vault and the API shapes stay the same.

## Tests

```bash
npm test             # unit + API tests (mocks only)
npm run validator    # in another shell
npm run test:e2e     # fund → bundled launch → multi-wallet buy/sell → sweep on the local validator
```

The end-to-end test checks that every launch wallet receives exactly the token amount the plan predicted, that sells and buys confirm, and that sweeps leave the source wallets at 0 SOL.

## Limits in Phase 1

- Without address lookup tables, two bundle buys fit in each transaction. One Jito bundle (5 transactions) therefore holds create, the dev buy, and up to 8 bundle wallets. Sequential mode supports all 15. Lookup tables come in Phase 2.
- Graduated (PumpSwap) coins route through Jupiter on mainnet only. Direct PumpSwap, Raydium and Meteora venues come in Phases 2 and 3.
- Pump.fun program upgrades can break the instruction builders. The SDK is pinned (`@pump-fun/pump-sdk` 4.2.0), so re-run `npm run test:e2e` after bumping it.

## Roadmap

- **Phase 2:** a live token dashboard (trade feed with your wallets labeled, holders, chart, PnL). A strategy engine with DCA, limit orders, a counter-trade bot and supply snipe on your own launch. Telegram alerts. A direct PumpSwap venue. Lookup tables for larger launch bundles.
- **Phase 3:** direct Raydium and Meteora venues, multi-RPC broadcast, and token tools (transfer, close empty accounts, burn).
- **Phase 4:** EVM chains (Base, then BSC and Ethereum).
- **Phase 5:** hardening (encrypted backups, withdrawal allowlist, TOTP, optional separate signer process).
