# promptfun-site

The marketing site for **promptfun.fun**: say it in Claude, approve in chat, done. Claude is the main host, and it also works in ChatGPT.

It is one static page (`public/index.html`) with plain CSS and a few lines of JS. It has no build step, no dependencies, no third-party scripts, and no font CDN. The MCP server itself lives in `../promptfun/` and is a separate project.

```bash
cd promptfun-site
npm start   # http://127.0.0.1:4321
npm test    # content, accessibility and server checks
```

`server.js` is only for local preview. Any static host can serve `public/`. If you deploy it, send the same headers `server.js` sends (strict CSP, `frame-ancestors 'none'`, `no-referrer`).

## Look: Sunny pop

Bright and flat: cream paper with a dot grid, primary colors, 2.5px ink outlines and hard offset shadows. The palette is the `:root` block in `public/site.css`. Buttons use ink text on tomato because white on tomato fails WCAG AA, and `--red-text` is the darker red for small red text.

The flat illustrations are plain SVG files in `public/art/`, with colors written as attributes and no inline styles, scripts or external references, so they render under `style-src 'self'`. They are decorative, so every one is an `<img alt="">`. The meaning is always in the text next to them. `favicon.svg` doubles as the brand mark.

## Honest copy

The page only claims what works today. Status labels live in the HTML. Update them when a capability ships:

| Where | Today | Change when |
|---|---|---|
| Hero pill, footer | In testing · Solana first / Not live on mainnet yet | Solana mainnet opens |
| Hero fine print, How it works step 3, `#chains` "Launch with no wallet", `#fees` lede, Safety "We never ask for your keys", FAQ "Do I need a wallet?", "Is it live?", "What does it cost?", demo caption | Being built: approve in chat, and promptfun.fun pays the launch network fee so no wallet is needed | Walletless launches work end to end. Then also say where the new token goes (the FAQ promises this before it opens) |
| `#chains` Solana → Launch a token with your own wallet | Testing on devnet | Launches work on mainnet |
| `#chains` Solana → Launch on pump.fun | Coming soon | pump.fun launches work end to end (mainnet only) |
| `#chains` EVM chains, in order: Ethereum, Robinhood Chain, Base | Card "Coming next"; Ethereum "Coming next", the others "Coming soon" | Each chain works end to end. Move "Coming next" to the following chain when one ships |
| `#connect` link box | "Posted here at launch", Copy disabled | The public connector URL exists. Put it in `.link-slot`, enable the button, and wire copy in `site.js` |
| FAQ "What does it cost?" | promptfun.fun pricing not set | Pricing is decided |
| `#fees` Network fees table | Measured 9 Oct 2026 (gas from Etherscan and public RPCs, prices from CoinGecko) | Re-measure before launch or when prices move a lot. Keep the date and sources next to the numbers |
| Hero "Works on the Claude Free plan", `#connect` steps 2 and 3, FAQ "Which plans work?" (Claude) | Custom connectors work on Claude Free, Pro, Max, Team and Enterprise; Free allows one; Team and Enterprise need an Owner to add it first. Path: Customize → Connectors → + Add → Add custom connector (Claude Help Center, 9 Oct 2026) | Anthropic changes the plans or the menu path |
| Hero "Also works in ChatGPT", `#connect` "Also works in ChatGPT" box, FAQ "Which plans work?" (ChatGPT) | Write actions only on ChatGPT Business, Enterprise and Edu, on the web, after an admin turns on developer mode; Pro is read-only; no mobile (OpenAI Help Center, 9 Oct 2026) | OpenAI opens write actions to more plans or to mobile. Update every `data-chatgpt` block |

`npm test` enforces the rules:
- The brand is promptfun.fun.
- Claude is the main host: it is in the title, the descriptions and the headline, and every primary CTA (nav, hero, closer) says "Add to Claude". The Connect section gives the Claude steps first, as Anthropic's help center describes them, then ChatGPT.
- Every mention of ChatGPT sits inside an element marked `data-chatgpt`, and every such element carries the plan caveat (Business, Enterprise or Edu, on the web). ChatGPT appears nowhere else on the page, including the head.
- The headline is the in-chat flow. Every claim that you need no wallet or that promptfun.fun pays the fee sits next to a "being built" label, and bringing your own wallet stays offered as an option.
- The network-fee block keeps its date, sources and "not a promptfun.fun fee" wording.
- Every chain capability carries a status label, and nothing is marked live.
- The page has no fake transaction hashes or addresses, and no connector URL appears before launch.
- The hero demo is labelled as an illustration.
- Every image has alt text and a size, every file in `public/art/` is used, and every SVG is free of scripts, styles and external references.
- The page needs nothing the CSP blocks: no inline styles or scripts, and CSS loads only the local fonts.
- The palette's text and background pairs meet WCAG AA (4.5:1), and motion stops under `prefers-reduced-motion`.
