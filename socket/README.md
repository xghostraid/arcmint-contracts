# Socket

Read path, pictures, and quotes. Coins, burns, and unattached pictures live in a local SQLite file (no Postgres on this machine, no secrets). MCP exposes `ping`, `quote_launch`, `open_picture_panel`, and `coin_status`. There is no launch tool.

Launches stay paused. This process does not create or store a signer.

```bash
npm start
npm test
```

Open http://127.0.0.1:4173. A local stand-in for the ChatGPT draft card is at /preview/draft.
