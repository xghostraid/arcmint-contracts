# Terminal

A self-hosted, single-user trading terminal for Solana. You hold your own keys. You can generate and group many wallets, buy and sell from many of them at once, move SOL between them, and launch a Pump.fun token with block-0 buys from your own wallets. Everything runs on your machine or a small VPS, and keys never leave it.

This covers **Phases 1 and 2** of the [build plan](#roadmap). It is tested on a local validator (with the devnet Pump.fun and PumpSwap programs cloned) and against mocks only. **Start on devnet or a local validator. Mainnet moves real money.**

## What's in Phase 1

| Area | What you can do |
|---|---|
| Vault | Create it with a passphrase or restore it from a recovery phrase. It auto-locks when idle. You can change the passphrase and reveal the recovery phrase (the passphrase is required, and the reveal is audited). |
| Wallets | Generate HD wallets (up to 500 at a time, path `m/44'/501'/i'/0'`, the same as Phantom). Import base58 keys, JSON keypairs, or a mnemonic. Groups, labels, archive, balances. Export keys (passphrase again, audited). |
| Trade | Buy (fixed SOL per wallet) or sell (a percentage of each wallet's balance) across selected wallets. Slippage, priority fee, and execution mode: parallel, sequential, or an atomic Jito bundle. Pump.fun bonding-curve coins trade directly. Graduated coins route through Jupiter on mainnet. |
| Treasury | **Distribute** from one wallet to many (a fixed amount each, or a total split evenly). **Sweep** many wallets into one (all but fees, optionally keeping a reserve). **Withdraw** a fixed amount to any address. |
| Launch | Pump.fun `create_v2` plus a dev buy, plus buys from your own bundle wallets (up to 18 with a lookup table, see Phase 2). The plan shows each wallet's tokens and share of supply before you send. On mainnet it is sent as one Jito bundle (atomic, same block). On devnet or a local validator the transactions go out sequentially. |
| Activity | An append-only log of every action (including key exports) with a live SSE feed. |

## What's in Phase 2

| Area | What you can do |
|---|---|
| Dashboard | Track any mint or PumpSwap pool address (your launches are tracked automatically). Trades are indexed from the chain by polling plus a WebSocket nudge. You get a market-cap candlestick chart (1m–1h) with volume, a live trade feed with your wallets labeled, holders with your combined share and the curve/pool marked, and PnL per wallet and per group (average cost, realized and unrealized). |
| Bots | **DCA** (buy a fixed SOL amount or sell a share of balance every interval, for N runs). **Limit** orders on market cap or price (buy or sell once when crossed, with optional expiry). **Counter-trade** (answer outside buys with sells and/or outside sells with buys, sized as a share of their trade, with a cooldown and a minimum token reserve per wallet; your own wallets' trades are never answered). **Snipe** on your own launches only (round-robin buys until a supply share or market cap target). Every bot has a SOL budget, all bots share a global rate cap, and a **kill switch** pauses everything at once. Each action is written down with a unique key before it is sent, so a crash or restart never repeats a trade. |
| PumpSwap | Direct buy/sell on PumpSwap pools on every network (no Jupiter needed): graduated Pump.fun coins use their canonical pool; other mints use the deepest pool found, or the pool you paste. Multi-wallet trades in parallel, sequential or bundle mode. |
| Lookup tables | Launches with more than 8 bundle wallets create an address lookup table first, so create + dev buy + 18 bundle buys fit in one 5-transaction Jito bundle. The table is deactivated right after the launch; reclaim its rent from **Launch history** once it has cooled down. |
| Telegram alerts | Outbound-only alerts for bot fills, failed transactions, low wallet balances, bot status changes and launches, each switchable in **Settings**. The bot never accepts commands. |

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
5. **Dashboard:** the launch opens here. Watch the chart, trades, holders and PnL fill in. **Trade →** takes you to the trade page.
6. **Trade:** buy or sell the new mint from any group.
7. **Bots:** create a DCA, limit, counter-trade or snipe bot with a budget. To run bots unattended, turn on **Settings → Keep unlocked**, because locking the vault stops them.
8. **Treasury → Sweep:** consolidate everything back into the treasury wallet.

On the devnet Pump.fun config, a new curve starts with 0.3 virtual SOL (mainnet uses 30), so it fills up with well under 1 SOL of buys. Use small amounts (around 0.01–0.05 SOL per wallet).

For development with hot reload, run `npm run dev -w server` (API on :8787) and `npm run dev -w web` (UI on :5173, which proxies `/api`).

## Devnet

```bash
TERMINAL_NETWORK=devnet npm start
```

The public devnet faucet is often rate-limited. In that case, fund one wallet from https://faucet.solana.com and distribute from it. Pump.fun and PumpSwap are deployed on devnet. Jupiter and Jito are not, so bundle mode falls back to sequential sends. Graduated coins trade directly on PumpSwap.

## Docker / VPS

```bash
cd terminal
cp .env.example .env        # choose network, RPC, caps
docker compose up -d --build
```

- Data (the SQLite database with encrypted keys) lives in the `terminal-data` volume. Back it up together with your recovery phrase.
- The port is published on `127.0.0.1` only. From your laptop, run `ssh -L 8787:127.0.0.1:8787 you@vps` and open http://127.0.0.1:8787.
- Optional TLS and basic auth: set `TERMINAL_DOMAIN` and `TERMINAL_BASIC_AUTH_HASH` in `.env`, then run `docker compose --profile proxy up -d`.
- After a restart the vault is locked until you unlock it in the UI, and bots stay paused until then. For bots that run 24/7, turn on **Settings → Keep unlocked**.

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
| `TERMINAL_BOT_MAX_ACTIONS_PER_MINUTE` | `30` | Shared by all bots; actions over the cap wait for the next tick |
| `TERMINAL_LOW_BALANCE_SOL` | `0.05` | Bot wallets below this raise a low-balance alert (at most hourly per wallet) |
| `TERMINAL_INGEST_POLL_SECONDS` | `10` | Trade indexing poll interval per tracked token |
| `TERMINAL_INGEST_BACKFILL` | `1000` | Signatures fetched when a token is first tracked |
| `TERMINAL_INGEST_WEBSOCKET` | `1` | `0` turns off the `logsSubscribe` nudge (polling only) |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | unset | Both set enables Telegram alerts |

### Telegram alerts

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy its token.
2. Send your bot any message, then open `https://api.telegram.org/bot<token>/getUpdates` and copy `message.chat.id`.
3. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`, restart, and press **Settings → Telegram alerts → Send test**.

Alerts are queued and sent in order. If Telegram is unreachable, the queue holds up to 50 messages and drops new ones beyond that; Settings shows the queued and dropped counts and the last error. Messages contain token symbols, SOL amounts and short addresses, never keys.

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
                                       │   └─ solana/       adapter, pack (≤1232 B, ≤64 ix trace), executor, jito, jupiter,
                                       │                    pumpfun, pumpswap, alt (lookup tables), events (trade decoding)
                                       ├─ market/           tokens, ingest (poll + logsSubscribe), trades/candles, holders
                                       ├─ strategies/       engine (intents, budgets, rate cap, kill switch), configs
                                       ├─ notify/           telegram (outbound queue)
                                       └─ services/         trade, treasury, launch, dashboard/PnL (+ activity log)
```

Adding EVM (Phase 4) means a `KeyFamily` for secp256k1, an EVM adapter and executor (viem, nonces, gas, private relays), and EVM venues. Wallet storage, groups, the vault and the API shapes stay the same.

## Tests

```bash
npm test             # unit + API tests (mocks only)
npm run validator    # in another shell
npm run test:e2e     # Phase 1 and Phase 2 end-to-end runs on the local validator (several minutes)
```

The Phase 1 run funds wallets, launches with bundle buys, trades from many wallets and sweeps. It checks that every launch wallet receives exactly the token amount the plan predicted and that sweeps leave the source wallets at 0 SOL.

The Phase 2 runs cover:
- An 18-wallet launch through a lookup table, in at most 5 transactions, with holdings matching the plan.
- Trade ingestion, holders and PnL against those holdings.
- Every bot type: a counter bot answering a second, outside terminal; DCA to completion; a limit sell firing; a snipe to target; the kill switch.
- Closing the lookup table.
- A PumpSwap pool created by an outside wallet: tracked by pool address, then bundle buys and parallel sells from many wallets.

## Limits

- **Bundle size.** A Solana transaction may run at most 64 instructions, counting inner (CPI) calls. A Pump.fun buy uses about 10 of them, and create + dev buy about 31. One 5-transaction Jito bundle therefore holds create, the dev buy and at most 18 bundle wallets, even with a lookup table. Without a table, the transaction size limit caps it at 8. Sequential mode is not limited by bundle size, but the launch form still caps the bundle at 18.
- **Lookup tables reveal the launch early.** A table can only be used once it is finalized (about 13 s on mainnet). It is created before the launch and lists the mint and wallet addresses, so they are on-chain a few seconds before the token exists. Use **never** in the launch form to avoid this, at the cost of the 8-wallet bundle cap. Rent (about 0.017 SOL for the 72-address table of an 18-wallet launch) comes back to the dev wallet when you reclaim the table, about 512 slots (~4 minutes) after deactivation.
- **Parallel mode quoting.** Parallel sends can land in any order. Each leg's minimum-out is therefore quoted as if every other leg landed first, the worst case, so large parallel trades need more slippage headroom than sequential or bundle mode.
- **Limit and bot prices.** Bots react to the indexed trade feed and to price checks every few seconds. They fill at the market price at that moment, not exactly at the trigger level.
- **Other venues.** Graduated coins without a PumpSwap pool route through Jupiter on mainnet only. Direct Raydium and Meteora venues come in Phase 3.
- **SDK upgrades.** Pump.fun program upgrades can break the instruction builders. The SDKs are pinned (`@pump-fun/pump-sdk` 4.2.0, `@pump-fun/pump-swap-sdk` 1.20.0), so re-run `npm run test:e2e` after bumping them.

## Roadmap

- **Phase 1 (done):** vault, wallets, multi-wallet trade, treasury, bundled Pump.fun launch, activity log.
- **Phase 2 (done):** dashboard, strategy engine (DCA, limit, counter-trade, own-launch snipe, budgets, kill switch), PumpSwap, lookup-table launches, Telegram alerts.
- **Phase 3:** direct Raydium and Meteora venues, multi-RPC broadcast, and token tools (transfer, close empty accounts, burn).
- **Phase 4:** EVM chains (Base, then BSC and Ethereum).
- **Phase 5:** hardening (encrypted backups, withdrawal allowlist, TOTP, optional separate signer process).
