# Swordfish

Strategy trading bots on **HashKey Chain** (chain 177): live prices from on-chain pools, pluggable technical analysis, paper and real trading, an AI strategy (MiniMax-M3 with fallbacks, or Claude Haiku), a Telegram bot and a web leaderboard.

## Features

- **Prices and swaps**: Uniswap V3 (SwapRouter02), HyperIndex V2 and DODO pools; best route direct or via WHSK/USDT.
- **Technical analysis**: SMA, EMA, RSI, MACD and Bollinger Bands as plugins (`TA_INDICATORS`).
- **Strategies** (`src/strategies/`): `sma-cross`, `macd-trend`, `bollinger-reversion`, `breakout`, `rsi-reversion` and `claude` (an AI model decides from the indicators, pool price and trading cost). Every bot can add a stop loss, take profit, trailing stop and drawdown halt.
- **One-sided liquidity** (`lp-range`, `src/lp.mjs`): deposits the bot's USDT in a Uniswap V3 range just below the price, which buys as the price falls through it and earns the 0.3% pool fee. Once filled, the coin goes into a range above the entry to sell back (`cycle=1`), and a USDT range left far below a rising price is moved up (`recenterPct`). Params: `rangeWidthPct`, `offsetPct`, `recenterPct`, `cycle`, `stopLossPct`. Live positions are NFTs from the NonfungiblePositionManager `0xDF0A9b833Db0E4CeEa103A4408f3B68e7FC0cad5`.
- **Bots**: each Telegram user gets a custodial wallet (keys encrypted with AES-256-GCM) and can run up to 5 bots, in paper mode or live with real funds.
- **Dashboard**: leaderboard (P&L % after costs, paper and live ranked separately), your wallet and bots, and the strategy catalog.

## Quick start

```bash
npm install
cp .env.example .env      # fill in TELEGRAM_BOT_TOKEN, MASTER_KEY, ANTHROPIC_API_KEY
npm test
BOTS_ENABLED=true npm start
```

Open http://localhost:8787 for the landing page and http://localhost:8787/app for the dashboard. Once you've opened the dashboard, `/` takes you straight to it; the landing page stays at `/landing`, and the dashboard sidebar links back to it. In Telegram, send `/start` to your bot to get a wallet, then `/web` for a one-time dashboard login link.

The cinematic landing page is the home page (also at `/landing`). The hero is an original eight-second Blender render of the Swordfish mark in titanium, opening into engineered layers and reassembling under moving studio light. The editable scene and generator are in `design/metallic-hero/`. Select a scene to pause and inspect it, or use the play/pause control. Playback pauses offscreen and respects reduced-motion settings, with a still poster as the fallback. The dashboard is at `/app`.

To preview the landing page independently, run `npm run landing` and open http://localhost:8788/landing. App links lead to the dashboard on port 8787. Set `LANDING_PORT` or `LANDING_APP_URL` to override those defaults.

Sections enter with staggered heading, card, chart, and software-layer animations. Entrances replay only after leaving the viewport completely, preserve native scrolling, and show all content immediately when animations are paused or reduced motion is enabled.

## Telegram commands

| Command | |
|---|---|
| `/wallet` | Wallet address and balances |
| `/strategies` | Available strategies and parameters |
| `/newbot sma-cross btc,eth 1h stopLossPct=5` | Create a paper bot |
| `/newbot lp-range btc 1h` | Paper bot providing USDT-only liquidity on the BTC pool |
| `/bots`, `/bot <id>` | Your bots, details and recent trades |
| `/stop`, `/resume`, `/close <id>` | Pause, resume, or sell everything and stop |
| `/live <id> <budget>` | Switch a bot to real funds (asks for confirmation) |
| `/leaderboard [live]` | Top bots |
| `/withdraw <asset> <amount\|max> <address>` | Send funds out of your bot wallet (funds used by running live bots stay) |
| `/withdraw all <address>` | Send everything out: tokens first, then HSK minus gas |
| `/deletebot <id>` | Delete a bot and its history (close live positions first) |
| `/importwallet <privateKey>` | Use your own wallet; the message with the key is deleted at once |
| `/deletewallet` | Delete the bot wallet once it is empty and has no live bots |
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
