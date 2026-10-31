import { closes, position, sma, stddev } from '../math.mjs'

// Bollinger Bands.
export default {
  name: 'bbands',
  defaults: { period: 20, mult: 2 },
  minCandles: ({ period }) => period,
  compute(candles, { period, mult }) {
    const c = closes(candles)
    const middle = sma(c, period).at(-1)
    const sd = stddev(c, period).at(-1)
    const upper = middle + mult * sd
    const lower = middle - mult * sd
    const price = c.at(-1)
    const percentB = upper === lower ? 0.5 : (price - lower) / (upper - lower)
    return {
      value: middle,
      upper,
      lower,
      percentB,
      signal:
        position(price, upper) === 'above' ? 'above-upper' : position(price, lower) === 'below' ? 'below-lower' : 'inside',
    }
  },
}
