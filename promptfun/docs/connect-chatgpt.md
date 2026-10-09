# Connect promptfun.fun to ChatGPT

promptfun is a standard MCP server (Streamable HTTP at `/mcp`) with an MCP Apps card. ChatGPT is the primary host. Claude works the same way (see the end).

**Status:** promptfun has **not yet been run inside ChatGPT**, because we don't have a Business, Enterprise, or Edu plan yet (see "Before you start"). Everything below up to ChatGPT itself was run on 2026-10-09:

- The server behind a public HTTPS tunnel.
- The official MCP Inspector calling the tools over HTTPS.
- A full devnet launch and two transfers, approved through the public approval page.

## Before you start

| Requirement | Why |
|---|---|
| ChatGPT **Business, Enterprise, or Edu**, on **web** | Write tools (`prepare_*`) in a custom MCP app are a beta for these plans only. On Business, only admins and owners can turn on developer mode. On Enterprise and Edu it's role-based. Pro gets read and fetch tools only. Not available on mobile. ([OpenAI help](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt)) |
| A **public HTTPS** URL | ChatGPT connects from OpenAI's servers and can't reach `localhost`. |
| A desktop browser with Phantom, Solflare, or Backpack, set to **devnet** | The user signs on promptfun's approval page in their own wallet, never inside ChatGPT. |
| Private workspace use | OpenAI's [plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines) prohibit "execution of money transfers, crypto transfers, or investment trades" and speculative crypto offerings. promptfun can't be listed in the public app directory; it's only for your own workspace. |

## 1. Run the server on a public HTTPS URL

`PROMPTFUN_PUBLIC_URL` must be the exact public origin. It's used for approval links and as the only non-local `Host` that `/mcp` accepts.

**Quick test (temporary tunnel):**

```bash
cd promptfun && npm ci && npm run build
cloudflared tunnel --no-autoupdate --url http://127.0.0.1:8787    # prints https://<random>.trycloudflare.com
PROMPTFUN_PUBLIC_URL=https://<random>.trycloudflare.com npm start
```

**Hosted:** run `npm start` with `HOST=0.0.0.0`, `PORT`, and `PROMPTFUN_PUBLIC_URL=https://your-domain`, behind TLS. Put `PROMPTFUN_DB` on a persistent disk. Leave every mainnet flag off on a shared server until OAuth lands.

Check it from your machine before involving ChatGPT:

```bash
npx @modelcontextprotocol/inspector --cli https://your-domain/mcp --transport http --method tools/list
npx @modelcontextprotocol/inspector --cli https://your-domain/mcp --transport http \
  --method tools/call --tool-name get_capabilities
```

You should see five tools. `prepare_launch`, `prepare_transfer`, and `get_action_status` should carry `_meta.ui.resourceUri = ui://promptfun/intent-card-v1.html`.

## 2. Add it in ChatGPT

These steps follow OpenAI's [developer mode help article](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt) and [Connect from ChatGPT](https://developers.openai.com/apps-sdk/deploy/connect-chatgpt), both as of 2026-10-09.

1. **Turn on developer mode.**
   - **Business:** only admins and owners can use it, and each one turns it on for themselves: User settings → Apps → Advanced settings → Developer mode. Or switch it on while creating the app.
   - **Enterprise and Edu:** an admin grants access in Workspace settings → Permissions & Roles → Connected Data. The user then turns it on in Settings → Apps → Advanced settings.
2. **Create the app.** Go to Workspace settings → Apps → **Create**, or as an authorized user, Settings → Apps → Create. The Apps SDK docs also describe chatgpt.com/plugins → **+** → Add custom MCP server. Fill in:
   - **Name:** promptfun.fun
   - **URL:** `https://your-domain/mcp`
   - **Authentication:** none. promptfun has no OAuth yet. It holds no keys and moves nothing on its own, but treat the URL as private.
3. Click **Scan Tools**, wait for the five tools, then click **Create**. The app appears as a draft labelled **Dev**, under Settings → Apps → Enabled Apps.
4. **Publish (optional).** An admin or owner goes to Workspace settings → Apps → Drafts → **Publish** and reviews the write-action warnings. ChatGPT then uses a *frozen snapshot* of the tools: **after any tool or schema change, an admin must refresh the tool list** in workspace app settings. Until then, calls can fail with no prompt to update.

> **Risk:** OpenAI says ChatGPT asks for confirmation on write actions based on permissions and context, and that "some especially risky actions may be blocked instead of being presented for approval". `prepare_*` moves nothing, since signing happens on our page, but we don't yet know whether ChatGPT treats it as risky. This is the first thing to check once a plan is available.

## 3. Use it

In a chat, pick promptfun from the tools menu (or mention it), then ask, for example:

> Launch a token called Test Moon, symbol TMOON, 1,000,000 supply on Solana devnet.

What should happen:

1. ChatGPT calls `prepare_launch`. It may ask you to confirm first, since this is a write tool.
2. The promptfun card appears in the chat, showing the action and "Awaiting your wallet".
3. Click **Review and sign** on the card. It opens `https://your-domain/approve/<id>` in a new tab.
4. On that page: connect your wallet, read the decoded steps and the network fee (paid to Solana, not promptfun), and approve in the wallet.
5. Back in ChatGPT, ask "is it done?". ChatGPT calls `get_action_status`, and the card shows the receipt read from the chain, with explorer links.

Then try:

> Send 1,000 of that token to `<address>` on Solana devnet.

## Troubleshooting

| Symptom | Cause |
|---|---|
| ChatGPT can't connect, or `/mcp` returns 403 | `PROMPTFUN_PUBLIC_URL` doesn't match the hostname ChatGPT uses (the Host check), or the URL is missing `/mcp`. |
| Approval links point at `127.0.0.1` | `PROMPTFUN_PUBLIC_URL` isn't set. |
| Tools are missing or outdated after an update | Click refresh in the app settings. For a published app, an admin must refresh it. |
| Only read tools work | The plan is Pro, or you're on mobile. Write tools need Business, Enterprise, or Edu on web. |
| No card, only text | The host didn't render the MCP App. The text result still contains the approval link. |
| "Approve in wallet" does nothing | The wallet extension is missing or locked, or set to the wrong network. Switch it to devnet. |

## Claude (secondary)

In claude.ai, go to Settings → Connectors → **Add custom connector** and enter the same `https://your-domain/mcp`, with no authentication. Claude also connects from Anthropic's cloud, so it needs the public URL too. For a local stdio setup in Claude Desktop, run `npm run start:stdio`. Its approval pages are served on `PROMPTFUN_PUBLIC_URL`, which defaults to `http://127.0.0.1:8787`.
