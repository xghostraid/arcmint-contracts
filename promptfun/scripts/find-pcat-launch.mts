import { Connection, PublicKey } from "@solana/web3.js";
import { decodeInstructions } from "../src/chains/solana/decode.js";

const sponsor = new PublicKey("5YPhpDDtYtKaKnUgSskb4tXKZL9a7rj8siCuMS7qESpv");
const conn = new Connection(process.env.PROMPTFUN_RPC_SOLANA_MAINNET ?? "https://api.mainnet-beta.solana.com", "confirmed");
let before: string | undefined;
for (let page = 0; page < 8; page++) {
  const sigs = await conn.getSignaturesForAddress(sponsor, { limit: 100, before });
  if (!sigs.length) break;
  before = sigs[sigs.length - 1]?.signature;
  for (const s of sigs) {
    if (s.err) continue;
    const tx = await conn.getTransaction(s.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!tx?.transaction) continue;
    const message = tx.transaction.message;
    const keys = message.getAccountKeys().staticAccountKeys;
    const ixs = message.compiledInstructions.map((ix) => ({
      programId: keys[ix.programIdIndex]!,
      keys: ix.accountKeyIndexes.map((i) => ({ pubkey: keys[i]!, isSigner: false, isWritable: false })),
      data: Buffer.from(ix.data),
    }));
    try {
      const decoded = decodeInstructions(ixs as never, new Map());
      const pc = decoded.pumpCreate;
      if (!pc) continue;
      if (pc.symbol === "PCAT" || pc.uri.includes("pic_c212409640a239286fcba88e")) {
        console.log(JSON.stringify({ sig: s.signature, mint: pc.mint, name: pc.name, symbol: pc.symbol, uri: pc.uri, blockTime: tx.blockTime }, null, 2));
      }
    } catch {
      // not a decodable promptfun tx
    }
  }
}
