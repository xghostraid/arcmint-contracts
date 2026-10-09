# promptfun-site

The marketing site for **promptfun.fun**: say it in Claude, approve in your wallet, done. **Sunny pop lilac inclined (alt)** — lilac paper, purple CTAs, inclined hero mock. Claude-only copy.

## Run locally

```bash
cd promptfun-site
npm test
npm start
```

Open `http://127.0.0.1:4321/`. Subpages: `/docs`, `/explore`, `/terms`, `/privacy` (with or without a trailing slash).

## Deploy on Vercel

Set the project **Root Directory** to `promptfun-site`. Static files are served from `public/`; `vercel.json` rewrites extensionless routes (`/explore`, `/docs`, …) to each folder’s `index.html`, matching `server.js`. For local preview, use `npm start` (Node static server with the same path rules).

## Honest-copy rules (enforced in tests)

| Copy | Source of truth | When to update |
|---|---|---|
| Hero "Works on the Claude Free plan", `#connect` steps, FAQ "Which Claude plans work?" | Custom connectors on Claude Free, Pro, Max, Team and Enterprise; Free allows one (Claude Help Center, 9 Oct 2026) | Anthropic changes plans or menu paths |
| Network fee table | Measured 9 Oct 2026; sources linked in `#fees` | When re-measured or chains ship |
| Connector URL | Not published until launch | When `/mcp` is live on public HTTPS |
| Explore board | `GET /api/coins` on the MCP host (see project `internal/api-contract.md`) | When API shape changes |
| Terms / Privacy | Draft pages labelled "Draft · not legal advice" | After counsel review |

## Product copy

- Claude is the only host named on the site: title, meta, hero, CTAs and docs. ChatGPT is not mentioned.
- Primary flow in the hero demo: **Preview → Your wallet → Receipt**, matching the Sunny pop concept with Claude wording.
- Sponsored launch (no wallet, fee paid by promptfun.fun, approve in chat) is always labelled **Being built**.
