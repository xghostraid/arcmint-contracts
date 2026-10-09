/**
 * A minimal MCP Apps host built on the official host SDK (AppBridge from @modelcontextprotocol/ext-apps). It renders
 * the card in a sandboxed iframe and speaks the ui/* protocol over postMessage, the way Claude does. Used by the card
 * tests and by the screenshot script.
 */
import { build } from "esbuild";
import type { Page } from "playwright-core";

const HOST_SCRIPT = `
import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
window.startHost = async (html, toolInput, toolResult, hostContext, width) => {
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.width = String(width || 420);
  frame.height = "600";
  frame.frameBorder = "0";
  document.getElementById("host").appendChild(frame);
  const bridge = new AppBridge(null, { name: "reference-host", version: "1.0.0" }, { openLinks: {}, serverTools: {} }, { hostContext });
  window.host = { bridge, opened: [], heights: [], calls: [], initialized: false };
  bridge.oncalltool = async (params) => { window.host.calls.push(params.name); return window.hostCallTool(params); };
  bridge.onopenlink = async ({ url }) => { window.host.opened.push(url); return {}; };
  bridge.onsizechange = ({ height }) => { window.host.heights.push(height); if (height) frame.height = String(height); };
  bridge.oninitialized = async () => {
    window.host.initialized = true;
    await bridge.sendToolInput({ arguments: toolInput });
    await bridge.sendToolResult(toolResult);
  };
  await bridge.connect(new PostMessageTransport(frame.contentWindow, frame.contentWindow));
  frame.srcdoc = html;
};
`;

let bundled: string | null = null;

export async function referenceHostScript(): Promise<string> {
  if (bundled) return bundled;
  const out = await build({ stdin: { contents: HOST_SCRIPT, resolveDir: process.cwd(), loader: "js" }, bundle: true, format: "iife", platform: "browser", write: false, logLevel: "silent" });
  bundled = out.outputFiles[0].text;
  return bundled;
}

/** Loads the host into `page`. `callTool` answers tools/call requests from the card. */
export async function installReferenceHost(page: Page, callTool: (params: { name: string; arguments?: Record<string, unknown> }) => Promise<unknown>, pageHtml = "<!doctype html><html><body><div id=\"host\"></div></body></html>"): Promise<void> {
  await page.exposeFunction("hostCallTool", callTool);
  await page.setContent(pageHtml);
  await page.addScriptTag({ content: await referenceHostScript() });
}
