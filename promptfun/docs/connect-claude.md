# Connect promptfun to Claude

Add `https://your-domain/mcp` as a custom connector (no auth). See `prepare_launch` → **Launch it** on the card → `get_action_status`.

Production default: **Solana mainnet** pump.fun with sponsored launch (no wallet) when `PROMPTFUN_ENABLE_PUMPFUN_MAINNET=1`, `PROMPTFUN_ENABLE_SPONSORED_LAUNCHES=1`, and `PROMPTFUN_ENABLE_SPONSORED_MAINNET=1`, with mainnet SOL on the sponsor fee-payer wallet. Devnet remains for optional testing.
