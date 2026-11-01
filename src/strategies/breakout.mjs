// Donchian channel breakout (QuantJourney orders_05 / futures Donchian):
// buy a close above the highest high of the last `entry` candles, exit on a
// close below the lowest low of the last `exit` candles.

export default {
  name: 'breakout',
  description: 'Breakout: buy a new N-candle high (Donchian channel), sell on a new shorter-term low.',
  defaults: { entry: 20, exit: 10 },
  decide({ candles, position, params }) {
    if (candles.length < params.entry + 1) return { reason: `warming up: needs ${params.entry + 1} candles, have ${candles.length}` }
    const prior = candles.slice(0, -1)
    const close = candles.at(-1).close
    const high = Math.max(...prior.slice(-params.entry).map((c) => c.high))
    const low = Math.min(...prior.slice(-params.exit).map((c) => c.low))
    const state = `close ${close}, ${params.entry}-high ${high}, ${params.exit}-low ${low}`
    if (close > high && position === 0) return { side: 'buy', reason: `breakout: ${state}` }
    if (close < low && position > 0) return { side: 'sell', fraction: 1, reason: `breakdown: ${state}` }
    return { reason: `inside channel: ${state}` }
  },
  levels({ candles, params }) {
    // Same windows as decide(): everything before the current candle.
    const prior = candles.slice(0, -1)
    if (prior.length < params.entry) return []
    return [
      { side: 'buy', label: `Buy above ${params.entry}-high`, price: Math.max(...prior.slice(-params.entry).map((c) => c.high)) },
      { side: 'sell', label: `Sell below ${params.exit}-low`, price: Math.min(...prior.slice(-params.exit).map((c) => c.low)) },
    ]
  },
}
