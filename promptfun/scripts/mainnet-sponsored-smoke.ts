/**
 * Production smoke: prepare_launch (mainnet) → confirm_launch_by_text.
 * Usage: npx tsx scripts/mainnet-sponsored-smoke.ts [mcpOrigin]
 */
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const origin = (process.argv[2] || "https://promptfun.fun").replace(/\/$/, "");
const tag = Date.now().toString(36).slice(-4).toUpperCase();

const client = new Client({ name: "mainnet-smoke", version: "0.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`)));

async function call(name: string, args: Record<string, unknown>) {
  const result: any = await client.callTool({ name, arguments: args });
  const text = (result.content ?? []).map((c: any) => c.text ?? "").join("\n");
  return { text, data: result.structuredContent, isError: Boolean(result.isError) };
}

const caps = await call("get_capabilities", {});
console.log("sponsored:", JSON.stringify(caps.data?.sponsoredLaunches));
console.log("recommended:", caps.data?.recommendedLaunchChain);

const prep = await call("prepare_launch", {
  chain: "solana-mainnet",
  name: `Smoke ${tag}`,
  symbol: `SM${tag.slice(0, 2)}`,
  metadataUri: "https://pump.fun/coin-metadata.json",
  description: "promptfun mainnet sponsored smoke test",
});
if (prep.isError) {
  console.error("prepare failed:", prep.text);
  process.exit(1);
}
const view = prep.data;
console.log("prepare status:", view?.status, "mode:", view?.executionMode, "sim:", view?.preview?.simulationOk);
console.log("fee total:", view?.preview?.total, "enough:", view?.preview?.enough, "balance:", view?.preview?.balance);
if (view?.status !== "awaiting_confirm" || view?.executionMode !== "sponsor") {
  console.error("Expected sponsored awaiting_confirm, got", view?.status, view?.executionMode);
  process.exit(1);
}
if (!view?.preview?.simulationOk) {
  console.error("Simulation failed:", view?.preview?.simulationError);
  process.exit(1);
}

const confirm = await call("confirm_launch_by_text", { intentId: view.intentId });
if (confirm.isError) {
  console.error("confirm failed:", confirm.text);
  process.exit(1);
}
console.log("confirm status:", confirm.data?.status, "tx:", confirm.data?.transaction?.id);
if (confirm.data?.status === "failed" || confirm.data?.error) {
  console.error("error:", confirm.data?.error);
  process.exit(1);
}

for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  const st = await call("get_action_status", { intentId: view.intentId });
  console.log("poll:", st.data?.status);
  if (st.data?.status === "confirmed") {
    console.log("SUCCESS", st.data?.transaction?.id, st.data?.receipt?.explorerUrl);
    await client.close();
    process.exit(0);
  }
  if (st.data?.status === "failed") {
    console.error("FAILED", st.data?.error, st.text);
    await client.close();
    process.exit(1);
  }
}
console.error("timeout waiting for confirmation");
await client.close();
process.exit(1);
