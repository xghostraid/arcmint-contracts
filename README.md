# arcmint contracts

Open-source Solidity for **arcmint.fun** (Arc Network launchpad).

**License:** MIT · **Testnet:** chain `5042002` · **Explorer:** https://testnet.arcscan.app  
**Product trust page:** https://arcmint.fun/about  

## v4 anti-rug stack (current)

| Role | Address |
|------|---------|
| Launch factory | `0x7b46A92585E118386D3C29701B55AD8455f97723` |
| FeeRouter | `0x92A6bB7E2592A330764332d40Ea1B98Bbd4b0Cc4` |
| GraduationMigrator | `0x0eD39838177998DE68b53816617B42c8687D3277` |
| Curve impl | `0xEc82eeD2c336B3667e25b4a5A564C55c28A18197` |
| ArcSwap factory | `0xF30A8670E350cA4292e2D924454BD5046D7d8Cd0` |
| ArcSwap router | `0x2C1a1e2246DcfD1988c957dF715843848ea4F1f9` |
| LiquidityLocker | `0xFFb42977299CC4ce747A1635ae09a2F61CD473C5` |

### Guards

- **Anti-snipe:** 60s after launch, max 2% of `tokensForSale` per buy
- **Creator buy cap:** max 5% of sale supply from creator address
- **Creator sold flag:** `creatorHasSold` on pool when creator sells
- **Creator fee vest:** claim after graduation (or 14-day fallback)

### Fees

1% platform · 0–5% creator · 0.5% graduation

## Catalog app (`web/`)

Reads launches from the live factory `0x0F5d0D0271068568134Fa2ca834756f34C485901` with `launchCount` + `launchByIndex`. Create calls `createLaunch` directly (no IPFS required). After the tx lands, `/api/tx/wait` confirms and Live polls `launchCount` every 2s so every new token appears. Token pages can buy/sell on the curve.

```bash
cd web
npm install
npm run check:catalog   # lists live Arc Mainnet launches
npm run dev             # http://localhost:3000
```

Vercel: set the project **Root Directory** to `web/` and redeploy. That is the app that should serve arcmint.fun.

## Tests

```bash
forge test
```

## Disclaimer

Testnet software. Not financial advice.
