// Trend following on a moving-average crossover (QuantJourney orders_01 /
// weights_09): hold while SMA(fast) > SMA(slow), go to cash when it flips.

import { closes, sma } from '../ta/math.mjs'

export default {
  name: 'sma-cross',
  description: 'Trend: buy when the fast SMA crosses above the slow SMA, sell when it crosses back below.',
  defaults: { fast: 10, slow: 30 },
  decide({ candles, position, params }) {
    const c = closes(candles)
    if (c.length < params.slow + 1) return { reason: `warming up: needs ${params.slow + 1} candles, have ${c.length}` }
    const fast = sma(c, params.fast).at(-1)
    const slow = sma(c, params.slow).at(-1)
    const state = `SMA${params.fast} ${fast.toFixed(4)} vs SMA${params.slow} ${slow.toFixed(4)}`
    if (fast > slow && position === 0) return { side: 'buy', reason: `uptrend: ${state}` }
    if (fast < slow && position > 0) return { side: 'sell', fraction: 1, reason: `downtrend: ${state}` }
    return { reason: `${fast > slow ? 'uptrend' : 'downtrend'}, hold: ${state}` }
  },
}
