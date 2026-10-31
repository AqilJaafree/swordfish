// Off-chain reference prices from Yahoo Finance's public chart API.
// Used for assets whose HashKey tokens have no liquidity (NVDA, AAPL) and for
// TA candles where the on-chain market has no history (BTC).

import { config } from './config.mjs'

const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart'

// timeframe -> [yahoo interval, range, seconds per bucket]
const TF = {
  '1m': ['1m', '1d', 60],
  '5m': ['5m', '5d', 300],
  '15m': ['15m', '5d', 900],
  '1h': ['60m', '1mo', 3600],
  '4h': ['60m', '3mo', 14_400],
  '12h': ['60m', '6mo', 43_200],
  '1d': ['1d', '1y', 86_400],
}

const cache = new Map()

async function chart(symbol, interval, range) {
  const key = `${symbol}|${interval}|${range}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < config.referenceCacheMs) return hit.body
  const res = await fetch(`${BASE}/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`, {
    headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json' },
  })
  if (!res.ok) throw Object.assign(new Error(`Yahoo ${res.status} for ${symbol}`), { status: res.status === 404 ? 404 : 502 })
  const body = (await res.json()).chart?.result?.[0]
  if (!body) throw Object.assign(new Error(`Yahoo returned no data for ${symbol}`), { status: 502 })
  cache.set(key, { at: Date.now(), body })
  return body
}

export async function referenceQuote(symbol) {
  const { meta } = await chart(symbol, '1m', '1d')
  const now = Date.now() / 1000
  const regular = meta.currentTradingPeriod?.regular
  // Crypto (e.g. BTC-USD) trades around the clock.
  const marketOpen = meta.instrumentType === 'CRYPTOCURRENCY' || (regular ? now >= regular.start && now < regular.end : false)
  return {
    price: meta.regularMarketPrice,
    marketTime: new Date(meta.regularMarketTime * 1000).toISOString(),
    marketOpen,
  }
}

export async function referenceCandles(symbol, timeframe, limit) {
  const [interval, range, step] = TF[timeframe]
  const body = await chart(symbol, interval, range)
  const q = body.indicators?.quote?.[0] ?? {}
  const raw = (body.timestamp ?? [])
    .map((t, i) => ({ time: t, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i] ?? 0 }))
    .filter((c) => c.close != null)

  // Aggregate when the timeframe is coarser than Yahoo's interval (4h, 12h).
  const out = []
  for (const c of raw) {
    const t = c.time - (c.time % step)
    const last = out.at(-1)
    if (last?.time === t) {
      last.high = Math.max(last.high, c.high)
      last.low = Math.min(last.low, c.low)
      last.close = c.close
      last.volume += c.volume
    } else {
      out.push({ ...c, time: t })
    }
  }
  return out.slice(-limit)
}
