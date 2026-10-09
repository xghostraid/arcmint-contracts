import { PING_TEXT } from "../shared/copy.js";
import { formatSol } from "../public/format.js";
import { getLiveCoin, latestLiveRow, toLiveView } from "./db.js";
import { proveWallet } from "./desk.js";
import { DRAFT_CARD_URI, renderDraftCard } from "./draft-card.js";
import { launchCoin } from "./launch.js";
import { LIVE_CARD_URI, renderLiveCard } from "./live-card.js";
import { IMAGE_URL_MAX_BYTES } from "./picture.js";
import { buildQuote, panelText, quoteText } from "./quote.js";

export const PROTOCOL = "2025-03-26";
const SUPPORTED = new Set(["2025-03-26", "2025-06-18", "2024-11-05"]);
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const DRAFT_FIELDS = {
  name: { type: "string", maxLength: 32, description: "Coin name, at most 32 characters." },
  ticker: {
    type: "string",
    maxLength: 10,
    pattern: "^[A-Za-z0-9]+$",
    description: "Ticker kept as typed. Letters and numbers only, at most 10.",
  },
  description: { type: "string", maxLength: 400, description: "Description, at most 400 characters." },
  x: { type: "string", description: "https URL on x.com or twitter.com." },
  website: { type: "string", description: "https website URL." },
  wallet: {
    type: "string",
    minLength: 32,
    maxLength: 44,
    description: "Solana address. 50% of creator fees lock to it.",
  },
  picture_id: {
    type: "string",
    description: "Id the draft card returns after upload, pic_ plus 16 hex characters. Do not invent one.",
  },
  image_url: {
    type: "string",
    description: `Direct https image URL, up to ${IMAGE_URL_MAX_BYTES} bytes, when the draft card iframe does not render. promptfun.fun does not fetch this URL.`,
  },
};

const DRAFT_SCHEMA = {
  type: "object",
  properties: DRAFT_FIELDS,
  additionalProperties: false,
};

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const CARD_META = { ui: { resourceUri: DRAFT_CARD_URI } };
const LIVE_META = { ui: { resourceUri: LIVE_CARD_URI } };

const LAUNCH_SCHEMA = {
  type: "object",
  properties: {
    ...DRAFT_FIELDS,
    idempotency_key: {
      type: "string",
      minLength: 8,
      maxLength: 128,
      description: "Optional key. The same key returns the same launch and does not create a second coin.",
    },
  },
  additionalProperties: false,
};

export const TOOLS = [
  {
    name: "ping",
    description: "Check that promptfun.fun is connected. Returns the fee split and that launches are paused. Does not launch a coin.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "quote_launch",
    description: "Read-only quote for a draft coin. Returns that launches are paused, the locked 50/50 split, whether a picture is present, and how many launches are left today and this hour. Does not launch and does not read a signer balance. If the draft card iframe does not render, pass image_url (https, up to 15 MB). Do not invent a picture_id.",
    inputSchema: DRAFT_SCHEMA,
    annotations: READ_ONLY,
    _meta: CARD_META,
  },
  {
    name: "open_picture_panel",
    description: "Open the draft card so the user can drop a PNG, JPEG, GIF, or WebP. The card shrinks it to 4,000,000 bytes and stores it for 24 hours. If this host does not show the iframe, ask for a direct https image URL up to 15 MB and pass it as image_url. Do not invent a picture_id. Does not launch a coin.",
    inputSchema: DRAFT_SCHEMA,
    annotations: READ_ONLY,
    _meta: CARD_META,
  },
  {
    name: "launch_coin",
    description: "Lock creator fees at 50% to the named wallet and 50% to the published recipient, then launch on pump.fun. Refuses when a launch key is missing or the balance cannot cover one launch, about 0.012 SOL, and the card says launches are paused. Does not return a signer balance. Does not send a mainnet transaction from this build. The same idempotency_key returns the same result. If the draft card does not render, pass image_url. Do not invent a picture_id.",
    inputSchema: LAUNCH_SCHEMA,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    _meta: CARD_META,
  },
  {
    name: "coin_status",
    description: "Read a coin promptfun.fun has confirmed. Pass the Solana mint as address. Returns the pump.fun link, the locked 50/50 creator-fee split, and SOL paid to the creator wallet.",
    inputSchema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description: "Solana mint (contract address) of the coin.",
          minLength: 32,
          maxLength: 44,
        },
      },
      required: ["address"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "list_wallet_coins",
    description: "Read coins whose locked creator-fee address is this wallet, the SOL paid to it, and failed launch jobs for that wallet only. Pass a nonce and a signature of that nonce. The signature proves the address. It is not a custody wallet and not a ChatGPT login. The connector stays no sign-in.",
    inputSchema: {
      type: "object",
      properties: {
        wallet: { type: "string", minLength: 32, maxLength: 44 },
        nonce: { type: "string", minLength: 16, maxLength: 128 },
        signature: { type: "string", minLength: 64, maxLength: 128 },
      },
      required: ["wallet", "nonce", "signature"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
];

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

export function coinStatusText(coin) {
  const wallet = coin.wallet || "no wallet stored";
  const recipient = coin.recipient || "the published recipient";
  const curve = coin.graduated ? "Graduated." : "Still on the curve.";
  return [
    `https://pump.fun/coin/${coin.mint}`,
    `${coin.name} (${coin.ticker}).`,
    `Creator fees are split 50/50: ${wallet} and ${recipient}, locked at launch. Paid to that wallet so far: ${formatSol(coin.paidToCreatorSol)} SOL.`,
    curve,
  ].join("\n");
}

function toolResult(text, isError = false) {
  const result = { content: [{ type: "text", text }] };
  if (isError) result.isError = true;
  return result;
}

function quoteToolResult(db, args, textFn) {
  const quote = buildQuote(db, args);
  return {
    content: [{ type: "text", text: textFn(quote) }],
    structuredContent: quote,
    _meta: CARD_META,
  };
}

function callTool(db, params) {
  const name = params?.name;
  const args = params?.arguments && typeof params.arguments === "object" ? params.arguments : {};
  if (name === "ping") return toolResult(PING_TEXT);
  if (name === "quote_launch") return quoteToolResult(db, args, quoteText);
  if (name === "open_picture_panel") return quoteToolResult(db, args, panelText);
  if (name === "coin_status") {
    const address = typeof args.address === "string" ? args.address.trim() : "";
    if (!BASE58.test(address)) {
      return toolResult("coin_status needs a Solana contract address (32–44 characters).", true);
    }
    const coin = getLiveCoin(db, address);
    if (!coin) {
      return toolResult(`${address} is not in promptfun.fun's book. The floor only lists coins this connector has confirmed.`);
    }
    return { ...toolResult(coinStatusText(coin)), _meta: LIVE_META };
  }
  if (name === "launch_coin") return launchCoin(db, args);
  if (name === "list_wallet_coins") {
    const proved = proveWallet(db, args);
    if (!proved.ok) return toolResult("That signature was rejected.", true);
    const { wallet, paidSol, coins, failed } = proved.desk;
    const lines = [
      `${wallet}`,
      `Paid to this wallet: ${paidSol} SOL.`,
      coins.length ? coins.map((coin) => `${coin.name} (${coin.ticker}) ${coin.mint} paid ${coin.paidToCreatorSol} SOL`).join("\n") : "No confirmed coins.",
      failed.length ? `Failed jobs: ${failed.map((job) => `${job.ticker} ${job.error}`).join(", ")}` : "No failed jobs.",
    ];
    return {
      content: [{ type: "text", text: lines.join("\n") }],
      structuredContent: proved.desk,
    };
  }
  return toolResult("Unknown tool.", true);
}

export function handleMcpMessage(db, message, options = {}) {
  const origin = typeof options.origin === "string" && options.origin ? options.origin : "http://127.0.0.1:4173";
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return { type: "error", status: 400, body: rpcError(null, -32600, "Invalid Request") };
  }
  const hasId = Object.prototype.hasOwnProperty.call(message, "id");
  const { id, method, params } = message;
  if (!hasId) return { type: "notification" };
  if (id === null || (typeof id !== "string" && typeof id !== "number")) {
    return { type: "error", status: 400, body: rpcError(null, -32600, "Invalid Request") };
  }
  if (typeof method !== "string") {
    return { type: "error", status: 400, body: rpcError(id, -32600, "Invalid Request") };
  }
  if (method === "notifications/initialized" || method === "notifications/cancelled") {
    return { type: "result", body: rpcResult(id, {}) };
  }
  if (method === "initialize") {
    const requested = params?.protocolVersion;
    const protocolVersion = SUPPORTED.has(requested) ? requested : PROTOCOL;
    return {
      type: "result",
      body: rpcResult(id, {
        protocolVersion,
        capabilities: {
          tools: { listChanged: false },
          resources: { listChanged: false },
        },
        serverInfo: { name: "promptfun.fun", version: "0.1.0" },
        instructions: `${PING_TEXT} Tools: ping, quote_launch, open_picture_panel, launch_coin, coin_status, list_wallet_coins. launch_coin refuses while launches are paused and does not send a transaction. list_wallet_coins needs a signature over a nonce. The connector stays no sign-in. If the draft card does not render, pass image_url.`,
      }),
    };
  }
  if (method === "ping") return { type: "result", body: rpcResult(id, {}) };
  if (method === "tools/list") return { type: "result", body: rpcResult(id, { tools: TOOLS }) };
  if (method === "tools/call") return { type: "result", body: rpcResult(id, callTool(db, params)) };
  if (method === "resources/list") {
    return {
      type: "result",
      body: rpcResult(id, {
        resources: [
          {
            uri: DRAFT_CARD_URI,
            name: "promptfun.fun draft card",
            description: "Draft coin card. Picture, name, ticker, and the locked 50/50 fee split. Launches stay paused.",
            mimeType: "text/html;profile=mcp-app",
          },
          {
            uri: LIVE_CARD_URI,
            name: "promptfun.fun live card",
            description: "Confirmed coin. Picture and name are locked, with the contract address, pump.fun link, SOL paid, and fees not yet pushed.",
            mimeType: "text/html;profile=mcp-app",
          },
        ],
      }),
    };
  }
  if (method === "resources/read") {
    const uri = params?.uri;
    if (uri === DRAFT_CARD_URI) {
      return {
        type: "result",
        body: rpcResult(id, {
          contents: [
            {
              uri: DRAFT_CARD_URI,
              mimeType: "text/html;profile=mcp-app",
              text: renderDraftCard(origin),
            },
          ],
        }),
      };
    }
    if (uri === LIVE_CARD_URI) {
      return {
        type: "result",
        body: rpcResult(id, {
          contents: [
            {
              uri: LIVE_CARD_URI,
              mimeType: "text/html;profile=mcp-app",
              text: renderLiveCard(origin, toLiveView(db, latestLiveRow(db))),
            },
          ],
        }),
      };
    }
    return { type: "result", body: rpcError(id, -32002, "Resource not found") };
  }
  return { type: "result", body: rpcError(id, -32601, "Method not found") };
}

export function wantsSse(accept) {
  return typeof accept === "string" && accept.includes("text/event-stream");
}

export function sseBody(payload) {
  return `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
}
