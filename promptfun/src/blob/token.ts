/** Vercel Blob read/write token for cross-instance storage (intents, pictures, handoffs). */
export function blobReadWriteToken(env: NodeJS.ProcessEnv): string | null {
  const fromVercel = env.BLOB_READ_WRITE_TOKEN?.trim();
  if (fromVercel) return fromVercel;
  const alias = env.PROMPTFUN_BLOB_READ_WRITE_TOKEN?.trim();
  return alias || null;
}

/** Non-fatal startup notice when serverless cross-instance features are disabled. */
export function logBlobStorageStartup(env: NodeJS.ProcessEnv, log: Pick<Console, "warn"> = console): void {
  if (blobReadWriteToken(env)) return;
  log.warn(
    "[promptfun] BLOB_READ_WRITE_TOKEN is unset — cross-instance intents, pictures, panel handoffs, and explore rehydration from Blob are disabled (non-fatal). On Vercel promptfun-mcp, link the Blob store (promptfun-pictures) so prepare_launch → confirm_launch and /api/coins survive cold starts.",
  );
}
