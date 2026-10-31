// OHLCV candles for TA. Two sources, picked by CANDLE_SOURCE:
//   geckoterminal - historical candles from GeckoTerminal (indexes HyperIndex pools)
//   sampler       - candles built in-process from on-chain spot prices
// Candles are { time (unix s), open, high, low, close, volume }, oldest first.

import { NATIVE, USDT, WHSK } from './chain.mjs'
import { config } from './config.mjs'
import { getPrice } from './pricing.mjs'
import { referenceCandles } from './reference.mjs'
import { assets } from './assets.mjs'

export const TIMEFRAMES = {
  '1m': 60, '5m': 300, '15m': 900,
  '1h': 3600, '4h': 14_400, '12h': 43_200,
  '1d': 86_400,
}
const GECKO_TF = {
  '1m': ['minute', 1], '5m': ['minute', 5], '15m': ['minute', 15],
  '1h': ['hour', 1], '4h': ['hour', 4], '12h': ['hour', 12],
  '1d': ['day', 1],
}

// GeckoTerminal skips intervals with no trades; carry the last close forward,
// optionally up to the bucket containing `until` (unix s).
export function fillGaps(candles, step, until) {
  const out = []
  const flat = (time, close) => ({ time, open: close, high: close, low: close, close, volume: 0 })
  for (const c of candles) {
    const prev = out.at(-1)
    if (prev) for (let t = prev.time + step; t < c.time; t += step) out.push(flat(t, prev.close))
    out.push(c)
  }
  const prev = out.at(-1)
  if (prev && until !== undefined) {
    for (let t = prev.time + step; t <= until - (until % step); t += step) out.push(flat(t, prev.close))
  }
  return out
}

const nowSec = () => Math.floor(Date.now() / 1000)

const geckoCache = new Map()

async function gecko(path) {
  const hit = geckoCache.get(path)
  if (hit && Date.now() - hit.at < config.geckoCacheMs) return hit.body
  const res = await fetch(`${config.geckoBaseUrl}${path}`, { headers: { accept: 'application/json' } })
  if (res.status === 429) throw Object.assign(new Error('GeckoTerminal rate limit hit, retry in a minute'), { status: 503 })
  if (!res.ok) throw Object.assign(new Error(`GeckoTerminal ${res.status} for ${path}`), { status: res.status === 404 ? 404 : 502 })
  const body = await res.json()
  geckoCache.set(path, { at: Date.now(), body })
  return body
}

async function geckoCandles(asset, timeframe, limit, preferPool) {
  const token = (asset.address.toLowerCase() === NATIVE.toLowerCase() ? WHSK : asset.address).toLowerCase()
  const noHistory = () => Object.assign(new Error(`GeckoTerminal has no price history for ${asset.symbol}`), { status: 404 })
  const pools = await gecko(`/networks/hashkey/tokens/${token}/pools?page=1`).catch((err) => {
    throw err.status === 404 ? noHistory() : err
  })
  // Prefer the pool the spot price came from, then pools against a core quote
  // (USDT, or WHSK for non-HSK assets), then the deepest.
  const core = [USDT, WHSK].map((a) => a.toLowerCase()).filter((a) => a !== token)
  const rank = (p) =>
    (p.attributes.address.toLowerCase() === preferPool?.toLowerCase() ? 2 : 0) +
    ([p.relationships.base_token.data.id, p.relationships.quote_token.data.id].some((id) => core.some((c) => id.endsWith(c))) ? 1 : 0)
  const pool = [...(pools.data ?? [])].sort(
    (a, b) => rank(b) - rank(a) || Number(b.attributes.reserve_in_usd ?? 0) - Number(a.attributes.reserve_in_usd ?? 0),
  )[0]
  if (!pool) throw noHistory()

  const [unit, aggregate] = GECKO_TF[timeframe]
  const ohlcv = await gecko(
    `/networks/hashkey/pools/${pool.attributes.address}/ohlcv/${unit}?aggregate=${aggregate}&limit=${Math.min(limit, 1000)}&currency=usd&token=${token}`,
  )
  const candles = (ohlcv.data?.attributes?.ohlcv_list ?? [])
    .map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume }))
    .sort((a, b) => a.time - b.time)
  const lastTrade = candles.at(-1)?.time
  return {
    source: 'geckoterminal',
    pool: pool.attributes.address,
    lastTradeAt: lastTrade ? new Date(lastTrade * 1000).toISOString() : null,
    candles: fillGaps(candles, TIMEFRAMES[timeframe], nowSec()).slice(-limit),
  }
}

// --- sampler -------------------------------------------------------------

const samples = new Map() // asset id -> [{ time, price }]
let samplerTimer = null

// Resolves once the first round of samples is in.
export async function startSampler() {
  if (samplerTimer) return
  const tracked = config.samplerAssets.map((id) => assets.find((a) => a.id === id.toLowerCase())).filter(Boolean)
  const tick = async () => {
    for (const asset of tracked) {
      try {
        const { priceUsd } = await getPrice(asset)
        if (priceUsd == null) continue
        const list = samples.get(asset.id) ?? []
        list.push({ time: Math.floor(Date.now() / 1000), price: priceUsd })
        if (list.length > config.samplerMaxPoints) list.shift()
        samples.set(asset.id, list)
      } catch (err) {
        console.error(`sampler: ${asset.id}: ${err.message}`)
      }
    }
  }
  samplerTimer = setInterval(tick, config.samplerIntervalSec * 1000)
  samplerTimer.unref()
  console.log(`sampler: tracking ${tracked.map((a) => a.id).join(', ')} every ${config.samplerIntervalSec}s`)
  await tick()
}

function samplerCandles(asset, timeframe, limit) {
  const list = samples.get(asset.id)
  if (!list?.length) {
    throw Object.assign(new Error(`No samples for ${asset.id}; add it to SAMPLER_ASSETS and wait for data`), { status: 404 })
  }
  const step = TIMEFRAMES[timeframe]
  const buckets = []
  for (const { time, price } of list) {
    const t = time - (time % step)
    const last = buckets.at(-1)
    if (last?.time === t) {
      last.high = Math.max(last.high, price)
      last.low = Math.min(last.low, price)
      last.close = price
    } else {
      buckets.push({ time: t, open: price, high: price, low: price, close: price, volume: 0 })
    }
  }
  return { source: 'sampler', candles: fillGaps(buckets, step, nowSec()).slice(-limit) }
}

export async function getCandles(asset, timeframe = '1h', limit = 200) {
  if (!TIMEFRAMES[timeframe]) {
    throw Object.assign(new Error(`Unknown timeframe ${timeframe}; use ${Object.keys(TIMEFRAMES).join(', ')}`), { status: 400 })
  }
  // Assets with a reference (stocks, BTC) use its market history for TA.
  // Not gap-filled: session gaps (nights, weekends) are normal for stocks.
  if (asset.reference) {
    const candles = await referenceCandles(asset.reference.symbol, timeframe, limit)
    const last = candles.at(-1)?.time
    return {
      source: `${asset.reference.provider}:${asset.reference.symbol}`,
      lastTradeAt: last ? new Date(last * 1000).toISOString() : null,
      candles,
    }
  }
  if (config.candleSource === 'sampler') return samplerCandles(asset, timeframe, limit)
  const price = await getPrice(asset).catch(() => null)
  return geckoCandles(asset, timeframe, limit, price?.pool)
}
