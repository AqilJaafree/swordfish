// Mean reversion on Bollinger Bands (QuantJourney weights_21): buy below the
// lower band, exit when price returns to the middle band.

export default {
  name: 'bollinger-reversion',
  description: 'Mean reversion: buy below the lower Bollinger Band, sell back at the middle band.',
  requires: ['bbands'],
  defaults: {},
  decide({ ta, candles, position }) {
    const b = ta.bbands
    if (b?.value == null) return { reason: `warming up: ${b?.note ?? 'no Bollinger Bands'}` }
    const state = `close ${candles.at(-1).close}, lower ${b.lower.toFixed(4)}, middle ${b.value.toFixed(4)}, %B ${b.percentB.toFixed(2)}`
    if (b.signal === 'below-lower' && position === 0) return { side: 'buy', reason: `below lower band: ${state}` }
    if (position > 0 && b.percentB >= 0.5) return { side: 'sell', fraction: 1, reason: `back at middle band: ${state}` }
    return { reason: `hold: ${state}` }
  },
}
