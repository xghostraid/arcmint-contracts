import type { Chain } from "./registry.js";
import type { Built, Intent, Receipt } from "../intents/types.js";

export interface SubmitResult {
  /** Solana signature or EVM transaction hash. */
  id: string;
}

export interface BuildOptions {
  /** Public key of a one-time mint keypair generated and held only by the approval page (pump.fun). */
  mint?: string;
}

/**
 * One adapter per chain family. The intent pipeline never branches on chain beyond this interface.
 * No method receives or produces a private key.
 */
export interface ChainAdapter {
  /** Validate params against chain rules that need no signer (addresses, token existence). */
  check(chain: Chain, intent: Intent): Promise<string[]>;
  /** Compile the exact unsigned transaction for `signer`, decode it into steps, simulate, and cost it. */
  build(chain: Chain, intent: Intent, signer: string, options?: BuildOptions): Promise<Built>;
  /**
   * Accept what the wallet returned. Solana: a signed transaction that must match `built` byte for byte,
   * relayed only after that check. EVM: a hash the wallet broadcast, checked against the chain.
   */
  submit(chain: Chain, intent: Intent, walletPayload: string): Promise<SubmitResult>;
  /** Read the outcome from the chain. Null while not yet final. */
  receipt(chain: Chain, intent: Intent): Promise<Receipt | null>;
  balance(chain: Chain, address: string, token: string | null): Promise<{ amount: string; symbol: string }>;
  isAddress(address: string): boolean;
}
