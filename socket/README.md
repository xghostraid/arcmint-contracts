# Socket

Read path, pictures, quotes, and a paused `launch_coin`. Coins, burns, pictures, and launch jobs live in a local SQLite file (no Postgres on this machine, no secrets). MCP exposes `ping`, `quote_launch`, `open_picture_panel`, `launch_coin`, `coin_status`, and `list_wallet_coins`.

`launch_coin` refuses while no launch key is configured or the balance cannot cover one launch. It does not send a mainnet transaction. This process does not create or store a signer.

A payout watcher runs once a minute. It would push creator fees once a coin has at least 0.003 SOL waiting. Each push is a ledger row: coin, amount, signature, and time. The live card’s unpaid figure is that ledger, not a separate balance. While the launch key is missing, the watcher writes nothing and does not call the network. There is no house token, so nothing is bought or burned.

The desk proves a Solana address with a signature over a nonce. It is not a custody wallet and not a ChatGPT login. The connector stays no sign-in. A wallet may launch 5 times an hour and 20 a day, inside the global cap of 30 an hour and 200 a day. `list_wallet_coins` returns that wallet’s coins, paid SOL, and its failed jobs only.

A new launch cannot use a name or ticker that impersonates Socket. There is no house token. Fee addresses have to be ordinary wallets. Public `/api/status` does not include signer balance or secret flags. `/api/ops` answers whether one launch can be paid, and it stays behind the cron secret. A low float raises “The float cannot cover one launch.”

```bash
npm start
npm test
```

Open http://127.0.0.1:4173. A local stand-in for the ChatGPT draft card is at /preview/draft. The live card is at /preview/live. The seeded desk is at /preview/desk.
