# Socket

Read path only. Coins and burns live in a local SQLite file (no Postgres on this machine, no secrets). MCP exposes `ping` and `coin_status`. The site is the socket, the floor, a coin page, and the burn tape.

Launches stay paused. This process does not create or store a signer.

```bash
npm start
npm test
```

Open http://127.0.0.1:4173.
