// Mean reversion on RSI: buy when oversold, sell the position when overbought
// (QuantJourney orders_02 uses 35/60).
// Params: PAPER_STRATEGY_BUY_BELOW, PAPER_STRATEGY_SELL_ABOVE, PAPER_STRATEGY_MAX_POSITION_USD

export default {
  name: 'rsi-reversion',
  description: 'Mean reversion: buy when RSI is oversold, sell when it is overbought.',
  requires: ['rsi'],
  defaults: { buyBelow: 30, sellAbove: 70, maxPositionUsd: 50 },
  decide({ price, ta, position, params }) {
    const rsi = ta.rsi?.value
    if (rsi == null) return { reason: ta.rsi?.note ?? 'no RSI yet' }
    const positionUsd = position * (price.priceUsd ?? 0)
    if (rsi <= params.buyBelow && positionUsd < params.maxPositionUsd) {
      return { side: 'buy', reason: `RSI ${rsi.toFixed(1)} <= ${params.buyBelow}` }
    }
    if (rsi >= params.sellAbove && position > 0) {
      return { side: 'sell', fraction: 1, reason: `RSI ${rsi.toFixed(1)} >= ${params.sellAbove}` }
    }
    return { reason: `RSI ${rsi.toFixed(1)}, hold` }
  },
}
