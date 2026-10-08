# Socket

Read path, pictures, quotes, and a paused `launch_coin`. Coins, burns, pictures, and launch jobs live in a local SQLite file (no Postgres on this machine, no secrets). MCP exposes `ping`, `quote_launch`, `open_picture_panel`, `launch_coin`, and `coin_status`.

`launch_coin` refuses while no launch key is configured or the balance cannot cover one launch. It does not send a mainnet transaction. This process does not create or store a signer.

```bash
npm start
npm test
```

Open http://127.0.0.1:4173. A local stand-in for the ChatGPT draft card is at /preview/draft. The live card is at /preview/live.
