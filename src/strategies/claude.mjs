// LLM strategy: an AI model reads the TA snapshot and decides buy / sell / hold.
// The model only proposes; sizes are clamped here and fills still go through
// the paper engine's live quotes and impact limit.
//
// Models are tried in order. One that fails (rate or usage limit, server error, timeout,
// unreadable answer) is skipped for a cooldown and the next is asked; if all fail, the bot holds.
//
// Env:
//   MINIMAX_API_KEY                     MiniMax subscription key (Anthropic-compatible API)
//   MINIMAX_BASE_URL=https://api.minimax.io/anthropic
//   ANTHROPIC_API_KEY                   adds Claude Haiku as the last fallback
//   AI_MODELS=minimax:MiniMax-M3,...    override the chain (provider:model, comma-separated)
//   PAPER_STRATEGY_MODEL=…              put one model first (e.g. MiniMax-M3.1-Flash)
//   PAPER_STRATEGY_EFFORT=low           low | medium | high (Claude only)
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

// Providers without structured outputs get the schema in words and are validated with Decision.
const JSON_ONLY = `

Reply with ONLY a JSON object, no prose and no code fences:
{"action":"buy"|"sell"|"hold","confidence":0-1,"usdt":number,"fraction":number,"reason":"one sentence citing the indicators used"}`

const TIMEOUT_MS = 45_000
const providers = {
  minimax: process.env.MINIMAX_API_KEY
    ? new Anthropic({ apiKey: process.env.MINIMAX_API_KEY, baseURL: process.env.MINIMAX_BASE_URL || 'https://api.minimax.io/anthropic', timeout: TIMEOUT_MS, maxRetries: 0 })
    : null,
  anthropic: process.env.ANTHROPIC_API_KEY ? new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 0 }) : null,
}

// The chain, best first: MiniMax (subscription) models, then Claude Haiku if its key is set.
const DEFAULT_CHAIN = [
  ['minimax', 'MiniMax-M3'],
  ['minimax', 'MiniMax-M3.1-Flash'],
  ['minimax', 'MiniMax-M2.7-highspeed'],
  ['anthropic', 'claude-haiku-5-5'],
]
const chain = (process.env.AI_MODELS ? process.env.AI_MODELS.split(',').map((m) => m.trim().split(':')) : DEFAULT_CHAIN).filter(([p]) => providers[p])

// USD per million tokens (input, output) for cost tracking; MiniMax runs on a flat subscription.
const PRICES = { 'claude-haiku-5-5': [0.1, 0.5] }
const usage = { calls: 0, fallbacks: 0, failures: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, byModel: {} }

// Models that just failed are skipped until their cooldown ends.
const coolUntil = new Map()
function cooldownMs(err) {
  const status = err?.status
  if (status === 429) return 60_000 // rate limit
  if ([401, 402, 403].includes(status)) return 10 * 60_000 // key, quota or balance problem
  return 30_000 // server error, timeout, network, unreadable answer
}

// First JSON object in a reply (tolerates code fences or stray text around it).
function parseDecision(text) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = Decision.safeParse(JSON.parse(text.slice(start, end + 1)))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

async function ask([provider, model], snapshot, params) {
  const client = providers[provider]
  if (provider === 'anthropic') {
    const res = await client.messages.parse({
      model,
      max_tokens: 2000,
      output_config: { effort: params.effort, format: zodOutputFormat(Decision) },
      system: SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(snapshot) }],
    })
    if (res.stop_reason === 'refusal') throw Object.assign(new Error(`refused (${res.stop_details?.category ?? 'unknown'})`), { refusal: true })
    return { decision: res.parsed_output, usage: res.usage }
  }
  const res = await client.messages.create({
    model,
    max_tokens: 2000,
    system: SYSTEM + JSON_ONLY,
    messages: [{ role: 'user', content: JSON.stringify(snapshot) }],
  })
  const text = res.content.filter((c) => c.type === 'text').map((c) => c.text).join('')
  return { decision: parseDecision(text), usage: res.usage }
}

const label = ([, model]) => model
export const activeModels = () => chain.map(label)

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
  description: chain.length
    ? `AI (${label(chain[0])}) reads the indicators, pool price and trading cost each interval and decides buy, sell or hold. Falls back to ${chain.length - 1} other model${chain.length === 2 ? '' : 's'} on limits or errors.`
    : 'AI reads the indicators, pool price and trading cost each interval and decides buy, sell or hold. Needs MINIMAX_API_KEY or ANTHROPIC_API_KEY.',
  requires: ['rsi'],
  defaults: { model: chain[0]?.[1] ?? null, effort: 'low', minConfidence: 0.6, maxPositionUsd: 50, closes: 30 },
  modelLabel: () => (chain[0] ? label(chain[0]) : null),
  stats: () => ({ ai: { ...usage, costUsd: Number(usage.costUsd.toFixed(6)), chain: activeModels() } }),

  // `key` scopes the skip-unchanged memory per bot and asset; tradeUsd and
  // timeframe come from the bot when run by the engine.
  async decide({ asset, price, ta, candles, position, costBasisUsd, cashUsdt, params, key = asset.id, timeframe = config.paper.timeframe }) {
    if (!chain.length) return { reason: 'no AI model configured (set MINIMAX_API_KEY or ANTHROPIC_API_KEY); hold' }
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

    // A model named in the bot's params goes first; the rest of the chain follows as fallbacks.
    const order = [...chain].sort((a, b) => (b[1] === params.model) - (a[1] === params.model))
    const failed = []
    let d = null
    let used = null
    for (const m of order) {
      const name = label(m)
      if ((coolUntil.get(name) ?? 0) > Date.now()) {
        failed.push(`${name} cooling down`)
        continue
      }
      try {
        const res = await ask(m, snapshot, params)
        const stats = (usage.byModel[name] ??= { calls: 0, failures: 0 })
        stats.calls++
        usage.calls++
        usage.inputTokens += res.usage?.input_tokens ?? 0
        usage.outputTokens += res.usage?.output_tokens ?? 0
        const [inPrice, outPrice] = PRICES[m[1]] ?? [0, 0]
        usage.costUsd += ((res.usage?.input_tokens ?? 0) * inPrice + (res.usage?.output_tokens ?? 0) * outPrice) / 1e6
        if (!res.decision) throw Object.assign(new Error('unreadable answer'), { unreadable: true })
        d = res.decision
        used = name
        break
      } catch (err) {
        if (!(err instanceof Anthropic.APIError || err instanceof Anthropic.APIConnectionError || err.unreadable || err.refusal)) throw err
        coolUntil.set(name, Date.now() + cooldownMs(err))
        ;(usage.byModel[name] ??= { calls: 0, failures: 0 }).failures++
        failed.push(`${name} ${err.status ?? ''} ${err.unreadable || err.refusal ? err.message : err.constructor?.name ?? err.name}`.replace(/\s+/g, ' ').trim())
      }
    }
    if (failed.length && used) usage.fallbacks++
    if (!d) {
      usage.failures++
      return { reason: `all AI models unavailable (${failed.join('; ')}); hold` }
    }

    lastKey.set(key, inputs)
    const via = failed.length ? `${used}, after ${failed.join('; ')}` : used
    const summary = `${d.action} (conf ${d.confidence.toFixed(2)}, ${via}): ${d.reason}`
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
