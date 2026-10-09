import { listLiveMints, recordPayout, unpushedSol } from "./db.js";
import { hasLaunchKey } from "./treasury.js";

// Creator fees push once this much is waiting. There is no house token.
export const PAYOUT_MIN_SOL = 0.003;

export function watchPayouts(db, options = {}) {
  const env = options.env ?? process.env;
  if (!hasLaunchKey(env)) {
    return { paused: true, recorded: [] };
  }
  const now = options.now instanceof Date ? options.now : new Date();
  const submit = options.submit;
  if (typeof submit !== "function") {
    return { paused: false, recorded: [] };
  }
  const recorded = [];
  for (const mint of listLiveMints(db)) {
    const amountSol = unpushedSol(db, mint);
    if (amountSol < PAYOUT_MIN_SOL) continue;
    const signature = submit({ mint, amountSol });
    if (typeof signature !== "string" || !signature) continue;
    recordPayout(db, { mint, amountSol, signature, at: now });
    recorded.push({
      mint,
      amountSol,
      signature,
      at: now.toISOString(),
    });
  }
  return { paused: false, recorded };
}
