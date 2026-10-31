// LLM strategy: Claude reads the TA snapshot and decides buy / sell / hold.
// The model only proposes; sizes are clamped here and fills still go through
// the paper engine's live quotes and impact limit.
//
// Env:
//   ANTHROPIC_API_KEY                   (or any credential the SDK resolves)
//   PAPER_STRATEGY_MODEL=claude-haiku-5-5
//   PAPER_STRATEGY_EFFORT=low           low | medium | high
//   PAPER_STRATEGY_MIN_CONFIDENCE=0.6   ignore buy/sell below this
//   PAPER_STRATEGY_MAX_POSITION_USD=50
//   PAPER_STRATEGY_CLOSES=30            recent closes sent with the snapshot

import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { findAsset } from '../assets.mjs'
import { config } from '../config.mjs'
import { quoteOrder } from '../execution.mjs'

const Decision = z.object({
  action: z.enum(['buy', 'sell', 'hold']),
  confidence: z.number().describe('0 to 1'),
  usdt: z.number().describe('USDT to spend when buying; 0 otherwise'),
  fraction: z.number().describe('Fraction of the position to sell (0-1] when selling; 0 otherwise'),
  reason: z.string().describe('One sentence, citing the indicators used'),
})

const SYSTEM = `You are the decision step of a paper-trading bot.
Each call gives one asset's live snapshot: venue, mid price, technical indicators, recent closes, the measured round-trip cost, the current position and cash.
Decide buy, sell, or hold for this interval.

Venues:
- "hashkey-onchain": filled against HashKey Chain DEX pools. Fills include pool fees and price impact.
  When candleSource is a reference market (e.g. "yahoo:BTC-USD"), that market is deeper and more accurate than the pool: treat its indicators as the primary signal, not as a reason for doubt.
  The pool trades rarely, so midPriceUsd can lag the reference (compare it with the last of recentCloses). Buying below or selling above the reference price works in your favour.
- "reference-simulated": a stock with no on-chain liquidity, filled at the live market quote less a fixed cost.

Judgement:
- roundTripCostPct is what an immediate buy-then-sell at maxBuyUsdt would lose. Only trade when the expected move clearly exceeds it.
- Flat or gap-filled data is not a signal; hold. Treat a "warning" field as reduced reliability.

Rules:
- Never buy more than maxBuyUsdt; never sell more than the position.
- Prefer hold when signals conflict or data is thin.
- Report confidence honestly; low-confidence trades are discarded.`

const client = new Anthropic()
const usage = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }
// USD per million tokens (input, output) for cost tracking.
const PRICES = { 'claude-haiku-5-5': [0.1, 0.5] }

// Buy `usdt` worth and sell it straight back; the loss is the trading hurdle.
async function measureRoundTrip(asset, usdt) {
  try {
    const usdtAsset = findAsset('usdt')
    const buy = await quoteOrder(asset, usdtAsset, 'buy', usdt)
    const sell = await quoteOrder(asset, usdtAsset, 'sell', buy.amountOut)
    return Number(((1 - sell.amountOut / usdt) * 100).toFixed(3))
  } catch {
    return null
  }
}

const lastKey = new Map() // bot/asset key -> serialized inputs of the last call
const lastDecision = new Map()

export default {
  name: 'claude',
  description: 'Claude Haiku reads the indicators, pool price and trading cost each interval and decides buy, sell or hold.',
  requires: ['rsi'],
  defaults: { model: 'claude-haiku-5-5', effort: 'low', minConfidence: 0.6, maxPositionUsd: 50, closes: 30 },
  stats: () => ({ claude: { ...usage, costUsd: Number(usage.costUsd.toFixed(6)) } }),

  // `key` scopes the skip-unchanged memory per bot and asset; tradeUsd and
  // timeframe come from the bot when run by the engine.
  async decide({ asset, price, ta, candles, position, costBasisUsd, cashUsdt, params, key = asset.id, timeframe = config.paper.timeframe }) {
    if (price.marketOpen === false) return { reason: `market closed (last trade ${price.marketTime}); hold` }
    if (ta.rsi?.value == null) return { reason: `warming up: ${ta.rsi?.note ?? 'no RSI'}` }

    const positionUsd = position * (price.priceUsd ?? 0)
    const tradeUsd = params.tradeUsd ?? config.paper.tradeUsd
    const maxBuyUsdt = Math.max(0, Math.min(tradeUsd, params.maxPositionUsd - positionUsd, cashUsdt))
    const roundTripCostPct = await measureRoundTrip(asset, maxBuyUsdt || tradeUsd)
    const snapshot = {
      asset: asset.symbol,
      venue: asset.reference?.fills ? 'reference-simulated' : 'hashkey-onchain',
      priceSource: price.source,
      candleSource: asset.reference ? `${asset.reference.provider}:${asset.reference.symbol}` : config.candleSource,
      timeframe,
      midPriceUsd: price.priceUsd,
      ...(price.liquidityUsd !== undefined && { poolLiquidityUsd: price.liquidityUsd }),
      roundTripCostPct,
      ...(price.warning && { warning: price.warning }),
      indicators: Object.fromEntries(Object.entries(ta).map(([k, v]) => [k, (({ params: _, ...rest }) => rest)(v)])),
      recentCloses: candles.slice(-params.closes).map((c) => c.close),
      position: { quantity: position, valueUsd: positionUsd, costBasisUsd },
      cashUsdt,
      maxBuyUsdt,
    }

    // Skip the call when nothing changed since the last one (flat markets).
    const { recentCloses, ...rest } = snapshot
    const inputs = JSON.stringify({ ...rest, last: recentCloses.at(-1) })
    if (lastKey.get(key) === inputs) return { reason: `unchanged inputs; ${lastDecision.get(key) ?? 'hold'}` }

    let response
    try {
      response = await client.messages.parse({
        model: params.model,
        max_tokens: 2000,
        output_config: { effort: params.effort, format: zodOutputFormat(Decision) },
        system: SYSTEM,
        messages: [{ role: 'user', content: JSON.stringify(snapshot) }],
      })
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) return { reason: 'claude rate limited; hold' }
      if (err instanceof Anthropic.APIError) return { reason: `claude API error ${err.status}: ${err.message}; hold` }
      throw err
    }

    const [inPrice, outPrice] = PRICES[params.model] ?? [0, 0]
    usage.calls++
    usage.inputTokens += response.usage.input_tokens
    usage.outputTokens += response.usage.output_tokens
    usage.costUsd += (response.usage.input_tokens * inPrice + response.usage.output_tokens * outPrice) / 1e6

    if (response.stop_reason === 'refusal') return { reason: `claude refused (${response.stop_details?.category ?? 'unknown'}); hold` }
    const d = response.parsed_output
    if (!d) return { reason: `claude returned no parsable decision (stop ${response.stop_reason}); hold` }

    lastKey.set(key, inputs)
    const summary = `${d.action} (conf ${d.confidence.toFixed(2)}): ${d.reason}`
    lastDecision.set(key, summary)

    if (d.action === 'hold' || d.confidence < params.minConfidence) {
      return { reason: d.action === 'hold' ? summary : `below min confidence ${params.minConfidence}; ${summary}` }
    }
    if (d.action === 'buy') {
      const usdt = Math.min(d.usdt > 0 ? d.usdt : maxBuyUsdt, maxBuyUsdt)
      return usdt > 0.01 ? { side: 'buy', usdt, reason: summary } : { reason: `no buy room; ${summary}` }
    }
    if (position <= 0) return { reason: `nothing to sell; ${summary}` }
    return { side: 'sell', fraction: Math.min(Math.max(d.fraction, 0.01), 1), reason: summary }
  },
}
