import { closes, last, position, sma } from '../math.mjs'

export default {
  name: 'sma',
  defaults: { period: 20 },
  minCandles: ({ period }) => period,
  compute(candles, { period }) {
    const value = last(sma(closes(candles), period))
    return { value, signal: position(candles.at(-1).close, value) }
  },
}
