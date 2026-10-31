import { closes, ema, last, position } from '../math.mjs'

export default {
  name: 'ema',
  defaults: { period: 20 },
  minCandles: ({ period }) => period,
  compute(candles, { period }) {
    const value = last(ema(closes(candles), period))
    return { value, signal: position(candles.at(-1).close, value) }
  },
}
