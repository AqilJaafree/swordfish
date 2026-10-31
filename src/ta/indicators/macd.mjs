import { closes, ema } from '../math.mjs'

export default {
  name: 'macd',
  defaults: { fast: 12, slow: 26, signal: 9 },
  minCandles: ({ slow, signal }) => slow + signal,
  compute(candles, params) {
    const c = closes(candles)
    const fast = ema(c, params.fast)
    const slow = ema(c, params.slow)
    const line = c.map((_, i) => (fast[i] == null || slow[i] == null ? null : fast[i] - slow[i]))
    const signalLine = ema(line, params.signal)
    // Ignore float noise on flat series (relative to price).
    const eps = Math.abs(c.at(-1)) * 1e-9
    const clean = (x) => (Math.abs(x) < eps ? 0 : x)
    const macd = clean(line.at(-1))
    const signal = clean(signalLine.at(-1))
    const histogram = clean(macd - signal)
    const prevHist = clean(line.at(-2) - signalLine.at(-2))
    let cross = null
    if (prevHist <= 0 && histogram > 0) cross = 'bullish-cross'
    else if (prevHist >= 0 && histogram < 0) cross = 'bearish-cross'
    return {
      value: macd,
      signalLine: signal,
      histogram,
      signal: cross ?? (histogram > 0 ? 'bullish' : histogram < 0 ? 'bearish' : 'neutral'),
    }
  },
}
