// One launch costs about 0.012 SOL. This module only answers whether a
// signer could pay. It does not read a key into a return value, and it
// does not create one.
export const LAUNCH_COST_SOL = 0.012;

export function treasuryCanPay(env = process.env) {
  const rawKey = env && env.SOCKET_LAUNCH_KEY;
  const hasKey = typeof rawKey === "string" && rawKey.trim().length > 0;
  const balance = Number(env && env.SOCKET_LAUNCH_BALANCE_SOL);
  return hasKey && Number.isFinite(balance) && balance >= LAUNCH_COST_SOL;
}
