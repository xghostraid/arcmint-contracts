import type { Config } from "../config.js";
import { recommendedLaunchChainKey } from "../chains/registry.js";
import { BRAND, SHORT } from "../brand.js";
import { sponsorBudgetSnapshot } from "../sponsor/budget.js";

/** Shown on the site and in get_capabilities for copy-paste examples. */
export const EXAMPLE_USER_PROMPTS = [
  "Launch TEST on mainnet",
  "Launch Moonbeam BEAM on mainnet with this photo.",
  "Launch tes test with this image",
] as const;

export function launchPlaybook(config: Config): string[] {
  const chain = recommendedLaunchChainKey(config) ?? "solana-mainnet";
  const sponsored =
    config.enablePumpfunMainnet &&
    config.enableSponsoredMainnet &&
    config.enableSponsoredLaunches &&
    sponsorBudgetSnapshot(config).sponsoredMainnetEnabled;

  return [
    "Users speak like getplugged: short plain English. Never ask them to name MCP tools, paste image URLs, recite panel steps, or paste base64.",
    `Default launch chain when they say mainnet, live, pump.fun, or omit a chain: ${chain}. Use solana-devnet only when they ask for devnet or testnet.`,
    "When the message includes a chat image attachment or an https:// JPEG/PNG link, import it yourself: call import_picture_from_url with the attachment URL, or open_picture_panel({ imageUrl }) (server auto-imports and returns pictureId in plain text). Do not ask them to copy a URL.",
    "When the picture panel shows Saved, call get_last_picture with handoffSessionId from open_picture_panel plain text, or prepare_launch with the same handoffSessionId — Claude custom connectors do not reliably expose panel iframe tools/call or ui/message. FORBIDDEN: ask the user to copy pic_.",
    "Infer name and symbol from the message (e.g. \"Launch TEST on mainnet\" → name TEST, symbol TEST; \"Moonbeam BEAM\" → name Moonbeam, symbol BEAM; \"tes test\" → name Tes Test, symbol TEST). Ask only if name or ticker is truly missing.",
    "Then prepare_launch with name, symbol, and pictureId, imageUrl, or handoffSessionId (chain optional). Show the in-chat card.",
    sponsored
      ? "On sponsored mainnet they tap Launch it on the card; confirm_launch sends. Do not send confirm_launch until they confirm on the card."
      : "Wallet mode: they open approveUrl and sign. Do not claim success until get_action_status is confirmed.",
    "Call get_capabilities when they ask what is supported or which chain to use — not on every launch.",
  ];
}

export function serverInstructions(config: Config): string {
  const sponsoredMainnet =
    config.enableSponsoredMainnet && config.enableSponsoredLaunches && config.enablePumpfunMainnet;
  const launchPath = sponsoredMainnet
    ? "Default: Solana mainnet pump.fun with no wallet — prepare_launch returns the card, the user taps Launch it, confirm_launch sends (promptfun pays network fees from the sponsor wallet; real mainnet SOL)."
    : config.enablePumpfunMainnet
      ? "Solana mainnet pump.fun is live via the approval page and the user's wallet (real SOL)."
      : "Solana mainnet is off until PROMPTFUN_ENABLE_PUMPFUN_MAINNET=1.";
  const playbookHint =
    "Short prompts work (e.g. \"Launch TEST on mainnet\" or \"Launch Moonbeam BEAM with this photo\"). Follow launchPlaybook from get_capabilities: auto-import chat images, infer name/symbol, prepare_launch (use handoffSessionId from open_picture_panel when the panel saved), card confirm — never ask the user to copy pic_.";
  return `${BRAND} turns a request into a token launch or transfer. ${launchPath} Devnet remains for optional testing. ${SHORT} never holds user keys. ${playbookHint} After prepare_*, use the in-chat card (Launch it for sponsored launches) or the approval link for wallet mode, then get_action_status for the chain-read receipt. Never claim success before status is confirmed.`;
}
