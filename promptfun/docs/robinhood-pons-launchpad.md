# Robinhood Chain launches via pons

Robinhood Chain mainnet (chainId **4663**, MCP chain key `robinhood`) uses the same launch product as [pons launchpad](https://www.ponsfamily.com/launchpad/).

## MCP flow

1. User imports a coin image (same as Solana pump.fun).
2. `prepare_launch` with `chain: robinhood` (venue defaults to **`pons`**).
3. User opens the approval link and signs **`launchAndBuy`** on the Pons V2 router (`0xe33e9e479df8802cb0866d5d05258bec4cf62948`).
4. `get_action_status` returns explorer links and **`https://www.ponsfamily.com/token/<address>`**.

Optional: `initialBuyEth` (e.g. `"0.01"`) adds a creator first buy into the new bonding curve.

Robinhood Chain **Testnet** still uses plain **`erc20`** deploy (`venue: erc20`) for the proven 2026-10-09 adapter path.

## On-chain integration

promptfun builds calldata directly (no third-party tx builder):

- Factory: `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` (`launchEnabled` must be true)
- Router: `0xe33e9e479df8802cb0866d5d05258bec4cf62948`
- Fixed supply: **1,000,000,000** tokens, **18** decimals
- Launch fee: **0.0005 ETH** (read from factory at preview time)
- `expectedEconomics` from `previewLaunchEconomics(launchConfigId, pairToken)`

Override addresses with `PROMPTFUN_PONS_*` env vars (see `.env.example`).

## Pons Launch API (optional)

`POST https://api.ponsfamily.com/v1/launches` exists for agentic launches but requires an **API key** (`{"error":"unauthorized","reason":"an API key is required"}` without one). promptfun’s default path is **wallet-signed on-chain** launches, matching the approval page UX.

For partnership/API access, contact pons at contact@ponsfamily.com.

## Feature flag

Set **`PROMPTFUN_ENABLE_ROBINHOOD_MAINNET=1`** on the MCP server. EVM gas is never sponsored.
