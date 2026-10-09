import { createHash } from "node:crypto";

export function verifyPkce(codeChallenge: string, method: string, verifier: string): boolean {
  if (method !== "S256") return false;
  const digest = createHash("sha256").update(verifier).digest("base64url");
  return digest === codeChallenge;
}
