# Socket

Read path, pictures, quotes, and a paused `launch_coin`. Coins, burns, pictures, and launch jobs live in a local SQLite file (no Postgres on this machine, no secrets). MCP exposes `ping`, `quote_launch`, `open_picture_panel`, `launch_coin`, and `coin_status`.

`launch_coin` refuses while no launch key is configured or the balance cannot cover one launch. It does not send a mainnet transaction. This process does not create or store a signer.

A payout watcher runs once a minute. It would push creator fees once a coin has at least 0.003 SOL waiting. Each push is a ledger row: coin, amount, signature, and time. The live card’s unpaid figure is that ledger, not a separate balance. While the launch key is missing, the watcher writes nothing and does not call the network. There is no house token, so nothing is bought or burned.

```bash
npm start
npm test
```

Open http://127.0.0.1:4173. A local stand-in for the ChatGPT draft card is at /preview/draft. The live card is at /preview/live.
