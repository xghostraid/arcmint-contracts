# promptfun-site

The marketing site for **promptfun.fun**: say it in ChatGPT, approve in your wallet, done.

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
| FAQ "Is it live?", "What does it cost?" | Not yet / promptfun.fun pricing not set | Launch, and pricing is decided |
| `#fees` Network fees table | Measured 9 Oct 2026 (gas from Etherscan and public RPCs, prices from CoinGecko) | Re-measure before launch or when prices move a lot. Keep the date and sources next to the numbers |
| `#connect` step 2, FAQ "Which ChatGPT plans work?" | Custom MCP apps can take actions only on ChatGPT Business, Enterprise and Edu, on the web (OpenAI Help Center, 9 Oct 2026) | OpenAI opens full MCP to more plans or to mobile |

`npm test` enforces the rules: the brand is promptfun.fun, ChatGPT is the only AI assistant named anywhere in this folder (page text, title, meta and OG tags, alt and aria text, fonts, images and the server), the network-fee block keeps its date, sources and "not a promptfun.fun fee" wording, every chain capability carries a status label, nothing is marked live, the page has no fake transaction hashes or addresses, no connector URL appears before launch, and the hero demo is labelled as an illustration.
