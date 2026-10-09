import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { BRAND, SHORT, VERSION } from "../brand.js";
import { adapterFor } from "../chains/index.js";
import { chainsForCapabilities, recommendedLaunchChainKey } from "../chains/registry.js";
import type { IntentService } from "../intents/service.js";
import type { CoinIndexService } from "../indexer/service.js";
import type { CoinDetail } from "../api/types.js";
import { IntentError } from "../intents/types.js";
import { CARD_URI, cardHtml } from "./card.js";
import { PICTURE_URI, pictureHtml } from "./picture.js";
import { sponsorBudgetSnapshot } from "../sponsor/budget.js";
import { intentText, intentView } from "./view.js";

const INSTRUCTIONS = `${BRAND} turns a request into a token launch or transfer. Solana mainnet pump.fun launches are live: the user approves on the approval page in their wallet (real SOL). On Solana devnet with sponsored launches enabled, prepare_launch can be read-only and confirm_launch sends with no wallet. ${SHORT} never holds user keys. Call get_capabilities first. After prepare_*, use the card or approval link, then get_action_status for the chain-read receipt. Never claim success before status is confirmed.`;

import type { Config } from "../config.js";

function limitations(config: Config): string[] {
  const mainnetLive = config.enablePumpfunMainnet;
  const sponsoredMainnet = config.enableSponsoredMainnet;
  return [
    mainnetLive
      ? "Solana mainnet (pump.fun) is live via wallet approval. Default chain: solana-mainnet. Real SOL is spent; the preview shows the fee before the user approves."
      : "Solana mainnet is off until PROMPTFUN_ENABLE_PUMPFUN_MAINNET=1.",
    sponsoredMainnet
      ? "Sponsored mainnet pump.fun: PROMPTFUN_ENABLE_SPONSORED_MAINNET=1 with a funded sponsor wallet (allowlisted pump.fun programs only). Otherwise mainnet launches require the user's wallet."
      : "Sponsored launches (no wallet) run on Solana testnets only when PROMPTFUN_ENABLE_SPONSORED_LAUNCHES=1 and a sponsor key is set. SPL is default on devnet; pump.fun on devnet needs PROMPTFUN_ENABLE_PUMPFUN_DEVNET=1. Mainnet pump.fun without a wallet needs PROMPTFUN_ENABLE_SPONSORED_MAINNET=1 and mainnet SOL on the sponsor pubkey.",
    "Wallet path: the user approves each action on the approval page. Claude's Allow on a write tool approves the tool call, not a transaction.",
    config.oauthRequired
      ? "OAuth required: Claude must sign in (Bearer token on /mcp)."
      : config.oauthEnabled
        ? "OAuth is available but optional; set PROMPTFUN_OAUTH_REQUIRED=1 on shared servers."
        : "No OAuth yet: the connector is no-sign-in on this host.",
    "Solana mainnet supports pump.fun launches only (1B supply, 6 decimals). Transfers on mainnet are not supported.",
    "EVM: Robinhood Chain Testnet is verified on its public network; Ethereum Sepolia, Base Sepolia and the other EVM testnets are configured but not yet run there. EVM mainnets are off.",
    "Coin images: never paste or retype base64. Use open_picture_panel (Choose image → Save to promptfun), import_picture_from_url with the user's HTTPS attachment link, or prepare_launch with imageUrl. The panel uploads raw JPEG/PNG to /api/pictures/upload (max 15 MB). save_picture is panel-internal only.",
    "Wallet support: Solana Wallet Standard wallets (Phantom, Solflare, Backpack) on mainnet or devnet, and EIP-6963 EVM wallets (MetaMask, Rabby, Coinbase Wallet) in a desktop browser.",
    "Fees shown are network fees only. promptfun charges no fee.",
  ];
}

/** v1 targets Claude custom connectors; same Streamable HTTP / MCP Apps card at /mcp. */
function hosts(config: Config) {
  return [
    {
      host: "claude",
      role: "primary" as const,
      connect: config.oauthRequired
        ? "Custom connector: Add https://<promptfun-host>/mcp with OAuth (PKCE). Metadata at /.well-known/oauth-protected-resource."
        : "Custom connector: Customize → Connectors → Add custom connector, URL https://<promptfun-host>/mcp, Authentication: No sign in.",
      notes: [
        "Works on Claude Free (one custom connector), Pro, Max, Team and Enterprise, on web, desktop and mobile. Add it on web or desktop first; it then appears on mobile.",
        "prepare_launch is read-only; sponsored sends use confirm_launch from the in-chat card. prepare_transfer still opens the approval page.",
        "The card renders inline. Opening the approval page shows Claude's external-link confirmation, which custom connectors always get.",
        "Claude allows 240 seconds per tool call; every promptfun tool returns in seconds.",
      ],
    },
  ];
}

type ToolResult = { content: Array<{ type: "text"; text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean };

function fail(err: unknown): ToolResult {
  const message = err instanceof IntentError ? err.message : `Something went wrong: ${(err as Error).message}`;
  return { content: [{ type: "text", text: `${message} Nothing was sent.` }], isError: true };
}

const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
// "ui/resourceUri" is the pre-2026 MCP Apps key some hosts still read; "openai/outputTemplate" is ChatGPT's alias.
const CARD_META = { ui: { resourceUri: CARD_URI }, "ui/resourceUri": CARD_URI, "openai/outputTemplate": CARD_URI };
const PICTURE_META = { ui: { resourceUri: PICTURE_URI }, "ui/resourceUri": PICTURE_URI, "openai/outputTemplate": PICTURE_URI };
const APP_ONLY = { "ui/visibility": "app" } as const;

// Models and clients often send amounts as JSON numbers; the decimal parser still validates the text.
const decimalInput = z.union([z.string(), z.number()]);
function decimalText(value: string | number): string {
  return typeof value === "number" ? value.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 }) : value;
}

export function buildServer(service: IntentService, coins?: CoinIndexService): McpServer {
  const config = service.config;
  const LIMITATIONS = limitations(config);
  const HOSTS = hosts(config);
  const server = new McpServer({ name: SHORT, title: BRAND, version: VERSION }, { instructions: INSTRUCTIONS });

  const view = (id: string) => {
    const intent = service.get(id);
    return intentView(config, intent, service.approveUrl(intent.id));
  };
  const intentResult = (id: string): ToolResult => {
    const v = view(id);
    return { content: [{ type: "text", text: intentText(v) }], structuredContent: v as unknown as Record<string, unknown> };
  };

  server.registerResource(
    "picture-panel",
    PICTURE_URI,
    { title: `${BRAND} coin picture`, mimeType: "text/html;profile=mcp-app" },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: "text/html;profile=mcp-app",
        text: pictureHtml(config.publicUrl),
        _meta: {
          ui: { prefersBorder: true, csp: { connectDomains: [new URL(config.publicUrl).origin], resourceDomains: [new URL(config.publicUrl).origin] } },
          "openai/widgetDescription": "Upload a coin image (JPEG/PNG, max 15 MB). EXIF is stripped; the image is pinned for pump.fun metadata.",
          "openai/widgetCSP": { connect_domains: [new URL(config.publicUrl).origin], resource_domains: [new URL(config.publicUrl).origin], redirect_domains: [] },
        },
      }],
    }),
  );

  server.registerResource(
    "intent-card",
    CARD_URI,
    { title: `${BRAND} action card`, mimeType: "text/html;profile=mcp-app" },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: "text/html;profile=mcp-app",
        text: cardHtml(),
        _meta: {
          ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } },
          "openai/widgetDescription": "Shows the prepared action, the decoded transaction, the network fee, and status, with a button to approve in the user's wallet.",
          "openai/widgetCSP": { connect_domains: [], resource_domains: [], redirect_domains: [new URL(config.publicUrl).origin] },
        },
      }],
    }),
  );

  server.registerTool(
    "get_capabilities",
    {
      title: "What promptfun can do",
      description: "Use this first. Lists chains, which actions each supports, and each chain's honest status: verified (proven end to end), configured (wired, not yet proven), or gated (real money behind a flag). Also lists known limitations.",
      inputSchema: z.object({}),
      annotations: READ,
    },
    async () => {
      const chains = chainsForCapabilities(config).map((c) => ({
        key: c.key,
        name: c.name,
        family: c.family,
        testnet: c.testnet,
        status: c.status,
        enabled: !c.disabledReason,
        disabledReason: c.disabledReason ?? null,
        actions: c.actions,
        evidence: c.evidence,
        ...(c.family === "evm" ? { chainId: c.chainId, priority: c.priority } : { launchVenues: c.launchVenues }),
      }));
      const lines = chains.map((c) => `- ${c.key} (${c.name}): ${c.status}${c.enabled ? "" : ` — off: ${c.disabledReason}`}`);
      return {
        content: [{
          type: "text",
          text: [
            `${BRAND} ${VERSION}. Chains:`, ...lines,
            "Limitations:", ...LIMITATIONS.map((l) => `- ${l}`),
            "Hosts:", ...HOSTS.map((h) => `- ${h.host} (${h.role}): ${h.connect} ${h.notes.join(" ")}`),
          ].join("\n"),
        }],
        structuredContent: {
          version: VERSION,
          recommendedLaunchChain: recommendedLaunchChainKey(config),
          chains,
          limitations: LIMITATIONS,
          hosts: HOSTS,
          promptfunFee: "0",
          sponsoredLaunches: sponsorBudgetSnapshot(config),
          sponsorPublicKey: service.sponsorPublicKey?.() ?? null,
          claimWalletUrl: service.claimWalletUrl(),
        },
      };
    },
  );

  server.registerTool(
    "get_claim_wallet",
    {
      title: "Claim-later creator wallet",
      description: "Read-only. Returns the user's Solana payout wallet for locked pump.fun creator fees when OAuth and Privy are configured. Signed-in MCP callers get their wallet; unsigned callers get the /claim page URL.",
      inputSchema: z.object({}),
      annotations: READ,
    },
    async () => {
      try {
        const claimUrl = service.claimWalletUrl();
        const wallet = await service.resolveClaimWallet();
        if (wallet) {
          return {
            content: [{
              type: "text",
              text: `Creator fees lock to your Solana wallet ${wallet.solanaAddress}. Manage or export it at ${claimUrl}.`,
            }],
            structuredContent: wallet as unknown as Record<string, unknown>,
          };
        }
        return {
          content: [{
            type: "text",
            text: service.callerIdentity()
              ? "Claim wallets are not configured on this server (Privy credentials missing)."
              : `Sign in via OAuth, then call again—or open ${claimUrl} with the same email you use in Claude.`,
          }],
          structuredContent: { claimUrl, privyConfigured: false, signedIn: Boolean(service.callerIdentity()) },
        };
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "open_picture_panel",
    {
      title: "Upload a coin picture",
      description:
        "Use when the user needs a coin image before launch. Opens the in-chat picture panel. The user chooses JPEG/PNG (max 15 MB) and taps Save to promptfun, or taps Use this image when imageUrl is set from a chat attachment. Returns pictureId for prepare_launch. Do not call save_picture or paste base64 yourself.",
      inputSchema: z.object({
        imageUrl: z
          .string()
          .max(2000)
          .optional()
          .describe("Optional https:// link to an image the user attached in chat (pass the URL only — never download or base64-encode it yourself)."),
      }),
      annotations: READ,
      _meta: PICTURE_META,
    },
    async ({ imageUrl }) => {
      const url = (imageUrl ?? "").trim();
      const hint = url
        ? "The picture panel is open. Tap Use this image to import the chat attachment, or Choose image to pick a file, then Save to promptfun."
        : "The picture panel is open. Choose a JPEG or PNG (max 15 MB), save it, then use the returned pictureId in prepare_launch or build_metadata_uri.";
      return {
        content: [{ type: "text", text: hint }],
        structuredContent: { picturePanelUri: PICTURE_URI, ...(url ? { sourceImageUrl: url } : {}) },
      };
    },
  );

  server.registerTool(
    "import_picture_from_url",
    {
      title: "Import coin picture from URL",
      description:
        "Use when the user attached an image in chat or gave an https:// image link. Downloads JPEG/PNG server-side (max 15 MB) and returns pictureId. Prefer this over save_picture or manual base64. You can also pass imageUrl on prepare_launch instead.",
      inputSchema: z.object({
        imageUrl: z.string().max(2000).describe("Public https:// URL to a JPEG or PNG (e.g. Claude attachment CDN link)."),
      }),
      annotations: WRITE,
    },
    async ({ imageUrl }) => {
      try {
        const saved = await service.pictures.saveFromUrl(imageUrl.trim());
        const cidNote = saved.imageCid ? ` imageCid ${saved.imageCid}.` : "";
        return {
          content: [{ type: "text", text: `Saved picture ${saved.pictureId} (${saved.bytes} bytes, ${saved.mime}).${cidNote} Use pictureId in prepare_launch or build_metadata_uri.` }],
          structuredContent: saved,
        };
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "save_picture",
    {
      title: "Save picture (panel only)",
      description:
        "Internal: the picture panel uploads bytes via /api/pictures/upload. Host models must not call this with base64 — use open_picture_panel, import_picture_from_url, or prepare_launch imageUrl instead.",
      inputSchema: z.object({
        imageBase64: z.string().max(22_000_000).describe("Legacy panel fallback only. Host models: do not use."),
      }),
      annotations: WRITE,
      _meta: APP_ONLY,
    },
    async ({ imageBase64 }) => {
      try {
        if (imageBase64.length > 120_000) {
          return fail(new IntentError(
            "Image is too large for base64 in JSON. Call open_picture_panel (Choose image → Save) or import_picture_from_url with the user's https:// image link.",
            "bad_request",
          ));
        }
        const saved = await service.pictures.saveFromBase64(imageBase64);
        const cidNote = saved.imageCid ? ` imageCid ${saved.imageCid}.` : "";
        return {
          content: [{ type: "text", text: `Saved picture ${saved.pictureId} (${saved.bytes} bytes, ${saved.mime}).${cidNote} Use pictureId in build_metadata_uri or prepare_launch.` }],
          structuredContent: saved,
        };
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "build_metadata_uri",
    {
      title: "Build pump.fun metadata URI",
      description: "Pins the saved picture and a pump.fun-style metadata JSON to IPFS and returns metadataUri (ipfs://…, max 200 chars). Use before prepare_launch when you already have pictureId.",
      inputSchema: z.object({
        pictureId: z.string().regex(/^pic_[a-f0-9]{24}$/),
        name: z.string().min(1).max(32),
        symbol: z.string().min(1).max(10),
        description: z.string().max(400).optional(),
        website: z.string().max(200).optional().describe("https:// project site"),
        x: z.string().max(200).optional().describe("https:// X profile or post"),
      }),
      annotations: READ,
    },
    async (args) => {
      try {
        const result = await service.buildMetadataUri(args);
        return {
          content: [{ type: "text", text: `metadataUri: ${result.metadataUri} (image CID ${result.imageCid}).` }],
          structuredContent: result,
        };
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "prepare_launch",
    {
      title: "Prepare a token launch",
      description: "Use when the user wants to create a new token. Read-only: simulates and returns the card. On sponsored Solana testnets (SPL, not pump.fun) the card shows Launch it and confirm_launch sends with promptfun paying the network fee. Otherwise the user opens approveUrl and signs in their wallet. Nothing is broadcast by this call.",
      inputSchema: z.object({
        chain: z.string().describe("Chain key from get_capabilities, e.g. solana-mainnet for pump.fun"),
        name: z.string().min(1).max(32),
        symbol: z.string().min(1).max(10),
        supply: decimalInput.optional().describe("Whole tokens, e.g. \"1000000\". Default 1000000000. pump.fun is always 1000000000."),
        decimals: z.number().int().min(0).max(18).optional().describe("Default 9 on Solana, 18 on EVM; pump.fun is 6."),
        description: z.string().max(400).optional(),
        metadataUri: z.string().max(200).optional().describe("Existing https:// or ipfs:// metadata JSON. Omit when pictureId is set."),
        pictureId: z.string().regex(/^pic_[a-f0-9]{24}$/).optional().describe("From open_picture_panel / import_picture_from_url; builds metadata when metadataUri is omitted."),
        imageUrl: z
          .string()
          .max(2000)
          .optional()
          .describe("https:// JPEG/PNG link (e.g. chat attachment). Server imports it; do not pass base64."),
        website: z.string().max(200).optional().describe("https:// site for metadata JSON"),
        x: z.string().max(200).optional().describe("https:// X link for metadata JSON (twitter field)"),
        fixedSupply: z.boolean().optional().describe("Revoke mint authority after minting. Default true."),
        venue: z.enum(["spl", "pumpfun", "erc20"]).optional(),
        creatorWallet: z.string().max(64).optional().describe("Solana wallet for locked pump.fun creator fees on sponsored launches. Omit when the user is signed in to use their claim-later Privy wallet, or the sponsor fee recipient when not."),
        idempotencyKey: z.string().max(64).optional(),
      }),
      annotations: READ,
      _meta: CARD_META,
    },
    async (args) => {
      try {
        const intent = await service.prepareLaunch({ ...args, supply: args.supply === undefined ? undefined : decimalText(args.supply) });
        return intentResult(intent.id);
      } catch (err) {
        return fail(err);
      }
    },
  );

  const confirmLaunchHandler = async ({ intentId }: { intentId: string }): Promise<ToolResult> => {
    try {
      const intent = await service.confirmLaunch(intentId);
      return intentResult(intent.id);
    } catch (err) {
      return fail(err);
    }
  };

  server.registerTool(
    "confirm_launch",
    {
      title: "Confirm a sponsored launch",
      description: "Called from the in-chat card (Launch it) after prepare_launch when promptfun pays. Signs with the sponsor fee payer and submits. Do not call unless the user confirmed on the card.",
      inputSchema: z.object({ intentId: z.string() }),
      annotations: WRITE,
      _meta: { ...CARD_META, "ui/visibility": "app" },
    },
    confirmLaunchHandler,
  );

  server.registerTool(
    "confirm_launch_by_text",
    {
      title: "Confirm a sponsored launch (text)",
      description: "Same as confirm_launch for hosts and tests that cannot invoke app-only tools from the card iframe.",
      inputSchema: z.object({ intentId: z.string() }),
      annotations: WRITE,
    },
    confirmLaunchHandler,
  );

  server.registerTool(
    "prepare_transfer",
    {
      title: "Prepare a transfer",
      description: "Use this when the user wants to send the native coin (e.g. SOL) or a token to an address. Prepares it only: returns an approval link where the user reviews the exact transaction and network fee and signs in their own wallet. Nothing is sent by this call.",
      inputSchema: z.object({
        chain: z.string().describe("Chain key from get_capabilities, e.g. solana-mainnet for pump.fun"),
        asset: z.string().describe('"native" for SOL/ETH, a listed symbol, or a token mint/contract address'),
        amount: decimalInput.describe("Amount in whole units, e.g. \"0.01\""),
        to: z.string().describe("Recipient wallet address"),
        idempotencyKey: z.string().max(64).optional(),
      }),
      annotations: WRITE,
      _meta: CARD_META,
    },
    async (args) => {
      try {
        const intent = await service.prepareTransfer({ ...args, amount: decimalText(args.amount) });
        return intentResult(intent.id);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "get_action_status",
    {
      title: "Check an action",
      description: "Use this after prepare_* to see whether the user approved and what happened on chain. A confirmed status includes a receipt read from the chain and explorer links. Never report success unless status is confirmed.",
      inputSchema: z.object({ intentId: z.string() }),
      annotations: READ,
      _meta: CARD_META,
    },
    async ({ intentId }) => {
      try {
        await service.refresh(intentId);
        const v = view(intentId);
        const intent = service.get(intentId);
        let structured = v as unknown as Record<string, unknown>;
        if (intent.status === "confirmed" && intent.kind === "launch_token" && coins) {
          coins.syncIntents();
          const detail = coins.findByIntentOrAddress(intentId) ?? (intent.receipt?.tokenAddress ? coins.findByIntentOrAddress(intent.receipt.tokenAddress, intent.chain) : null);
          if (detail) {
            structured = { ...structured, coin: detail };
            const lines = [
              intentText(v),
              detail.links.explorer ? `Explorer: ${detail.links.explorer}` : null,
              detail.links.launchTx ? `Launch tx: ${detail.links.launchTx}` : null,
              `Share on X: ${detail.share.intentUrl}`,
            ].filter(Boolean);
            return { content: [{ type: "text", text: lines.join("\n") }], structuredContent: structured };
          }
        }
        return { content: [{ type: "text", text: intentText(v) }], structuredContent: structured };
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "coin_status",
    {
      title: "Coin index status",
      description: "Read-only status for a coin promptfun launched: live market snapshot, holders, creator fees, and share text. Input is a coin id (chain:address), token address, or launch intent id.",
      inputSchema: z.object({
        coin: z.string().describe("Coin id, mint/contract address, or launch intent id"),
        chain: z.string().optional().describe("Disambiguate when the same address exists on multiple chains"),
      }),
      annotations: READ,
    },
    async ({ coin, chain }) => {
      try {
        if (!coins) throw new IntentError("Coin index is not available.");
        coins.syncIntents();
        const detail: CoinDetail | null = coins.findByIntentOrAddress(coin, chain);
        if (!detail) throw new IntentError("No indexed coin matches that id.");
        const splitLine =
          detail.feeSplit.recipients?.length
            ? `Fee split (locked on chain): ${detail.feeSplit.recipients.map((r) => `${r.address.slice(0, 4)}…${r.address.slice(-4)} ${(r.shareBps / 100).toFixed(0)}%`).join(", ")}`
            : detail.feeSplit.reason;
        const feesLine =
          detail.creatorFees.waiting != null
            ? `Creator fees waiting: ${detail.creatorFees.waiting} ${detail.creatorFees.symbol}${detail.creatorFees.paid ? `; paid out so far: ${detail.creatorFees.paid} ${detail.creatorFees.symbol}` : ""}`
            : detail.creatorFees.reason;
        const text = [
          `${detail.name} ($${detail.symbol}) on ${detail.chain.name}`,
          detail.links.explorer ? `Explorer: ${detail.links.explorer}` : null,
          detail.links.pumpfun ? `pump.fun: ${detail.links.pumpfun}` : null,
          splitLine,
          feesLine,
          detail.market.reason && !detail.market.priceNative ? detail.market.reason : null,
          detail.holders.count !== null ? `Holders: ${detail.holders.exact ? detail.holders.count : `at least ${detail.holders.count}`}` : detail.holders.reason,
          `Share on X: ${detail.share.intentUrl}`,
        ].filter(Boolean).join("\n");
        return { content: [{ type: "text", text }], structuredContent: detail as unknown as Record<string, unknown> };
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "get_balance",
    {
      title: "Check a balance",
      description: "Use this to read a wallet's native or token balance on a chain, straight from the chain.",
      inputSchema: z.object({
        chain: z.string(),
        address: z.string(),
        token: z.string().optional().describe("Omit for the native coin; or a listed symbol / token address"),
      }),
      annotations: READ,
    },
    async ({ chain: key, address, token }) => {
      try {
        const chain = service.chainOrThrow(key);
        const adapter = adapterFor(chain.family);
        if (!adapter.isAddress(address)) throw new IntentError(`"${address}" is not a ${chain.name} address.`);
        const bal = await adapter.balance(chain, address, token ?? null);
        return {
          content: [{ type: "text", text: `${address} holds ${bal.amount} ${bal.symbol} on ${chain.name} (read from chain).` }],
          structuredContent: { chain: chain.key, address, amount: bal.amount, symbol: bal.symbol },
        };
      } catch (err) {
        return fail(err);
      }
    },
  );

  return server;
}
