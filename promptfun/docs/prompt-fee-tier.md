# Creator fees

**Today (pre-$PROMPT mint):** pump.fun creator fees go to the launch fee recipient (`creatorWallet` or claim-later wallet). **100%** of pump.fun creator-fee share; **promptfun platform cut 0%.**

**After $PROMPT mint:** holders (≥ 1 whole $PROMPT in `creatorWallet` at `prepare_launch`) keep **100%**; non-holders **50%** creator / **50%** treasury — enforced only when `PROMPTFUN_PROMPT_MINT` is set and the mint exists on chain.

Full spec: project Context **`docs/prompt-fee-tier-spec.md`**. MCP `get_capabilities` → `limitations` and `launchPlaybook` describe the same policy.
