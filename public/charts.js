// Charts on TradingView Lightweight Charts v5 (the standalone build's global LightweightCharts):
// one theme for every chart, a left-to-right replay animation, and the full TradingView chart
// widget for assets TradingView lists.

const L = () => window.LightweightCharts
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches

// Chart times are shown as-is, so shift UTC to the viewer's local time.
export const TZ = -new Date().getTimezoneOffset() * 60
export const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
export const alpha = (hex, a) => `rgb(${hex.match(/\w\w/g).map((h) => parseInt(h, 16)).join(' ')} / ${a})`
export const toBars = (candles) => candles.map((c) => ({ time: c.time + TZ, open: c.open, high: c.high, low: c.low, close: c.close }))
export const toPoints = (data) => data.map((d) => ({ time: d.time + TZ, value: d.value }))
export const localTime = (t) => new Date((t - TZ) * 1000).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

export function newChart(el, extra = {}) {
  const line = css('--line')
  return L().createChart(el, {
    autoSize: true,
    layout: {
      background: { color: 'transparent' },
      textColor: css('--dim'),
      fontSize: 11,
      fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
      attributionLogo: false,
      panes: { separatorColor: line, separatorHoverColor: css('--line-2'), enableResize: false },
    },
    grid: { vertLines: { color: alpha(line, 0.7) }, horzLines: { visible: false } },
    rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.14, bottom: 0.08 } },
    timeScale: { borderVisible: false, timeVisible: true, rightOffset: 4, shiftVisibleRangeOnNewBar: false },
    crosshair: {
      mode: L().CrosshairMode.Normal,
      vertLine: { color: alpha(css('--accent'), 0.55), width: 1, style: L().LineStyle.Solid, labelBackgroundColor: css('--panel-2') },
      horzLine: { color: alpha(css('--text'), 0.18), style: L().LineStyle.Dashed, labelBackgroundColor: css('--panel-2') },
    },
    ...extra,
  })
}

export const candleOptions = () => ({
  upColor: css('--up'),
  downColor: css('--down'),
  borderVisible: false,
  wickUpColor: alpha(css('--up'), 0.8),
  wickDownColor: alpha(css('--down'), 0.8),
})

export const areaOptions = () => ({
  lineColor: css('--chart-line'),
  topColor: alpha(css('--chart-line'), 0.14),
  bottomColor: alpha(css('--chart-line'), 0),
  lineWidth: 2,
  priceLineColor: alpha(css('--chart-line'), 0.35),
  priceLineStyle: L().LineStyle.Dotted,
  crosshairMarkerRadius: 5,
  crosshairMarkerBorderWidth: 3,
  crosshairMarkerBorderColor: alpha(css('--accent'), 0.35),
  crosshairMarkerBackgroundColor: css('--accent'),
  lastPriceAnimation: L().LastPriceAnimationMode.Continuous,
})

// Replays a chart left to right: bars, indicator lines and markers appear in time order while the
// time and price axes stay fixed at their final range, so nothing jumps during the animation.
export class Replay {
  constructor(chart) {
    this.chart = chart
    this.layers = []
    this.playing = false
  }

  // The first layer added sets the time axis; later layers may cover a subset of its times.
  add(definition, options, data, pane = 0) {
    const own = options.autoscaleInfoProvider
    const vals = data.flatMap((d) => (d.high != null ? [d.low, d.high] : d.value != null ? [d.value] : []))
    const fixed = vals.length && { priceRange: { minValue: Math.min(...vals), maxValue: Math.max(...vals) } }
    const series = this.chart.addSeries(
      definition,
      { ...options, autoscaleInfoProvider: (base) => (this.playing && fixed ? (own ? own(() => fixed) : fixed) : own ? own(base) : base()) },
      pane,
    )
    this.layers.push({ series, data, times: data.map((d) => d.time), shown: -1 })
    return series
  }

  markers(series, list) {
    this.mk = { plugin: L().createSeriesMarkers(series, []), list: [...list].sort((a, b) => a.time - b.time), shown: -1 }
    return this.mk.plugin
  }

  frame(k) {
    const axis = this.layers[0]
    const t = k > 0 ? axis.times[k - 1] : -Infinity
    this.layers.forEach((l, i) => {
      let c = 0
      while (c < l.times.length && l.times[c] <= t) c++
      if (c === l.shown) return
      l.shown = c
      // Whitespace on the axis layer keeps every future bar's slot on the time scale.
      l.series.setData(i === 0 ? l.data.slice(0, c).concat(this.blank.slice(c)) : l.data.slice(0, c))
    })
    if (this.mk) {
      const vis = this.mk.list.filter((m) => m.time <= t)
      if (vis.length !== this.mk.shown) (this.mk.shown = vis.length), this.mk.plugin.setMarkers(vis)
    }
  }

  // `range` is the logical range to show (default: every bar). It is pinned on each frame because
  // the chart otherwise anchors the view to the last bar with data, which moves as bars appear.
  play({ duration = 1400, range } = {}) {
    const n = this.layers[0]?.data.length ?? 0
    this.blank = (this.layers[0]?.times ?? []).map((time) => ({ time }))
    const view = range ?? { from: 0, to: n - 1 + 4 }
    const pin = () => this.chart.timeScale().setVisibleLogicalRange(view)
    if (reduced || n < 3) {
      this.frame(n)
      pin()
      return Promise.resolve()
    }
    this.playing = true
    this.frame(0)
    pin()
    const t0 = performance.now()
    return new Promise((resolve) => {
      const step = (now) => {
        if (this.stopped) return resolve()
        const p = Math.min(1, (now - t0) / duration)
        this.frame(Math.max(1, Math.round((p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2) * n)))
        pin()
        if (p < 1) return void requestAnimationFrame(step)
        this.playing = false
        this.layers.forEach((l) => l.series.priceScale().applyOptions({ autoScale: true }))
        resolve()
      }
      requestAnimationFrame(step)
    })
  }

  stop() {
    this.stopped = true
  }
}

// --- full TradingView chart (embedded widget, TradingView's own market data) ----------------

export const TV_SYMBOLS = { wbtc: 'BITSTAMP:BTCUSD', weth: 'BITSTAMP:ETHUSD', nvdas: 'NASDAQ:NVDA', aapls: 'NASDAQ:AAPL' }
const TV_INTERVAL = { '15m': '15', '1h': '60', '4h': '240', '1d': 'D' }

export function openTradingView(dialog, mount, id, timeframe) {
  const symbol = TV_SYMBOLS[id]
  if (!symbol) return false
  mount.innerHTML = '<div class="tradingview-widget-container" style="height:100%;width:100%"><div class="tradingview-widget-container__widget" style="height:100%;width:100%"></div></div>'
  const script = document.createElement('script')
  script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'
  script.async = true
  script.textContent = JSON.stringify({
    autosize: true,
    symbol,
    interval: TV_INTERVAL[timeframe] ?? '60',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'Etc/UTC',
    theme: 'dark',
    style: '1',
    locale: 'en',
    backgroundColor: css('--inset'),
    gridColor: alpha(css('--line'), 0.6),
    hide_side_toolbar: false,
    allow_symbol_change: false,
    calendar: false,
    support_host: 'https://www.tradingview.com',
  })
  mount.firstChild.appendChild(script)
  dialog.showModal()
  return true
}
