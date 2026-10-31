// Series helpers shared by indicators. Every function returns an array the
// same length as its input, with null where there isn't enough data yet.

export const closes = (candles) => candles.map((c) => c.close)

export function sma(values, period) {
  const out = new Array(values.length).fill(null)
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= period) sum -= values[i - period]
    if (i >= period - 1) out[i] = sum / period
  }
  return out
}

// Seeded with the SMA of the first `period` values.
export function ema(values, period) {
  const out = new Array(values.length).fill(null)
  const k = 2 / (period + 1)
  let prev = null
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (v == null) continue
    if (prev == null) {
      const window = values.slice(i - period + 1, i + 1)
      if (i < period - 1 || window.some((x) => x == null)) continue
      prev = window.reduce((a, b) => a + b, 0) / period
    } else {
      prev = v * k + prev * (1 - k)
    }
    out[i] = prev
  }
  return out
}

export function stddev(values, period) {
  const mean = sma(values, period)
  return values.map((_, i) => {
    if (mean[i] == null) return null
    let s = 0
    for (let j = i - period + 1; j <= i; j++) s += (values[j] - mean[i]) ** 2
    return Math.sqrt(s / period)
  })
}

export const last = (series) => series.at(-1) ?? null

// Price vs level, ignoring float noise: 'above' | 'below' | 'at'.
export function position(price, level) {
  const eps = Math.abs(level) * 1e-9
  return price - level > eps ? 'above' : level - price > eps ? 'below' : 'at'
}
