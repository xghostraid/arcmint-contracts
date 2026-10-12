# Creator fees

**Until $PROMPT is live:** pump.fun creator fees lock **on chain** to the promptfun official treasury wallet (100%). We still collect `creatorWallet` at `prepare_launch` for manual payout ops. **promptfun takes 0% platform cut.**

**After $PROMPT is live:** ≥1 whole $PROMPT in `creatorWallet` at prepare_launch → 100% creator on chain; else 50% creator / 50% treasury.

Full spec: **`docs/prompt-fee-tier-spec.md`** (mirrors project Context).

MCP `get_capabilities` → `limitations` and `launchPlaybook` describe the same policy.
