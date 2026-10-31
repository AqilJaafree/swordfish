import { closes } from '../math.mjs'

// Wilder's RSI.
export default {
  name: 'rsi',
  defaults: { period: 14, overbought: 70, oversold: 30 },
  minCandles: ({ period }) => period + 1,
  compute(candles, { period, overbought, oversold }) {
    const c = closes(candles)
    let gain = 0
    let loss = 0
    for (let i = 1; i <= period; i++) {
      const d = c[i] - c[i - 1]
      if (d > 0) gain += d
      else loss -= d
    }
    gain /= period
    loss /= period
    for (let i = period + 1; i < c.length; i++) {
      const d = c[i] - c[i - 1]
      gain = (gain * (period - 1) + Math.max(d, 0)) / period
      loss = (loss * (period - 1) + Math.max(-d, 0)) / period
    }
    const value = loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss)
    return { value, signal: value >= overbought ? 'overbought' : value <= oversold ? 'oversold' : 'neutral' }
  },
}
