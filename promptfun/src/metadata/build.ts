import { ipfsUri } from "../ipfs/pinner.js";

export interface TokenMetadataFields {
  name: string;
  symbol: string;
  description: string;
  website?: string;
  /** X / Twitter profile or post URL (pump.fun uses the `twitter` field). */
  x?: string;
}

export interface TokenMetadataInput extends TokenMetadataFields {
  image: string;
}

export interface BuiltTokenMetadata {
  json: Record<string, unknown>;
  bytes: Buffer;
  metadataUri: string;
}

function trimUrl(value: string | undefined, max: number): string | undefined {
  const v = (value ?? "").trim();
  if (!v) return undefined;
  if (v.length > max) throw new Error(`URL must be at most ${max} characters.`);
  if (!/^https:\/\//i.test(v)) throw new Error("Links must start with https://");
  return v;
}

export function buildTokenMetadataJson(input: TokenMetadataInput): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: input.name.slice(0, 32),
    symbol: input.symbol.slice(0, 10),
    description: input.description.slice(0, 400),
    image: input.image,
  };
  const website = trimUrl(input.website, 200);
  const twitter = trimUrl(input.x, 200);
  if (website) out.website = website;
  if (twitter) out.twitter = twitter;
  return out;
}

export function assertMetadataUriLength(uri: string): void {
  if (uri.length > 200) throw new Error("The metadata link must be under 200 characters.");
}

export function metadataUriFromCid(cid: string): string {
  const uri = ipfsUri(cid);
  assertMetadataUriLength(uri);
  return uri;
}

/** On-chain metadata URL served by promptfun (kept short for Solana tx size limits). */
export function hostedTokenMetadataUri(publicUrl: string, pictureId: string): string {
  const uri = `${publicUrl.replace(/\/+$/, "")}/m/${pictureId}`;
  assertMetadataUriLength(uri);
  return uri;
}

export function buildTokenMetadataBytes(input: TokenMetadataInput): Buffer {
  return Buffer.from(JSON.stringify(buildTokenMetadataJson(input)), "utf8");
}
