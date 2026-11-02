// Strategy catalogue art: each card draws its strategy on a synthetic price path, using the
// real indicator maths (SMA, EMA/MACD, Bollinger, RSI, Donchian) and the entries and exits
// its rules would take. Pure functions returning SVG strings, so they also run under Node.

export const W = 240
export const H = 96

// --- deterministic price paths ---------------------------------------------------------

function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const hash = (s) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261)

// Each step adds drift(t) and noise; `revert` pulls the price toward a slow wave.
function pricePath(seed, { n = 96, drift = () => 0, vol = 0.6, revert = 0, wave = 0, cycles = 4.2 } = {}) {
  const r = rng(seed)
  const out = []
  let p = 100
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    p += drift(t) + (r() - 0.5) * 2 * vol + revert * (100 + wave * Math.sin(t * Math.PI * cycles) - p)
    out.push(p)
  }
  return out
}

// --- indicators ------------------------------------------------------------------------

const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length
export const smaOf = (a, n) => a.map((_, i) => (i < n - 1 ? null : avg(a.slice(i - n + 1, i + 1))))
export const emaOf = (a, n) => {
  const k = 2 / (n + 1)
  let e = a[0]
  return a.map((v) => (e = v * k + e * (1 - k)))
}
const stdOf = (a, n) =>
  a.map((_, i) => {
    if (i < n - 1) return null
    const w = a.slice(i - n + 1, i + 1)
    const m = avg(w)
    return Math.sqrt(avg(w.map((v) => (v - m) ** 2)))
  })
export const rsiOf = (a, n = 14) => {
  let g = 0, l = 0
  return a.map((v, i) => {
    if (!i) return null
    const d = v - a[i - 1]
    g = (g * (n - 1) + Math.max(d, 0)) / n
    l = (l * (n - 1) + Math.max(-d, 0)) / n
    return i < n ? null : 100 - 100 / (1 + g / (l || 1e-9))
  })
}
const prevMax = (a, n) => a.map((_, i) => (i < n ? null : Math.max(...a.slice(i - n, i))))
const prevMin = (a, n) => a.map((_, i) => (i < n ? null : Math.min(...a.slice(i - n, i))))

// --- drawing ---------------------------------------------------------------------------

const f = (v) => v.toFixed(1)

// Scales for one pane: series share a y range unless `fixed` is given.
function pane(series, top, bottom, fixed) {
  const vals = series.flat().filter((v) => v != null)
  const lo = fixed?.[0] ?? Math.min(...vals)
  const hi = fixed?.[1] ?? Math.max(...vals)
  const n = series[0].length
  const x = (i) => 3 + (i / (n - 1)) * (W - 6)
  const y = (v) => bottom - ((v - lo) / (hi - lo || 1)) * (bottom - top)
  const line = (a) => a.map((v, i) => (v == null ? '' : `${a[i - 1] == null ? 'M' : 'L'}${f(x(i))} ${f(y(v))}`)).join('')
  const area = (a) => `${line(a)}L${f(x(n - 1))} ${bottom}L${f(x(0))} ${bottom}Z`
  const band = (up, lo2) => {
    const idx = up.flatMap((v, i) => (v == null ? [] : [i]))
    return `M${idx.map((i) => `${f(x(i))} ${f(y(up[i]))}`).join('L')}L${[...idx].reverse().map((i) => `${f(x(i))} ${f(y(lo2[i]))}`).join('L')}Z`
  }
  return { x, y, line, area, band, top, bottom, n }
}

const DRAW = 1.4 // seconds for the chart to wipe in left to right; markers appear as it reaches them
const delayAt = (P, i) => `${(0.15 + (i / (P.n - 1)) * DRAW).toFixed(2)}s`
// Points are zero-length round-capped strokes with non-scaling width, so they stay circular
// when the SVG is stretched to the card's width.
const dot = (x, y, cls, delay) => `<path class="${cls}" d="M${f(x)} ${f(y)}h0"${delay ? ` style="animation-delay:${delay}"` : ''}/>`
const marker = (P, i, v, side) => dot(P.x(i), P.y(v), `mk ${side}`, delayAt(P, i))
const drawn = (d, cls) => `<path class="${cls}" d="${d}"/>`
const faded = (d, cls, delay = 0.5) => `<path class="${cls} fade" d="${d}" style="animation-delay:${delay}s"/>`
const hline = (P, v, cls) => `<path class="${cls}" d="M${f(P.x(0))} ${f(P.y(v))}H${f(P.x(P.n - 1))}"/>`

// Price line with a soft fill and a live dot at the last close.
function priceLayer(P, p, id) {
  const last = p.length - 1
  return `${faded(P.area(p), 'px-area', 0.3).replace('class="px-area', `fill="url(#${id})" class="px-area`)}
    ${drawn(P.line(p), 'px')}
    <g class="now" style="animation-delay:${DRAW + 0.1}s">${dot(P.x(last), P.y(p[last]), 'ring')}${dot(P.x(last), P.y(p[last]), 'dot')}</g>`
}

// Long-only state machine: entry when flat and `buy(i)`, exit when long and `sell(i)`.
function trades(n, buy, sell, from = 1) {
  const out = []
  let long = false
  for (let i = from; i < n; i++) {
    if (!long && buy(i)) out.push([i, 'buy']), (long = true)
    else if (long && sell(i)) out.push([i, 'sell']), (long = false)
  }
  return out
}

function frame(id, body, legend) {
  const grid = [0.25, 0.5, 0.75].map((k) => `<path class="grid" d="M0 ${f(H * k)}H${W}"/>`).join('')
  return {
    svg: `<svg class="art" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" class="g0"/><stop offset="1" class="g1"/></linearGradient>
        <clipPath id="${id}-wipe"><rect class="wipe" x="-6" y="-6" width="${W + 12}" height="${H + 12}"/></clipPath></defs>
      ${grid}<g clip-path="url(#${id}-wipe)">${body}</g></svg>`,
    legend,
  }
}

// --- one renderer per strategy ---------------------------------------------------------

const ART = {
  'sma-cross'(id, seed) {
    const p = pricePath(seed, { drift: (t) => (t < 0.32 ? -0.32 : t < 0.78 ? 0.42 : -0.25), vol: 0.75 })
    const fast = smaOf(p, 6), slow = smaOf(p, 18)
    const P = pane([p, fast, slow], 8, H - 8)
    const tr = trades(p.length, (i) => slow[i - 1] != null && fast[i - 1] <= slow[i - 1] && fast[i] > slow[i], (i) => fast[i - 1] >= slow[i - 1] && fast[i] < slow[i])
    return frame(id, `${priceLayer(P, p, id)}${faded(P.line(slow), 'l2', 0.6)}${drawn(P.line(fast), 'l1')}${tr.map(([i, s]) => marker(P, i, p[i], s)).join('')}`, [['l1', 'SMA 6'], ['l2', 'SMA 18']])
  },

  'macd-trend'(id, seed) {
    const p = pricePath(seed, { drift: (t) => (t < 0.3 ? -0.28 : t < 0.72 ? 0.4 : -0.3), vol: 0.7 })
    const slowEma = emaOf(p, 26)
    const macd = emaOf(p, 12).map((v, i) => v - slowEma[i])
    const sig = emaOf(macd, 9)
    // Hide the EMA warm-up so the pane starts once the lines mean something.
    const warm = (a) => a.map((v, i) => (i < 14 ? null : v))
    const hist = warm(macd.map((v, i) => v - sig[i]))
    const m = warm(macd), s = warm(sig)
    const P = pane([p], 6, 58)
    const Q = pane([hist, m, s, [0]], 66, H - 4)
    const bw = ((W - 6) / p.length) * 0.62
    const bars = hist
      .map((v, i) => (v == null ? '' : `<rect class="bar ${v >= 0 ? 'up' : 'down'}" x="${f(Q.x(i) - bw / 2)}" y="${f(Math.min(Q.y(v), Q.y(0)))}" width="${f(bw)}" height="${f(Math.max(0.6, Math.abs(Q.y(v) - Q.y(0))))}" style="animation-delay:${delayAt(Q, i)}"/>`))
      .join('')
    const tr = trades(p.length, (i) => i > 14 && macd[i - 1] <= sig[i - 1] && macd[i] > sig[i], (i) => macd[i - 1] >= sig[i - 1] && macd[i] < sig[i])
    return frame(
      id,
      `${priceLayer(P, p, id)}<path class="sep" d="M0 62H${W}"/>${hline(Q, 0, 'mid')}${bars}${faded(Q.line(s), 'l2 thin', 0.7)}${drawn(Q.line(m), 'l1 thin')}${tr.map(([i, k]) => marker(P, i, p[i], k)).join('')}`,
      [['l1', 'MACD'], ['l2', 'Signal'], ['bars', 'Histogram']],
    )
  },

  'bollinger-reversion'(id, seed) {
    const p = pricePath(seed, { vol: 0.9, revert: 0.18, wave: 4.5, cycles: 4.6 })
    const mid = smaOf(p, 20), sd = stdOf(p, 20)
    const up = mid.map((m, i) => (m == null ? null : m + 2 * sd[i])), lo = mid.map((m, i) => (m == null ? null : m - 2 * sd[i]))
    const P = pane([p, up, lo], 6, H - 6)
    const tr = trades(p.length, (i) => lo[i] != null && p[i] < lo[i], (i) => p[i] >= mid[i])
    return frame(
      id,
      `${faded(P.band(up, lo), 'band', 0.2)}${faded(P.line(up), 'band-edge', 0.3)}${faded(P.line(lo), 'band-edge', 0.3)}${faded(P.line(mid), 'mid', 0.4)}${priceLayer(P, p, id)}${tr.map(([i, s]) => marker(P, i, p[i], s)).join('')}`,
      [['band', 'Bands 20 · 2σ'], ['mid', 'Middle']],
    )
  },

  'rsi-reversion'(id, seed) {
    const p = pricePath(seed, { vol: 0.7, revert: 0.22, wave: 5.5, cycles: 4.4 })
    const r = rsiOf(p, 14)
    const P = pane([p], 6, 54)
    const R = pane([r], 62, H - 4, [0, 100])
    const tr = trades(p.length, (i) => r[i] != null && r[i] < 30, (i) => r[i] > 70)
    return frame(
      id,
      `${priceLayer(P, p, id)}<path class="sep" d="M0 58H${W}"/>
      <rect class="zone down" x="0" y="${f(R.y(100))}" width="${W}" height="${f(R.y(70) - R.y(100))}"/>
      <rect class="zone up" x="0" y="${f(R.y(30))}" width="${W}" height="${f(R.y(0) - R.y(30))}"/>
      ${hline(R, 70, 'mid')}${hline(R, 30, 'mid')}${drawn(R.line(r), 'l1 thin')}
      ${tr.map(([i, s]) => marker(P, i, p[i], s) + marker(R, i, r[i], `${s} small`)).join('')}`,
      [['l1', 'RSI 14'], ['zone', '30 / 70']],
    )
  },

  breakout(id, seed) {
    const p = pricePath(seed, { drift: (t) => (t < 0.55 ? 0 : t < 0.86 ? 0.75 : -0.6), vol: 0.75, revert: 0.08 })
    const upper = prevMax(p, 20), lower = prevMin(p, 10)
    const P = pane([p, upper.map((v) => v ?? p[0]), lower.map((v) => v ?? p[0])], 6, H - 6)
    const tr = trades(p.length, (i) => upper[i] != null && p[i] > upper[i], (i) => lower[i] != null && p[i] < lower[i], 20)
    return frame(
      id,
      `${faded(P.band(upper, lower), 'band', 0.2)}${faded(P.line(upper), 'band-edge', 0.3)}${faded(P.line(lower), 'band-edge dashed', 0.3)}${priceLayer(P, p, id)}${tr.map(([i, s]) => marker(P, i, p[i], s)).join('')}`,
      [['band', '20-bar high'], ['dashed', '10-bar low']],
    )
  },

  'lp-range'(id, seed) {
    const p = pricePath(seed, { drift: (t) => (t < 0.45 ? -0.34 : 0.4), vol: 0.55 })
    const P = pane([p], 8, H - 8)
    const trough = p.indexOf(Math.min(...p))
    const top = Math.max(...p.slice(trough))
    const start = p[0], low = p[trough]
    const bLo = low + 0.3 * (start - low), bHi = low + 0.55 * (start - low)
    const sLo = bHi + 0.35 * (top - bHi), sHi = bHi + 0.6 * (top - bHi)
    const fill = p.findIndex((v) => v <= bHi)
    const exit = p.findIndex((v, i) => i > trough && v >= sHi)
    const rect = (from, to, a, b, cls, d) =>
      `<rect class="${cls} fade" x="${f(P.x(from))}" y="${f(P.y(b))}" width="${f(P.x(to) - P.x(from))}" height="${f(P.y(a) - P.y(b))}" style="animation-delay:${d}"/>`
    const end = exit < 0 ? p.length - 1 : exit
    return frame(
      id,
      `${rect(0, fill, bLo, bHi, 'range up', '0.2s')}${rect(fill, end, sLo, sHi, 'range down', delayAt(P, fill))}${priceLayer(P, p, id)}
      ${fill >= 0 ? marker(P, fill, p[fill], 'buy') : ''}${exit >= 0 ? marker(P, exit, p[exit], 'sell') : ''}`,
      [['range-up', 'USDT buy range'], ['range-down', 'Sell-back range']],
    )
  },

  claude(id, seed) {
    const p = pricePath(seed, { drift: (t) => 0.12 * Math.sin(t * Math.PI * 2.2), vol: 0.8, revert: 0.04, wave: 3, cycles: 2.4 })
    const P = pane([p], 8, H - 8)
    let long = false
    const nodes = []
    for (let i = 10; i < p.length; i += 9) {
      const mom = p[i] - p[i - 8]
      const act = !long && mom > 1 ? ((long = true), 'buy') : long && mom < -1 ? ((long = false), 'sell') : 'hold'
      nodes.push([i, act])
    }
    const ticks = nodes.map(([i]) => `<path class="tick" d="M${f(P.x(i))} ${P.top}V${P.bottom}"/>`).join('')
    return frame(
      id,
      `${ticks}${priceLayer(P, p, id)}${nodes.map(([i, a]) => marker(P, i, p[i], a)).join('')}`,
      [['hold', 'Hold'], ['tick', 'Model call']],
    )
  },
}

// Strategies without their own art (custom plugins) borrow one by family.
const BY_KIND = { Trend: 'sma-cross', 'Mean reversion': 'bollinger-reversion', Breakout: 'breakout', Liquidity: 'lp-range', AI: 'claude' }

export function strategyArt(name, kind) {
  const draw = ART[name] ?? ART[BY_KIND[kind]] ?? ART['sma-cross']
  const { svg, legend } = draw(`art-${name.replace(/[^a-z0-9-]/gi, '')}`, hash(name))
  const keys = legend.map(([k, label]) => `<span><i class="k-${k}"></i>${label}</span>`).join('')
  return `<div class="art-frame">${svg}<div class="art-legend">${keys}</div></div>`
}
