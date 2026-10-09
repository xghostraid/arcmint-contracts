import { createHash, randomBytes } from "node:crypto";
import type { Config } from "../config.js";
import { adapterFor } from "../chains/index.js";
import type { BuildOptions } from "../chains/adapter.js";
import { findChain, type ActionKind, type Chain } from "../chains/registry.js";
import { impersonatesBrand, isMajorSymbol } from "../brand.js";
import { AmountError, formatUnits, parseUnits } from "../util/amount.js";
import { generatePumpMintKeypair, PUMPFUN_DECIMALS, PUMPFUN_SUPPLY } from "../chains/solana/pumpfun.js";
import { IntentStore } from "./store.js";
import { IntentError, type Built, type Intent, type LaunchParams, type TransferParams } from "./types.js";
import { chainAllowsSponsoredLaunch, sponsorBudgetSnapshot } from "../sponsor/budget.js";
import { createFeePayerSigner } from "../sponsor/local-signer.js";
import type { FeePayerSigner } from "../sponsor/types.js";
import { solanaInstructionFingerprint } from "../sponsor/fingerprint.js";
import type { PictureService } from "../pictures/service.js";
import type { AuthenticatedUser } from "../auth/types.js";
import type { PlatformStore } from "../platform/store.js";
import { assertLaunchQuota } from "../platform/quota.js";
import { assertMonthlyBudget, monthKeyUtc, recordSponsorSpendUsd } from "../platform/budget-ledger.js";

const U64_MAX = (1n << 64n) - 1n;

export interface LaunchInput {
  chain: string;
  name: string;
  symbol: string;
  supply?: string;
  decimals?: number;
  description?: string;
  metadataUri?: string;
  pictureId?: string;
  website?: string;
  x?: string;
  fixedSupply?: boolean;
  venue?: "spl" | "pumpfun" | "erc20";
  idempotencyKey?: string;
}

export interface TransferInput {
  chain: string;
  asset: string;
  amount: string;
  to: string;
  idempotencyKey?: string;
}

function now(): string {
  return new Date().toISOString();
}

export class IntentService {
  private poller: NodeJS.Timeout | null = null;
  private polling = false;
  private caller: AuthenticatedUser | null = null;

  private readonly sponsorSigner: FeePayerSigner | null;

  constructor(
    readonly config: Config,
    readonly store: IntentStore,
    readonly pictures: PictureService,
    readonly platform: PlatformStore | null = null,
  ) {
    this.sponsorSigner = createFeePayerSigner(config);
  }

  setCaller(user: AuthenticatedUser | null): void {
    this.caller = user;
  }

  clearCaller(): void {
    this.caller = null;
  }

  async buildMetadataUri(input: {
    pictureId: string;
    name: string;
    symbol: string;
    description?: string;
    website?: string;
    x?: string;
  }): Promise<{ metadataUri: string; imageCid: string; pictureId: string }> {
    const { metadataUri, imageCid } = await this.pictures.buildMetadataUri({
      pictureId: input.pictureId.trim(),
      name: input.name.trim(),
      symbol: input.symbol.trim().toUpperCase(),
      description: (input.description ?? "").slice(0, 400),
      website: input.website,
      x: input.x,
    });
    return { metadataUri, imageCid, pictureId: input.pictureId.trim() };
  }

  sponsorPublicKey(): string | null {
    return this.sponsorSigner?.publicKey ?? null;
  }


  approveUrl(id: string): string {
    return `${this.config.publicUrl}/approve/${id}`;
  }

  chainOrThrow(key: string, kind?: ActionKind): Chain {
    const chain = findChain(this.config, key);
    if (!chain) throw new IntentError(`Unknown chain "${key}". Call get_capabilities for the list.`, "unknown_chain");
    if (chain.disabledReason) throw new IntentError(`${chain.name} is turned off on this server. ${chain.disabledReason}`, "chain_disabled");
    if (kind && !chain.actions.includes(kind)) {
      throw new IntentError(`${chain.name} does not support ${kind === "launch_token" ? "token launches" : "transfers"} in promptfun.`, "unsupported");
    }
    return chain;
  }

  private rateLimit(): void {
    if (this.store.countSince(Date.now() - 3_600_000) >= this.config.maxIntentsPerHour) {
      throw new IntentError("Too many requests in the last hour. Try again later.", "rate_limited");
    }
  }

  private async finishPrepare(intent: Omit<Intent, "id" | "createdAt" | "updatedAt" | "expiresAt" | "status" | "built" | "submission" | "receipt" | "error" | "events" | "executionMode" | "instructionFingerprint">, chain: Chain): Promise<Intent> {
    const live = this.store.findLive(intent.idempotencyKey);
    if (live && Date.parse(live.expiresAt) > Date.now()) return live;
    this.rateLimit();
    const created = now();
    const full: Intent = {
      ...intent,
      id: `int_${randomBytes(16).toString("hex")}`,
      status: "awaiting_wallet",
      createdAt: created,
      updatedAt: created,
      expiresAt: new Date(Date.parse(created) + this.config.intentTtlMs).toISOString(),
      built: null,
      submission: null,
      receipt: null,
      error: null,
      events: [{ at: created, type: "prepared", detail: intent.summary }],
      executionMode: "wallet",
      instructionFingerprint: null,
    };
    const issues = await adapterFor(chain.family).check(chain, full);
    if (issues.length) throw new IntentError(issues.join(" "));
    this.store.save(full);
    if (full.kind === "launch_token" && this.shouldOfferSponsoredLaunch(chain, full)) {
      try {
        return await this.attachSponsoredPreview(full);
      } catch {
        return full;
      }
    }
    return full;
  }

  private shouldOfferSponsoredLaunch(chain: Chain, intent: Intent): boolean {
    if (!chainAllowsSponsoredLaunch(chain)) return false;
    if (!sponsorBudgetSnapshot(this.config).sponsoredLaunchesEnabled) return false;
    if (!this.sponsorSigner) return false;
    const venue = (intent.params as LaunchParams).venue;
    if (venue === "pumpfun") {
      return chain.family === "solana" && chain.launchVenues.includes("pumpfun");
    }
    return true;
  }

  private sponsoredBuildOptions(intent: Intent): BuildOptions {
    const params = intent.params as LaunchParams;
    if (params.venue !== "pumpfun") return {};
    const existing = intent.built?.coSignerSecrets;
    if (existing) {
      const [publicKey, secretB64] = Object.entries(existing)[0] ?? [];
      if (publicKey && secretB64) {
        return { sponsoredPumpMint: { publicKey, secretKey: Buffer.from(secretB64, "base64") } };
      }
    }
    const mintKp = generatePumpMintKeypair();
    return { sponsoredPumpMint: { publicKey: mintKp.publicKey.toBase58(), secretKey: mintKp.secretKey } };
  }

  private async attachSponsoredPreview(intent: Intent): Promise<Intent> {
    const sponsor = this.sponsorSigner!.publicKey;
    let working = intent;
    const buildOpts = this.sponsoredBuildOptions(intent);
    if ((intent.params as LaunchParams).venue === "pumpfun" && buildOpts.sponsoredPumpMint) {
      const feeRecipient = this.config.sponsorFeeRecipient ?? sponsor;
      working = {
        ...intent,
        params: { ...(intent.params as LaunchParams), feeRecipient },
      };
    }
    const { built } = await this.buildInternal(working, sponsor, buildOpts);
    const at = now();
    const next: Intent = {
      ...working,
      status: "awaiting_confirm",
      executionMode: "sponsor",
      built,
      instructionFingerprint: solanaInstructionFingerprint(built),
      updatedAt: at,
      events: [...working.events, { at, type: "previewed", detail: `Sponsored preview; fee paid by promptfun (${sponsor}).` }],
    };
    this.store.save(next);
    return next;
  }

  async prepareLaunch(input: LaunchInput): Promise<Intent> {
    const chain = this.chainOrThrow(input.chain, "launch_token");
    const defaultVenue = chain.family === "evm" ? "erc20" : chain.cluster === "mainnet-beta" ? "pumpfun" : "spl";
    const venue = input.venue ?? defaultVenue;
    const name = input.name.trim();
    const symbol = input.symbol.trim().toUpperCase();
    if (!name || name.length > 32) throw new IntentError("The token name must be 1–32 characters.");
    if (!/^[A-Z0-9]{1,10}$/.test(symbol)) throw new IntentError("The symbol must be 1–10 letters or digits.");
    if (impersonatesBrand(name, symbol)) {
      throw new IntentError("Launches cannot use the promptfun name. Pick something original.", "impersonation");
    }
    if (isMajorSymbol(symbol)) {
      throw new IntentError(`${symbol} is the symbol of a major token. Pick an original symbol.`, "impersonation");
    }
    let metadataUri = (input.metadataUri ?? "").trim();
    if (metadataUri && !/^(https:\/\/|ipfs:\/\/|ar:\/\/)\S{3,200}$/.test(metadataUri)) {
      throw new IntentError("The metadata link must be an https://, ipfs:// or ar:// URL under 200 characters.");
    }
    const website = (input.website ?? "").trim();
    const x = (input.x ?? "").trim();
    if (website && !/^https:\/\/\S{3,200}$/.test(website)) {
      throw new IntentError("The website link must be an https:// URL under 200 characters.");
    }
    if (x && !/^https:\/\/\S{3,200}$/.test(x)) {
      throw new IntentError("The X link must be an https:// URL under 200 characters.");
    }
    const pictureId = (input.pictureId ?? "").trim();
    if (pictureId && !/^pic_[a-f0-9]{24}$/.test(pictureId)) {
      throw new IntentError("pictureId must come from save_picture (pic_…).");
    }
    if (pictureId && !metadataUri) {
      try {
        const built = await this.buildMetadataUri({
          pictureId,
          name,
          symbol,
          description: input.description,
          website: website || undefined,
          x: x || undefined,
        });
        metadataUri = built.metadataUri;
      } catch (err) {
        throw err instanceof IntentError ? err : new IntentError((err as Error).message);
      }
    }
    let supply = (input.supply ?? "1000000000").replace(/[_,\s]/g, "");
    let decimals = input.decimals ?? (chain.family === "evm" ? 18 : 9);
    if (venue === "pumpfun") {
      if (input.supply && input.supply.replace(/[_,\s]/g, "") !== PUMPFUN_SUPPLY) {
        throw new IntentError("pump.fun coins always have a supply of 1,000,000,000. Drop the custom supply or launch as a plain token.");
      }
      supply = PUMPFUN_SUPPLY;
      decimals = PUMPFUN_DECIMALS;
      if (!metadataUri) throw new IntentError("pump.fun needs a metadata link (IPFS/HTTPS JSON with name, symbol and image).");
    }
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > (chain.family === "evm" ? 18 : 9)) {
      throw new IntentError(`Decimals must be a whole number from 0 to ${chain.family === "evm" ? 18 : 9}.`);
    }
    let base: bigint;
    try {
      base = parseUnits(supply, 0);
    } catch {
      throw new IntentError("The supply must be a whole number of tokens.");
    }
    if (base <= 0n) throw new IntentError("The supply must be more than zero.");
    if (chain.family === "solana" && base * 10n ** BigInt(decimals) > U64_MAX) {
      throw new IntentError("That supply is too large for Solana with these decimals. Lower the supply or the decimals.");
    }
    const params: LaunchParams = {
      name,
      symbol,
      supply: base.toString(),
      decimals,
      description: (input.description ?? "").slice(0, 400),
      metadataUri,
      ...(website ? { website } : {}),
      ...(x ? { x } : {}),
      fixedSupply: venue === "pumpfun" ? true : input.fixedSupply ?? true,
      venue,
    };
    const summary = venue === "pumpfun"
      ? `Launch "${name}" (${symbol}) on pump.fun, ${chain.name}. Real SOL.`
      : `Launch ${formatUnits(base, 0)} ${symbol} ("${name}") on ${chain.name}, ${params.fixedSupply ? "fixed supply" : "mint authority kept"}.`;
    return this.finishPrepare({
      kind: "launch_token",
      chain: chain.key,
      family: chain.family,
      params,
      summary,
      idempotencyKey: this.key("launch", chain.key, input.idempotencyKey, params),
    }, chain);
  }

  async prepareTransfer(input: TransferInput): Promise<Intent> {
    const chain = this.chainOrThrow(input.chain, "transfer");
    const adapter = adapterFor(chain.family);
    const to = input.to.trim();
    if (!adapter.isAddress(to)) throw new IntentError(`"${to}" is not a ${chain.name} wallet address.`);
    const amount = input.amount.trim();
    const asset0 = input.asset.trim() || "native";
    const isNative = asset0 === "native" || asset0.toUpperCase() === chain.nativeSymbol;
    try {
      if (parseUnits(amount, isNative ? chain.nativeDecimals : 18) <= 0n) throw new IntentError("The amount must be more than zero.");
    } catch (err) {
      if (err instanceof IntentError) throw err;
      throw new IntentError(err instanceof AmountError ? err.message : "The amount is not a number.");
    }
    const asset = input.asset.trim() || "native";
    const params: TransferParams = { asset, amount, to };
    const label = asset === "native" ? chain.nativeSymbol : asset.length > 12 ? `token ${asset}` : asset;
    return this.finishPrepare({
      kind: "transfer",
      chain: chain.key,
      family: chain.family,
      params,
      summary: `Send ${amount} ${label} to ${to} on ${chain.name}.`,
      idempotencyKey: this.key("transfer", chain.key, input.idempotencyKey, params),
    }, chain);
  }

  private key(kind: string, chain: string, given: string | undefined, params: unknown): string {
    if (given) return `${kind}:${chain}:${given}`;
    return `${kind}:${chain}:${createHash("sha256").update(JSON.stringify(params)).digest("hex").slice(0, 32)}`;
  }

  get(id: string): Intent {
    const intent = this.store.get(id);
    if (!intent) throw new IntentError("No request with that id.", "not_found");
    return this.expireIfDue(intent);
  }

  private expireIfDue(intent: Intent): Intent {
    if ((intent.status === "awaiting_wallet" || intent.status === "awaiting_confirm" || intent.status === "built") && Date.parse(intent.expiresAt) <= Date.now()) {
      return this.update(intent, { status: "expired" }, "expired", "Not approved in time. Nothing was sent.");
    }
    return intent;
  }

  private update(intent: Intent, patch: Partial<Intent>, type: string, detail: string): Intent {
    const at = now();
    const next: Intent = { ...intent, ...patch, updatedAt: at, events: [...intent.events, { at, type, detail }] };
    this.store.save(next);
    return next;
  }

  private async buildInternal(intent: Intent, signer: string, options: BuildOptions): Promise<{ intent: Intent; built: Built }> {
    const chain = this.chainOrThrow(intent.chain, intent.kind);
    try {
      const built = await adapterFor(chain.family).build(chain, intent, signer, options);
      return { intent, built };
    } catch (err) {
      if (err instanceof AmountError) throw new IntentError(err.message);
      throw err;
    }
  }

  async build(id: string, signer: string, options: BuildOptions = {}): Promise<{ intent: Intent; built: Built }> {
    const intent = this.get(id);
    if (intent.status !== "awaiting_wallet" && intent.status !== "awaiting_confirm" && intent.status !== "built") {
      throw new IntentError(`This request is already ${intent.status}.`, "wrong_state");
    }
    const { built } = await this.buildInternal(intent, signer, options);
    const patch: Partial<Intent> = { status: "built", built, error: null };
    if (signer !== this.sponsorSigner?.publicKey) {
      patch.executionMode = "wallet";
      patch.instructionFingerprint = null;
    }
    const next = this.update(intent, patch, "built",
      `Transaction compiled for ${signer}; simulation ${built.simulation.ok ? "passed" : `failed: ${built.simulation.error}`}.`);
    return { intent: next, built };
  }

  async confirmLaunch(id: string): Promise<Intent> {
    const intent = this.get(id);
    if (intent.executionMode !== "sponsor" || intent.status !== "awaiting_confirm") {
      throw new IntentError("This request is not waiting for in-chat confirmation.", "wrong_state");
    }
    if (this.config.oauthRequired && !this.caller) {
      throw new IntentError("Sign in is required for sponsored launches.", "unauthorized");
    }
    if (this.platform && this.caller) {
      try {
        assertLaunchQuota(this.platform, this.caller.sub);
        assertMonthlyBudget(this.platform, this.config.monthlyBudgetUsd, monthKeyUtc());
      } catch (err) {
        throw new IntentError((err as Error).message, "quota_exceeded");
      }
    }
    const budget = sponsorBudgetSnapshot(this.config);
    if (!budget.sponsoredLaunchesEnabled) throw new IntentError(budget.pauseReason ?? "Sponsored launches are paused.", "sponsor_paused");
    if (!this.sponsorSigner || !intent.instructionFingerprint) throw new IntentError("Sponsor signing is not available.", "sponsor_unconfigured");
    const chain = this.chainOrThrow(intent.chain, intent.kind);
    const sponsor = this.sponsorSigner.publicKey;
    const { built } = await this.buildInternal(intent, sponsor, this.sponsoredBuildOptions(intent));
    if (solanaInstructionFingerprint(built) !== intent.instructionFingerprint) {
      throw new IntentError("The live transaction no longer matches the preview. Nothing was sent.", "mismatch");
    }
    if (!built.simulation.ok) throw new IntentError(`Simulation failed: ${built.simulation.error ?? "unknown"}`, "simulation_failed");
    const signed = await this.sponsorSigner.signSolanaTransaction(chain.key, intent, built, built.payload);
    const withBuilt = this.update(intent, { status: "built", built, error: null }, "confirmed_in_chat", "User confirmed launch in chat.");
    const submitted = await this.submit(withBuilt.id, signed);
    if (this.platform && this.caller) {
      this.platform.recordLaunchQuota(this.caller.sub);
      const usd = built.cost.usd ? Number.parseFloat(built.cost.usd) : 0.05;
      recordSponsorSpendUsd(this.platform, this.caller.sub, Number.isFinite(usd) ? usd : 0.05, monthKeyUtc());
    }
    return submitted;
  }

  async submit(id: string, walletPayload: string): Promise<Intent> {
    const intent = this.get(id);
    if (intent.status !== "built") throw new IntentError(`This request is ${intent.status}, not ready to send.`, "wrong_state");
    const chain = this.chainOrThrow(intent.chain, intent.kind);
    try {
      const result = await adapterFor(chain.family).submit(chain, intent, walletPayload);
      const next = this.update(intent, { status: "submitted", submission: { id: result.id, submittedAt: now() } }, "submitted", `Sent to ${chain.name}: ${result.id}`);
      void this.refresh(next.id).catch(() => undefined);
      return next;
    } catch (err) {
      const message = (err as Error).message;
      this.update(intent, { error: message }, "submit_failed", message);
      throw err;
    }
  }

  walletRejected(id: string, reason: string): Intent {
    const intent = this.get(id);
    if (intent.status !== "awaiting_wallet" && intent.status !== "awaiting_confirm" && intent.status !== "built") return intent;
    return this.update(intent, { error: "You declined in your wallet. Nothing was sent." }, "wallet_rejected", reason.slice(0, 200) || "Declined in wallet.");
  }

  /** Read the receipt from the chain for a submitted intent. Never marks success without a chain read. */
  async refresh(id: string): Promise<Intent> {
    const intent = this.get(id);
    if (intent.status !== "submitted") return intent;
    const chain = findChain(this.config, intent.chain);
    if (!chain) return intent;
    const receipt = await adapterFor(chain.family).receipt(chain, intent);
    if (!receipt) return intent;
    const status = receipt.status === "success" ? "confirmed" : "failed";
    return this.update(intent, { status, receipt, error: status === "failed" ? receipt.verified.find((v) => v.startsWith("MISMATCH") || /fail|never/i.test(v)) ?? "Failed on chain." : null },
      status, status === "confirmed" ? `Confirmed in slot/block ${receipt.slotOrBlock}.` : "Failed; see receipt.");
  }

  startPoller(intervalMs = 2500): void {
    if (this.poller) return;
    this.poller = setInterval(async () => {
      if (this.polling) return;
      this.polling = true;
      try {
        for (const intent of this.store.withStatus("submitted")) {
          await this.refresh(intent.id).catch(() => undefined);
        }
      } finally {
        this.polling = false;
      }
    }, intervalMs);
    this.poller.unref();
  }

  stopPoller(): void {
    if (this.poller) clearInterval(this.poller);
    this.poller = null;
  }
}
