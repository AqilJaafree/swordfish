# Swordfish

Strategy trading bots on **HashKey Chain** (chain 177): live prices from on-chain pools, pluggable technical analysis, paper and real trading, a Claude Haiku strategy, a Telegram bot and a web leaderboard.

## Features

- **Prices and swaps**: Uniswap V3 (SwapRouter02), HyperIndex V2 and DODO pools; best route direct or via WHSK/USDT.
- **Technical analysis**: SMA, EMA, RSI, MACD and Bollinger Bands as plugins (`TA_INDICATORS`).
- **Strategies** (`src/strategies/`): `sma-cross`, `macd-trend`, `bollinger-reversion`, `breakout`, `rsi-reversion` and `claude` (Claude Haiku decides from the indicators, pool price and trading cost). Every bot can add a stop loss, take profit, trailing stop and drawdown halt.
- **Bots**: each Telegram user gets a custodial wallet (keys encrypted with AES-256-GCM) and can run up to 5 bots, in paper mode or live with real funds.
- **Dashboard**: leaderboard (P&L % after costs, paper and live ranked separately), your wallet and bots, and the strategy catalog.

## Quick start

```bash
npm install
cp .env.example .env      # fill in TELEGRAM_BOT_TOKEN, MASTER_KEY, ANTHROPIC_API_KEY
npm test
BOTS_ENABLED=true npm start
```

Open the dashboard at http://localhost:8787. In Telegram, send `/start` to your bot to get a wallet, then `/web` for a one-time dashboard login link.

## Telegram commands

| Command | |
|---|---|
| `/wallet` | Wallet address and balances |
| `/strategies` | Available strategies and parameters |
| `/newbot sma-cross btc,eth 1h stopLossPct=5` | Create a paper bot |
| `/bots`, `/bot <id>` | Your bots, details and recent trades |
| `/stop`, `/resume`, `/close <id>` | Pause, resume, or sell everything and stop |
| `/live <id> <budget>` | Switch a bot to real funds (asks for confirmation) |
| `/leaderboard [live]` | Top bots |
| `/withdraw <asset> <amount> <address>` | Send funds out of your bot wallet |
| `/export` | Reveal the wallet key (auto-deletes after 60s) |

## Live trading safeguards

- New bots always start on paper; going live needs `/live <id> <budget> confirm`.
- Limits per trade, per budget, on price impact, and on daily loss (bots halt automatically); all set in `.env`.
- Swaps go only to SwapRouter02 `0x2c16f75b95Cf1390c328aB70e2CEE7f4b80bD8F3` with a slippage minimum and deadline.
- Wallet keys are only decrypted in memory to sign. Back up `MASTER_KEY`: without it, stored wallets cannot be recovered.

Holding keys and trading for other people can be a regulated activity. Check the rules where you operate before opening this to the public.

## Swap CLI

```bash
npm run quote:v3 -- --from HSK --to USDT --amount 100
npm run swap:v3  -- --from USDT --to ETH --amount 5 --slippage 0.5   # needs PRIVATE_KEY
```

## API

`src/server.mjs` lists every route: asset prices, candles and TA (`/assets/:id/...`), single-account paper trading (`/paper/...`), and the bot API (`/api/...`).
