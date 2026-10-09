# promptfun-site

The marketing site for **promptfun.fun**: say it in Claude, approve in your wallet, done.

It is one static page (`public/index.html`) with plain CSS and a few lines of JS. It has no build step, no dependencies, no third-party scripts, and no font CDN. The MCP server itself lives in `../promptfun/` and is a separate project.

```bash
cd promptfun-site
npm start   # http://127.0.0.1:4321
npm test    # content and server checks
```

`server.js` is only for local preview. Any static host can serve `public/`. If you deploy it, send the same headers `server.js` sends (strict CSP, `frame-ancestors 'none'`, `no-referrer`).

## Honest copy

The page only claims what works today. Status labels live in the HTML. Update them when a capability ships:

| Where | Today | Change when |
|---|---|---|
| Hero pill, footer | In testing · Solana first / Not live on mainnet yet | Solana mainnet opens |
| `#chains` Solana → Launch a token | Testing on devnet | Launches work on mainnet |
| `#chains` Solana → Launch on pump.fun | Coming soon | pump.fun launches work end to end (mainnet only) |
| `#chains` EVM chains, in order: Ethereum, Robinhood Chain, Base | Card "Coming next"; Ethereum "Coming next", the others "Coming soon" | Each chain works end to end. Move "Coming next" to the following chain when one ships |
| `#connect` link box | "Posted here at launch", Copy disabled | The public connector URL exists. Put it in `.link-slot`, enable the button, and wire copy in `site.js` |
| FAQ "Is it live?", "What does it cost?" | Not yet / no promptfun fee published | Launch, and pricing is decided |

`npm test` enforces the rules: the brand is promptfun.fun, every chain capability carries a status label, nothing is marked live, the page has no fake transaction hashes or addresses, no connector URL appears before launch, and the hero demo is labelled as an illustration.
