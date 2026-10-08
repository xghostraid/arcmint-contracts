import { timingSafeEqual } from "node:crypto";
import { LAUNCH_COST_SOL, treasuryCanPay } from "./treasury.js";

export function floatCoversLaunch(env = process.env) {
  const balance = Number(env && env.SOCKET_LAUNCH_BALANCE_SOL);
  return Number.isFinite(balance) && balance >= LAUNCH_COST_SOL;
}

export function lowFloatAlert(env = process.env) {
  if (floatCoversLaunch(env)) return null;
  return { alert: "low-float", text: "The float cannot cover one launch." };
}

export function opsStatus(env = process.env) {
  const alert = lowFloatAlert(env);
  return {
    ok: true,
    canPay: treasuryCanPay(env),
    alert: alert ? alert.text : null,
  };
}

export function cronAuthorized(authorization, env = process.env) {
  const secret = env && typeof env.CRON_SECRET === "string" ? env.CRON_SECRET : "";
  if (!secret.trim()) return false;
  const header = typeof authorization === "string" ? authorization : "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  const provided = header.slice(prefix.length);
  const left = Buffer.from(provided);
  const right = Buffer.from(secret);
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
