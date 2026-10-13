# Creator fees

**$PROMPT is live** (`385pCEMj4T1rTp2vgCVxmuUR2zTTmqkV6Yu3U96Fpump` on pump.fun). At `prepare_launch`, ≥1 whole $PROMPT in `creatorWallet` → **100%** creator on chain; else **50%** creator / **50%** promptfun treasury (`5YPhpDDtYtKaKnUgSskb4tXKZL9a7rj8siCuMS7qESpv`). **promptfun takes 0% platform cut.**

If the mint env is disabled or the mint is missing on chain, fees still lock **100%** to treasury (legacy pre-mint behavior).

Full spec: **`docs/prompt-fee-tier-spec.md`** (mirrors project Context).

MCP `get_capabilities` → `limitations` and `launchPlaybook` describe the same policy.
