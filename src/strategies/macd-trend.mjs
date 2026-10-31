// Long while MACD is above its signal line (QuantJourney weights_22).

export default {
  name: 'macd-trend',
  description: 'Trend: hold while the MACD line is above its signal line, cash otherwise.',
  requires: ['macd'],
  defaults: {},
  decide({ ta, position }) {
    const m = ta.macd
    if (m?.value == null) return { reason: `warming up: ${m?.note ?? 'no MACD'}` }
    const state = `MACD ${m.value.toFixed(4)}, signal ${m.signalLine.toFixed(4)}, histogram ${m.histogram.toFixed(4)}`
    if (m.histogram > 0 && position === 0) return { side: 'buy', reason: `MACD above signal: ${state}` }
    if (m.histogram < 0 && position > 0) return { side: 'sell', fraction: 1, reason: `MACD below signal: ${state}` }
    return { reason: `hold: ${state}` }
  },
}
