# promptfun-site

The marketing site for **promptfun.fun**: say it in Claude, approve in your wallet, done. **Sunny pop lilac inclined (alt)** — lilac paper, purple CTAs, inclined hero mock. Claude-only copy.

## Run locally

```bash
cd promptfun-site
npm test
npm start
```

Open `http://127.0.0.1:4321/`. Subpages: `/docs`, `/explore`, `/terms`, `/privacy` (with or without a trailing slash).

## Local preview (Mac)

If the browser shows a blank page or “can’t connect,” the dev server often is not running or port **4321** is already taken. Follow these steps exactly:

1. Clone the repo and check out the site branch:
   ```bash
   git clone https://github.com/xghostraid/arcmint-contracts.git
   cd arcmint-contracts
   git checkout cursor/promptfun-site-e1a9
   ```
2. Install and start the static server (keep this terminal open):
   ```bash
   cd promptfun-site
   npm install
   npm start
   ```
   You should see: `promptfun.fun site on http://127.0.0.1:4321`
3. **Before opening a browser**, confirm HTML is being served:
   ```bash
   curl -s http://127.0.0.1:4321/ | grep '<title>'
   ```
   Expected output includes:
   `<title>promptfun.fun · Say it in Claude. Approve in your wallet. Done.</title>`
4. Open [http://127.0.0.1:4321](http://127.0.0.1:4321) in your browser.

If `npm start` exits immediately with **Port 4321 in use**, free the port or use another:

```bash
lsof -ti :4321 | xargs kill -9
# or
PORT=8765 npm start
```

Then open `http://127.0.0.1:8765` (or re-run the `curl` check against that port).

## Deploy on Vercel

Set the project **Root Directory** to `promptfun-site`. Static files are served from `public/`; `vercel.json` rewrites extensionless routes (`/explore`, `/docs`, …) to each folder’s `index.html`, matching `server.js`.

**One Claude link (getplugged parity):** `vercel.json` also proxies `/mcp`, `/api/*`, `/oauth/*`, and `/.well-known/*` to the MCP host (`https://promptfun-mcp.fly.dev` by default — change those destinations to your MCP deployment before go-live). After deploy, the connector URL is `https://promptfun.fun/mcp` with Authentication: No sign-in (or OAuth when required).

For local preview, use `npm start` (Node static server with the same path rules). Live stats on `/` and `/explore` call `/api/stats` and `/api/coins` on the same origin; point `data-api-origin` at a running MCP server when testing counters locally.

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
