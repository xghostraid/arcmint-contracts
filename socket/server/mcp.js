import { PING_TEXT } from "../shared/copy.js";
import { formatSol } from "../public/format.js";
import { getLiveCoin } from "./db.js";

export const PROTOCOL = "2025-03-26";
const SUPPORTED = new Set(["2025-03-26", "2025-06-18", "2024-11-05"]);
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const TOOLS = [
  {
    name: "ping",
    description: "Check that Socket is connected. Returns the fee split and that launches are paused. Does not launch a coin.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "coin_status",
    description: "Read a coin Socket has confirmed. Pass the Solana mint as address. Returns the pump.fun link, the locked 50/50 creator-fee split, and SOL paid to the creator wallet.",
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
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
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

function callTool(db, params) {
  const name = params?.name;
  const args = params?.arguments && typeof params.arguments === "object" ? params.arguments : {};
  if (name === "ping") return toolResult(PING_TEXT);
  if (name === "coin_status") {
    const address = typeof args.address === "string" ? args.address.trim() : "";
    if (!BASE58.test(address)) {
      return toolResult("coin_status needs a Solana contract address (32–44 characters).", true);
    }
    const coin = getLiveCoin(db, address);
    if (!coin) {
      return toolResult(`${address} is not in Socket's book. The floor only lists coins this connector has confirmed.`);
    }
    return toolResult(coinStatusText(coin));
  }
  return toolResult("Unknown tool.", true);
}

export function handleMcpMessage(db, message) {
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
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "Socket", version: "0.1.0" },
        instructions: `${PING_TEXT} Tools available: ping, coin_status.`,
      }),
    };
  }
  if (method === "ping") return { type: "result", body: rpcResult(id, {}) };
  if (method === "tools/list") return { type: "result", body: rpcResult(id, { tools: TOOLS }) };
  if (method === "tools/call") return { type: "result", body: rpcResult(id, callTool(db, params)) };
  return { type: "result", body: rpcError(id, -32601, "Method not found") };
}

export function wantsSse(accept) {
  return typeof accept === "string" && accept.includes("text/event-stream");
}

export function sseBody(payload) {
  return `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
}
