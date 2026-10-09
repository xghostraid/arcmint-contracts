# Connect promptfun to Claude

Add `https://your-domain/mcp` as a custom connector (no auth). Then use short prompts — no tool names required.

Examples:

- Launch TEST on mainnet
- Launch Moonbeam BEAM on mainnet with this photo.
- Launch tes test with this image

Claude reads `launchPlaybook` from `get_capabilities`, imports chat images automatically, calls `prepare_launch`, and shows **Launch it** on the card → `get_action_status`.

Production default: **Solana mainnet** pump.fun with sponsored launch (no wallet) when `PROMPTFUN_ENABLE_PUMPFUN_MAINNET=1`, `PROMPTFUN_ENABLE_SPONSORED_LAUNCHES=1`, and `PROMPTFUN_ENABLE_SPONSORED_MAINNET=1`, with mainnet SOL on the sponsor fee-payer wallet. Devnet remains for optional testing.
