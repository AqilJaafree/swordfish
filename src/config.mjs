// All runtime settings come from env. See .env.example.

const list = (v) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const bool = (v, d = false) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v))
const num = (v, d) => (v === undefined || v === '' ? d : Number(v))

export const config = {
  port: num(process.env.PORT, 8787),
  rpcUrl: process.env.HSK_RPC_URL || 'https://mainnet.hsk.xyz',
  priceCacheMs: num(process.env.PRICE_CACHE_MS, 15_000),
  minLiquidityUsd: num(process.env.MIN_LIQUIDITY_USD, 10),

  candleSource: process.env.CANDLE_SOURCE || 'geckoterminal', // geckoterminal | sampler
  geckoBaseUrl: process.env.GECKO_BASE_URL || 'https://api.geckoterminal.com/api/v2',
  geckoCacheMs: num(process.env.GECKO_CACHE_MS, 60_000),

  // Ignore off-chain references (Yahoo); use HashKey pool data only.
  onchainOnly: bool(process.env.ONCHAIN_ONLY, false),
  referenceCacheMs: num(process.env.REFERENCE_CACHE_MS, 15_000),
  // Simulated cost per side for off-chain reference fills (stocks), in percent.
  referenceCostPct: num(process.env.REFERENCE_COST_PCT, 0.1),

  samplerIntervalSec: num(process.env.SAMPLER_INTERVAL_SEC, 60),
  samplerAssets: list(process.env.SAMPLER_ASSETS || 'hsk'),
  samplerMaxPoints: num(process.env.SAMPLER_MAX_POINTS, 10_000),

  paper: {
    enabled: bool(process.env.PAPER_ENABLED, false),
    startUsdt: num(process.env.PAPER_START_USDT, 1000),
    stateFile: process.env.PAPER_STATE_FILE || 'data/paper-state.json',
    maxImpactPct: num(process.env.PAPER_MAX_IMPACT_PCT, 5),
    // Auto-trading: a strategy name (./strategies/<name>.mjs) or a path. Empty = manual only.
    strategy: process.env.PAPER_STRATEGY || '',
    assets: list(process.env.PAPER_ASSETS || 'hsk'),
    intervalSec: num(process.env.PAPER_INTERVAL_SEC, 300),
    timeframe: process.env.PAPER_TIMEFRAME || '1h',
    tradeUsd: num(process.env.PAPER_TRADE_USD, 10),
  },

  // Multi-user bots (engine.mjs), Telegram (telegram.mjs) and the web dashboard.
  dbFile: process.env.DB_FILE || 'data/swordfish.db',
  bots: {
    enabled: bool(process.env.BOTS_ENABLED, false),
    paperStartUsdt: num(process.env.BOTS_PAPER_START_USDT, 1000),
    maxPerUser: num(process.env.BOTS_MAX_PER_USER, 5),
    maxClaudePerUser: num(process.env.BOTS_MAX_CLAUDE_PER_USER, 2),
    minIntervalSec: num(process.env.BOTS_MIN_INTERVAL_SEC, 60),
    // Live-trading guardrails (a bot can tighten these, never loosen them).
    liveMaxTradeUsd: num(process.env.LIVE_MAX_TRADE_USD, 50),
    liveMaxBudgetUsd: num(process.env.LIVE_MAX_BUDGET_USD, 500),
    liveMaxImpactPct: num(process.env.LIVE_MAX_IMPACT_PCT, 1),
    liveDailyLossPct: num(process.env.LIVE_DAILY_LOSS_PCT, 10),
    minGasHsk: num(process.env.LIVE_MIN_GAS_HSK, 0.5),
  },
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
  webUrl: process.env.WEB_URL || `http://localhost:${num(process.env.PORT, 8787)}`,

  ta: {
    enabled: bool(process.env.TA_ENABLED, false),
    // Built-in names (sma, ema, rsi, macd, bbands) or paths to plugin modules.
    indicators: list(process.env.TA_INDICATORS || 'sma,ema,rsi,macd,bbands'),
  },
}

// <SCOPE>_<NAME>_<PARAM>=value, e.g. TA_RSI_PERIOD=21, PAPER_STRATEGY_BUY_BELOW=30
export function envParamsFor(name, scope = 'TA') {
  const prefix = `${scope}_${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_`
  const params = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith(prefix)) continue
    const key = k.slice(prefix.length).toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase())
    params[key] = Number.isNaN(Number(v)) ? v : Number(v)
  }
  return params
}
