import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { BRAND, SHORT, VERSION } from "../brand.js";
import { adapterFor } from "../chains/index.js";
import { allChains } from "../chains/registry.js";
import type { IntentService } from "../intents/service.js";
import { IntentError } from "../intents/types.js";
import { CARD_URI, cardHtml } from "./card.js";
import { intentText, intentView } from "./view.js";

const INSTRUCTIONS = `${BRAND} turns a request into a token launch or transfer that the user approves in their own wallet. Nothing moves until they sign on the approval page; ${SHORT} never holds keys and never executes on its own. Call get_capabilities first for chains and their honest status. After prepare_*, give the user the approval link, then call get_action_status for the chain-read receipt. Never claim success before status is confirmed.`;

const LIMITATIONS = [
  "Today the user approves each action in their own wallet on the approval page. The host's tool approval (Claude's Allow, ChatGPT's confirm) approves the tool call, not a transaction.",
  "Sponsored launches, where promptfun pays and the user confirms in chat with no wallet, are designed but not built yet.",
  "No OAuth yet: the connector is no-sign-in. Mainnets stay off on shared servers until OAuth lands.",
  "Solana mainnet supports pump.fun launches only, behind PROMPTFUN_ENABLE_PUMPFUN_MAINNET=1, and promptfun has never broadcast one.",
  "EVM: Robinhood Chain Testnet is verified on its public network; Ethereum Sepolia, Base Sepolia and the other EVM testnets are configured but not yet run there. EVM mainnets are off.",
  "No image or IPFS upload: pass an existing metadata URL.",
  "Wallet support: Solana Wallet Standard wallets (Phantom, Solflare, Backpack) and EIP-6963 EVM wallets (MetaMask, Rabby, Coinbase Wallet) in a desktop browser.",
  "Fees shown are network fees only. promptfun charges no fee.",
];

/** How each host reaches this same /mcp endpoint. Both use standard MCP, Streamable HTTP and the MCP Apps card. */
const HOSTS = [
  {
    host: "claude",
    role: "primary",
    connect: "Custom connector: Customize → Connectors → Add custom connector, URL https://<promptfun-host>/mcp, Authentication: No sign in.",
    notes: [
      "Works on Claude Free (one custom connector), Pro, Max, Team and Enterprise, on web, desktop and mobile. Add it on web or desktop first; it then appears on mobile.",
      "Claude asks the user to Allow write tools (prepare_*) unless they chose Always allow. Read-only tools run without a prompt.",
      "The card renders inline. Opening the approval page shows Claude's external-link confirmation, which custom connectors always get.",
      "Claude allows 240 seconds per tool call; every promptfun tool returns in seconds.",
    ],
  },
  {
    host: "chatgpt",
    role: "secondary",
    connect: "Developer-mode custom app with the same URL and no authentication.",
    notes: [
      "Write tools in custom apps are a beta for ChatGPT Business, Enterprise and Edu on web. Pro gets read-only tools, and mobile isn't supported.",
      "The card opens the approval page with ui/open-link, falling back to window.openai.openExternal.",
    ],
  },
] as const;

type ToolResult = { content: Array<{ type: "text"; text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean };

function fail(err: unknown): ToolResult {
  const message = err instanceof IntentError ? err.message : `Something went wrong: ${(err as Error).message}`;
  return { content: [{ type: "text", text: `${message} Nothing was sent.` }], isError: true };
}

const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
// "ui/resourceUri" is the pre-2026 MCP Apps key some hosts still read; "openai/outputTemplate" is ChatGPT's alias.
const CARD_META = { ui: { resourceUri: CARD_URI }, "ui/resourceUri": CARD_URI, "openai/outputTemplate": CARD_URI };

// Models and clients often send amounts as JSON numbers; the decimal parser still validates the text.
const decimalInput = z.union([z.string(), z.number()]);
function decimalText(value: string | number): string {
  return typeof value === "number" ? value.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 }) : value;
}

export function buildServer(service: IntentService): McpServer {
  const config = service.config;
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
      const chains = allChains(config).map((c) => ({
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
        structuredContent: { version: VERSION, chains, limitations: LIMITATIONS, hosts: HOSTS, promptfunFee: "0" },
      };
    },
  );

  server.registerTool(
    "prepare_launch",
    {
      title: "Prepare a token launch",
      description: "Use this when the user wants to create a new token. Prepares it only: returns an approval link where the user reviews the exact transaction and network fee and signs in their own wallet. Solana devnet launches a Token-2022 SPL token whose full supply goes to the user's wallet. Nothing is sent by this call.",
      inputSchema: z.object({
        chain: z.string().describe("Chain key from get_capabilities, e.g. solana-devnet"),
        name: z.string().min(1).max(32),
        symbol: z.string().min(1).max(10),
        supply: decimalInput.optional().describe("Whole tokens, e.g. \"1000000\". Default 1000000000. pump.fun is always 1000000000."),
        decimals: z.number().int().min(0).max(18).optional().describe("Default 9 on Solana, 18 on EVM; pump.fun is 6."),
        description: z.string().max(280).optional(),
        metadataUri: z.string().max(200).optional().describe("Existing https:// or ipfs:// metadata JSON. Required for pump.fun."),
        fixedSupply: z.boolean().optional().describe("Revoke mint authority after minting. Default true."),
        venue: z.enum(["spl", "pumpfun", "erc20"]).optional(),
        idempotencyKey: z.string().max(64).optional(),
      }),
      annotations: WRITE,
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

  server.registerTool(
    "prepare_transfer",
    {
      title: "Prepare a transfer",
      description: "Use this when the user wants to send the native coin (e.g. SOL) or a token to an address. Prepares it only: returns an approval link where the user reviews the exact transaction and network fee and signs in their own wallet. Nothing is sent by this call.",
      inputSchema: z.object({
        chain: z.string().describe("Chain key from get_capabilities, e.g. solana-devnet"),
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
        return intentResult(intentId);
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
