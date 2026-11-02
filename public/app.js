// Swordfish dashboard: markets, leaderboard, your wallet and bots, strategy catalogue.

import { strategyArt } from '/art.js'
import { alpha, areaOptions, candleOptions, css as color, localTime, newChart, openTradingView, Replay, toBars, toPoints, TV_SYMBOLS, TZ } from '/charts.js'

const $ = (sel) => document.querySelector(sel)
const $$ = (sel) => document.querySelectorAll(sel)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const usd = (n) => (n == null ? '–' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }))
const compact = (n) => (n == null ? '–' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }))
const pct = (n) => (n == null ? '–' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`)
const pnlClass = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : '')
const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '')
const qty = (n) => (n >= 1 ? n.toFixed(4) : n.toPrecision(4))
const px = (n) => (n == null ? '–' : n >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 }) : n >= 1 ? n.toFixed(4) : n.toPrecision(4))
const when = (iso) => new Date(iso).toLocaleString('en-GB', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
const explorer = (path) => `https://hsk.blockscout.com/${path}`
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
// Telegram Web works in any browser; t.me links only hand off to an installed Telegram app.
const tgLink = () => (info.telegramBot ? `https://web.telegram.org/k/#@${encodeURIComponent(info.telegramBot)}` : null)

async function api(path, options) {
  const res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...options })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(body.error ?? res.statusText), { status: res.status })
  return body
}

function toast(msg) {
  const el = $('#toast')
  el.textContent = msg
  el.classList.add('on')
  clearTimeout(toast.t)
  toast.t = setTimeout(() => el.classList.remove('on'), 2600)
}

let info = {}
let me = null
let mode = 'paper'

// --- icons -------------------------------------------------------------------------------
// 24×24 line icons; <i data-icon="name"> placeholders in the HTML are swapped for SVG at boot.

const ICONS = {
  bolt: '<path d="M13.2 2 4.5 13.4h6.6L10 22l8.7-11.4h-6.6z"/>',
  'bolt-line': '<path d="M13.2 2 4.5 13.4h6.6L10 22l8.7-11.4h-6.6z"/>',
  panel: '<rect x="3" y="3" width="18" height="18" rx="3.5"/><path d="M9 3v18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  home: '<path d="M3.5 10.2 12 3.5l8.5 6.7V19a1.5 1.5 0 0 1-1.5 1.5h-4.2v-6h-5.6v6H5A1.5 1.5 0 0 1 3.5 19z"/>',
  trophy: '<path d="M8 20.5h8M12 16.5v4M7 4h10v5.5a5 5 0 0 1-10 0zM17 5.5h2.5V7a3.5 3.5 0 0 1-3 3.4M7 5.5H4.5V7a3.5 3.5 0 0 0 3 3.4"/>',
  wallet: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H17v3"/><path d="M4 7.5V17a2.5 2.5 0 0 0 2.5 2.5H20V8H6.5A2.5 2.5 0 0 1 4 5.5"/><circle cx="16" cy="13.8" r="1.1"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.6 8.4-2.1 5.1-5.1 2.1 2.1-5.1z"/>',
  help: '<path d="M21 11.5a8.5 8.5 0 0 1-12.4 7.6L3.5 20.5l1.4-4.8A8.5 8.5 0 1 1 21 11.5z"/><path d="M9.8 9.4a2.3 2.3 0 1 1 3.3 2.1c-.7.3-1.1.9-1.1 1.6M12 15.8h.01"/>',
  code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
  login: '<path d="M15 3.5h3.5a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H15M10 16.5l4.5-4.5L10 7.5M14.5 12H3.5"/>',
  logout: '<path d="M9 3.5H5.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2H9M15.5 16.5 20 12l-4.5-4.5M20 12H9"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  layers: '<path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8z"/><path d="m3.5 12.5 8.5 4.5 8.5-4.5"/>',
  signal: '<path d="M5 18v-3M9.5 18v-7M14 18V8M18.5 18V5"/>',
  chart: '<path d="M3.5 3.5v17h17"/><path d="m7.5 14.5 4-4 3 3 5.5-6"/>',
  pie: '<path d="M21 12.5A9 9 0 1 1 11.5 3v9.5z"/><path d="M15 3.4A9 9 0 0 1 20.6 9H15z"/>',
  sparkle: '<path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.9L12 18.5l-1.8-5.8-5.7-1.9L10.2 9z"/>',
  badge: '<path d="m12 2.8 2.3 1.6 2.8-.1.9 2.7 2.3 1.6-.9 2.7.9 2.7-2.3 1.6-.9 2.7-2.8-.1L12 21.2l-2.3-1.6-2.8.1-.9-2.7-2.3-1.6.9-2.7-.9-2.7L6 7.7l.9-2.7 2.8.1z"/>',
  cube: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
  pulse: '<path d="M3 12h4l2.5-6 5 12L17 12h4"/>',
  share: '<circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="m8.2 10.8 7.6-4.1M8.2 13.2l7.6 4.1"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
}
const FILLED = new Set(['bolt'])
const icon = (name) => `<svg class="i${FILLED.has(name) ? ' fill' : ''}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] ?? ''}</svg>`
function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll('i[data-icon]')) {
    const t = document.createElement('template')
    t.innerHTML = icon(el.dataset.icon)
    const svg = t.content.firstChild
    if (el.className) svg.classList.add(...el.classList)
    el.replaceWith(svg)
  }
}

// --- motion helpers ----------------------------------------------------------------------

// Count a number up from its previous value.
function countTo(el, value, fmt) {
  if (!el) return
  const from = Number(el.dataset.v ?? 0)
  el.dataset.v = value
  if (reduced || from === value) return void (el.textContent = fmt(value))
  const t0 = performance.now()
  const step = (now) => {
    const k = Math.min(1, (now - t0) / 1100)
    el.textContent = fmt(from + (value - from) * (1 - (1 - k) ** 4))
    if (k < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

function flash(el, dir) {
  if (!el || !dir) return
  el.classList.remove('flash-up', 'flash-down')
  void el.offsetWidth
  el.classList.add(dir > 0 ? 'flash-up' : 'flash-down')
  setTimeout(() => el.classList.remove('flash-up', 'flash-down'), 50)
}

// Slide a segmented control's indicator under its active button.
function moveInk(ink, active) {
  if (!ink || !active?.offsetWidth) return
  ink.style.width = `${active.offsetWidth}px`
  ink.style.transform = `translateX(${active.offsetLeft}px)`
}
const syncInks = () => {
  for (const seg of $$('.seg')) moveInk(seg.querySelector('.seg-ink'), seg.querySelector('button.active'))
}
addEventListener('resize', syncInks)
document.fonts?.ready.then(syncInks)

// --- navigation ------------------------------------------------------------------------

const TABS = ['leaderboard', 'board', 'mine', 'strategies']

function showTab(tab) {
  history.replaceState(null, '', tab === 'leaderboard' ? location.pathname : `#${tab}`)
  for (const b of $$('#tabs button')) b.classList.toggle('active', b.dataset.tab === tab)
  for (const s of $$('main section')) s.hidden = (s.dataset.view ?? s.id) !== tab
  syncInks()
  scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })
  if (tab === 'board') loadBoard()
  if (tab === 'leaderboard') loadOverview()
  if (tab === 'mine') loadMine()
  if (tab === 'strategies' && !previewCharts.length) loadPreview()
}
function bindTabs(root = document) {
  root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', (e) => (e.preventDefault(), showTab(b.dataset.tab))))
}
$$('#mode button').forEach((b) =>
  b.addEventListener('click', () => {
    mode = b.dataset.mode
    $$('#mode button').forEach((x) => x.classList.toggle('active', x === b))
    loadBoard()
  }),
)

// Collapsible sidebar, remembered per browser.
const SIDE_KEY = 'swordfish.side'
try {
  if (localStorage.getItem(SIDE_KEY) === 'collapsed') $('#app').classList.add('collapsed')
} catch {}
$('#side-toggle').addEventListener('click', () => {
  const collapsed = $('#app').classList.toggle('collapsed')
  try {
    localStorage.setItem(SIDE_KEY, collapsed ? 'collapsed' : 'open')
  } catch {}
  setTimeout(syncInks, 460)
})

// --- network ---------------------------------------------------------------------------

async function pollBlock() {
  try {
    const res = await fetch('https://mainnet.hsk.xyz', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
    })
    const n = parseInt((await res.json()).result, 16)
    const el = $('#block')
    if (String(n) !== el.dataset.n) {
      el.dataset.n = n
      el.textContent = `#${n.toLocaleString('en-US')}`
      el.classList.add('tick')
      setTimeout(() => el.classList.remove('tick'), 600)
      pulse.block = n
      $('#pulse-block') && ($('#pulse-block').textContent = `#${n.toLocaleString('en-US')}`)
    }
  } catch {}
}

// --- markets ---------------------------------------------------------------------------

const STABLE = /usd|hkd|^whsk$/i
const FEATURED = ['wbtc', 'weth', 'hsk', 'nvdas', 'aapls']
const COIN = { wbtc: '₿', weth: 'Ξ', hsk: 'H', nvdas: 'N', aapls: 'A' }
const DESC = {
  wbtc: 'Bitcoin bridged to HashKey Chain. Fills are quoted against its Uniswap V3 pool; the chart shows the BTC-USD market reference.',
  weth: 'Ether bridged to HashKey Chain, traded through the WETH Uniswap V3 pool. The chart shows the ETH-USD market reference.',
  hsk: 'The native gas token of HashKey Chain, quoted straight from the HSK/USDT Uniswap V3 pool and sampled on-chain every 15 seconds.',
  nvdas: 'Tokenized NVIDIA stock on HashKey Chain. Pool liquidity is thin, so the price shown is the NASDAQ reference.',
  aapls: 'Tokenized Apple stock on HashKey Chain. Pool liquidity is thin, so the price shown is the NASDAQ reference.',
}
const SHORT_NAME = { wbtc: 'Bitcoin', weth: 'Ethereum', hsk: 'HashKey', nvdas: 'NVIDIA', aapls: 'Apple' }
const coin = (id, sym) => esc(COIN[id] ?? (sym ?? id)[0].toUpperCase())
let prices = new Map()
let candles24 = new Map()
let assetsById = new Map()

const quoted = (p) => p.priceUsd != null && !STABLE.test(p.id) && !p.warning && (p.liquidityUsd >= 10 || p.source?.startsWith('yahoo'))

async function loadPrices() {
  const list = await api('/prices').catch(() => [])
  const prev = prices
  prices = new Map(list.map((p) => [p.id, p]))
  renderTape(list.filter(quoted))
  for (const el of $$('[data-px]')) {
    const p = prices.get(el.dataset.px)
    if (!p) continue
    el.textContent = px(p.priceUsd)
    flash(el, Math.sign(p.priceUsd - (prev.get(el.dataset.px)?.priceUsd ?? p.priceUsd)))
  }
  // Pool liquidity, counting each pool once (HSK and WHSK share one).
  const pools = new Map(list.filter((p) => p.pool && p.liquidityUsd).map((p) => [p.pool, p.liquidityUsd]))
  pulse.tvl = [...pools.values()].reduce((a, b) => a + b, 0)
  pulse.pools = pools.size
  renderPulse()
  renderWalletPill()
}

function change24(id) {
  const c = candles24.get(id)
  if (!c || c.length < 2) return null
  const base = c[Math.max(0, c.length - 25)].close
  return (c.at(-1).close / base - 1) * 100
}

function renderTape(list) {
  const items = list
    .map((p) => {
      const ch = change24(p.id)
      return `<span class="tick-item"><b>${esc(p.symbol)}</b><span class="px">${px(p.priceUsd)}</span>${ch == null ? '' : `<span class="${pnlClass(ch)}">${pct(ch)}</span>`}</span>`
    })
    .join('')
  // The CSS loop scrolls half the track, so each half must be wider than the bar.
  $('#tape').innerHTML = items.repeat(4)
}

// Small white sparkline for the Hot assets rail.
function sparkline(candles) {
  const W = 64, H = 30
  if (!candles?.length || candles.length < 2) return `<svg class="spark" viewBox="0 0 ${W} ${H}"><path d="M0 ${H / 2}H${W}" stroke="#3a3a3a" stroke-dasharray="2 3" fill="none"/></svg>`
  const ys = candles.map((c) => c.close)
  const lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1
  const d = ys.map((y, i) => `${i ? 'L' : 'M'}${((i / (ys.length - 1)) * W).toFixed(1)} ${(H - 3 - ((y - lo) / span) * (H - 6)).toFixed(1)}`).join('')
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path class="line" d="${d}" style="--len:200"/></svg>`
}

async function loadMarkets() {
  const assets = await api('/assets').catch(() => [])
  assetsById = new Map(assets.map((a) => [a.id, a]))
  const ids = FEATURED.filter((id) => assetsById.has(id))
  $('#hot').innerHTML = ids.map(() => '<div class="hot-row skel" style="height:72px"></div>').join('')
  const data = await Promise.all(ids.map((id) => api(`/assets/${id}/candles?timeframe=1h&limit=48`).catch(() => ({ candles: [] }))))
  ids.forEach((id, i) => candles24.set(id, data[i].candles ?? []))
  $('#hot').innerHTML = ids
    .map((id, i) => {
      const a = assetsById.get(id)
      const ch = change24(id)
      return `<button type="button" class="hot-row${id === mc.id ? ' active' : ''}" data-asset="${id}" style="animation-delay:${i * 60}ms">
        <span class="coin sm">${coin(id, a.symbol)}</span>
        <span class="sym"><b>${esc(a.symbol)}</b><span>${esc(SHORT_NAME[id] ?? a.name)}</span></span>
        <span class="val"><b data-px="${id}">${px(prices.get(id)?.priceUsd)}</b><span class="badge ${pnlClass(ch)}">${ch == null ? 'sampling' : pct(ch)}</span></span>
        ${sparkline(data[i].candles)}
      </button>`
    })
    .join('')
  $$('.hot-row[data-asset]').forEach((el) =>
    el.addEventListener('click', () => {
      if ($('#leaderboard').hidden) showTab('leaderboard')
      selectMarket(el.dataset.asset)
    }),
  )
  renderTape([...prices.values()].filter(quoted))
  if (!mc.ready) {
    mc.ready = true
    $('#mc-asset').innerHTML = ids
      .map((id) => `<button type="button" data-id="${id}"${id === mc.id ? ' class="active"' : ''}><span class="pill-coin">${coin(id, assetsById.get(id).symbol)}</span>${esc(assetsById.get(id).symbol)}</button>`)
      .join('')
    $$('#mc-asset button').forEach((b) => b.addEventListener('click', () => selectMarket(b.dataset.id)))
    drawMarket()
  }
  renderAssetCard()
}

// --- market chart (Home asset card) ----------------------------------------------------------
// TradingView Lightweight Charts: a glowing line or candles with volume, replayed left to right on
// every change, a price pill that follows the crosshair, and the latest bar updated live.

const mc = { id: 'wbtc', tf: '1h', type: 'area', seq: 0, chart: null, replay: null, main: null, candles: [], source: '' }

function selectMarket(id) {
  mc.id = id
  $$('#mc-asset button').forEach((b) => b.classList.toggle('active', b.dataset.id === id))
  $$('.hot-row[data-asset]').forEach((el) => el.classList.toggle('active', el.dataset.asset === id))
  renderAssetCard()
  drawMarket()
}

$('#mc-tf').addEventListener('change', (e) => {
  mc.tf = e.target.value
  drawMarket()
})
$$('#mc-type button').forEach((b) =>
  b.addEventListener('click', () => {
    mc.type = b.dataset.type
    $$('#mc-type button').forEach((x) => x.classList.toggle('active', x === b))
    syncInks()
    drawMarket()
  }),
)
$('#mc-tv').addEventListener('click', () => {
  $('#tv-title').textContent = `${assetsById.get(mc.id)?.symbol ?? mc.id.toUpperCase()} · ${TV_SYMBOLS[mc.id]}`
  openTradingView($('#tv-dialog'), $('#tv-mount'), mc.id, mc.tf)
})
$('#tv-dialog').addEventListener('close', () => ($('#tv-mount').innerHTML = ''))
$('#ac-backtest').addEventListener('click', () => {
  showTab('strategies')
  const sel = $('#preview select[name=asset]')
  if ([...sel.options].some((o) => o.value === mc.id)) sel.value = mc.id
  $('#preview select[name=timeframe]').value = mc.tf
  loadPreview()
  setTimeout(() => $('#preview').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' }), 300)
})

function renderAssetCard() {
  const a = assetsById.get(mc.id)
  if (!a) return
  const p = prices.get(mc.id)
  const ch = change24(mc.id)
  const onchain = p?.source && !p.source.startsWith('yahoo')
  $('#ac-icon').textContent = COIN[mc.id] ?? a.symbol[0]
  $('#ac-sym').textContent = a.symbol
  $('#ac-name').textContent = a.category === 'stock' ? 'Tokenized stock' : a.name.replace(/\s*\(.*\)/, '')
  $('#ac-px').dataset.px = mc.id
  $('#ac-px').textContent = p?.priceUsd == null ? '–' : `$${px(p.priceUsd)}`
  $('#ac-chg').className = `badge ${pnlClass(ch)}`
  $('#ac-chg').textContent = ch == null ? 'sampling' : pct(ch)
  const tags = onchain ? [`#${p.source}`, '#onchain', `#depth ${compact(p.liquidityUsd)}`] : ['#stock', '#reference']
  $('#ac-tags').innerHTML = tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')
  $('#ac-desc').textContent = DESC[mc.id] ?? a.name
  const tv = Boolean(TV_SYMBOLS[mc.id])
  $('#mc-tv').disabled = !tv
  $('#mc-tv').title = tv ? `Open ${TV_SYMBOLS[mc.id]} on TradingView` : 'Not listed on TradingView'
}

async function drawMarket() {
  const seq = ++mc.seq
  $('#mc-loading').classList.add('on')
  const data = await api(`/assets/${mc.id}/candles?timeframe=${mc.tf}&limit=300`).catch((err) => ({ error: err.message }))
  if (seq !== mc.seq) return
  $('#mc-loading').classList.remove('on')
  mc.replay?.stop()
  mc.chart?.remove()
  mc.chart = mc.replay = mc.main = null
  $('#mc-tip').hidden = true
  mc.candles = data.candles ?? []
  mc.source = data.source ?? ''
  const empty = mc.candles.length < 3
  $('#mc-empty').hidden = !empty
  if (empty) {
    $('#mc-empty').textContent =
      mc.source === 'sampler'
        ? `${mc.id.toUpperCase()} history is sampled from its HashKey pool while the server runs: ${mc.candles.length} ${mc.tf} candle${mc.candles.length === 1 ? '' : 's'} so far. Try again later, or pick another asset.`
        : `No ${mc.tf} history for ${mc.id.toUpperCase()}${data.error ? `: ${data.error}` : ''}.`
    return renderMarketLegend()
  }

  const volume = mc.candles.some((c) => c.volume > 0)
  const chart = (mc.chart = newChart($('#mc-chart'), { rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.2, bottom: volume ? 0.2 : 0.06 } } }))
  const replay = (mc.replay = new Replay(chart))
  const bars = toBars(mc.candles)
  mc.main =
    mc.type === 'area'
      ? replay.add(LightweightCharts.AreaSeries, areaOptions(), bars.map((b) => ({ time: b.time, value: b.close })))
      : replay.add(LightweightCharts.CandlestickSeries, candleOptions(), bars)
  if (volume) {
    const vol = replay.add(
      LightweightCharts.HistogramSeries,
      { priceScaleId: 'vol', priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false },
      mc.candles.map((c) => ({ time: c.time + TZ, value: c.volume, color: alpha('#ffffff', 0.09) })),
    )
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
  }
  chart.subscribeCrosshairMove((p) => {
    renderMarketLegend(p)
    renderTip(p)
  })
  renderMarketLegend()
  replay.play({ duration: 1600 })
}

// Black price pill above the hovered point.
function renderTip(param) {
  const tip = $('#mc-tip')
  const d = param?.point && mc.main && param.seriesData.get(mc.main)
  const value = d && (d.value ?? d.close)
  const y = value != null && mc.main.priceToCoordinate(value)
  if (value == null || y == null) return void (tip.hidden = true)
  const chg = mc.candles[0] ? (value / mc.candles[0].close - 1) * 100 : null
  tip.innerHTML = `$${px(value)}${chg == null ? '' : `<small class="${pnlClass(chg)}">${pct(chg)}</small>`}`
  tip.style.left = `${param.point.x}px`
  tip.style.top = `${y}px`
  tip.hidden = false
}

function renderMarketLegend(param) {
  const c = mc.candles
  const hover = param?.time != null && c.find((x) => x.time + TZ === param.time)
  const bar = hover || c.at(-1)
  const days = c.length > 1 ? Math.max(1, Math.round((c.at(-1).time - c[0].time) / 86_400)) : 0
  const src = mc.source.startsWith('yahoo') ? `Reference ${mc.source.replace('yahoo:', '')}` : mc.source === 'sampler' ? 'HashKey pool samples' : mc.source.startsWith('geckoterminal') ? 'HashKey pool' : mc.source
  $('#mc-legend').innerHTML = bar
    ? hover
      ? `<span>${localTime(param.time)}</span><span>O <b>${px(bar.open)}</b></span><span>H <b>${px(bar.high)}</b></span><span>L <b>${px(bar.low)}</b></span><span>C <b>${px(bar.close)}</b></span>`
      : `<span>${esc(src)}</span><span>${mc.tf.toUpperCase()} · <b>${days}d</b> window</span>`
    : ''
}

// Pull the newest bar and update the chart in place (the line's last point pulses).
async function refreshMarket() {
  if ($('#leaderboard').hidden || !mc.main || mc.replay?.playing) return
  const seq = mc.seq
  const d = await api(`/assets/${mc.id}/candles?timeframe=${mc.tf}&limit=2`).catch(() => null)
  const last = d?.candles?.at(-1)
  const prev = mc.candles.at(-1)
  if (seq !== mc.seq || !last || !prev || last.time < prev.time) return
  if (last.time === prev.time) mc.candles[mc.candles.length - 1] = last
  else mc.candles.push(last)
  const [b] = toBars([last])
  mc.main.update(mc.type === 'area' ? { time: b.time, value: b.close } : b)
  renderMarketLegend()
}

// --- overview: platform card, top strategies ------------------------------------------------

const EMPTY_ART = `<svg class="empty-art" viewBox="0 0 120 48" fill="none"><path d="M2 38 L22 30 L38 34 L56 18 L72 24 L90 10 L118 14" stroke="currentColor" stroke-width="1.5"/></svg>`
const pulse = { rows: [], paper: [], live: [], tvl: null, pools: 0, block: null, at: Date.now() }

async function loadOverview() {
  const [paper, live] = await Promise.all([api('/api/leaderboard?mode=paper').catch(() => []), api('/api/leaderboard?mode=live').catch(() => [])])
  const tagged = (rows, m) => rows.map((r) => ({ ...r, mode: m }))
  Object.assign(pulse, { paper, live, rows: [...tagged(paper, 'paper'), ...tagged(live, 'live')].sort((a, b) => (b.pnl_pct ?? 0) - (a.pnl_pct ?? 0)), at: Date.now() })
  renderPulse()
  renderHomeBoard()
  renderTopStrategies()
}

function renderPulse() {
  const el = $('#pulse')
  const sum = (rows) => rows.reduce((a, r) => a + (r.equity_usd ?? 0), 0)
  const running = pulse.rows.filter((r) => r.status === 'running').length
  const avg = pulse.rows.length ? pulse.rows.reduce((a, r) => a + (r.pnl_pct ?? 0), 0) / pulse.rows.length : null
  if (!el.dataset.ready) {
    el.dataset.ready = '1'
    el.innerHTML = `<div class="post-meta"><span class="tag">#hashkey</span><span class="tag">#chain177</span><span class="dot-sep" id="pulse-running"></span></div>
      <blockquote id="pulse-text"></blockquote>
      <div class="post-foot">
        <span class="who">${icon('bolt')}<span>@${esc(info.telegramBot ?? 'swordfish')}</span></span>
        <span id="pulse-ago">just now</span>
        <span class="stats-inline">
          <span title="Latest block">${icon('cube')}<b id="pulse-block">#—</b></span>
          <span title="Average P&L after costs">${icon('pulse')}<b id="pulse-avg">–</b></span>
          <button class="link" id="pulse-share" type="button"><span>${icon('share')}</span> Share</button>
        </span>
      </div>`
    $('#pulse-share').addEventListener('click', () => navigator.clipboard.writeText(location.href).then(() => toast('Dashboard link copied')))
  }
  $('#pulse-running').textContent = `• ${running} bot${running === 1 ? '' : 's'} running`
  $('#pulse-text').textContent =
    `${pulse.rows.length} ${pulse.rows.length === 1 ? 'strategy is' : 'strategies are'} deployed, with ${compact(sum(pulse.paper))} in paper capital and ${compact(sum(pulse.live))} live. ` +
    (pulse.tvl == null ? 'Pool liquidity is loading.' : `Swordfish is quoting ${pulse.pools} HashKey pools holding ${compact(pulse.tvl)} of liquidity, with every fill net of fees and gas.`)
  $('#pulse-avg').textContent = avg == null ? '–' : pct(avg)
  $('#pulse-avg').className = pnlClass(avg)
  if (pulse.block) $('#pulse-block').textContent = `#${pulse.block.toLocaleString('en-US')}`
}
setInterval(() => {
  const s = Math.round((Date.now() - pulse.at) / 1000)
  if ($('#pulse-ago')) $('#pulse-ago').textContent = s < 10 ? 'just now' : s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`
}, 5000)

function renderHomeBoard() {
  const rows = pulse.rows.slice(0, 5)
  $('#home-board').innerHTML = rows.length
    ? `<thead><tr><th>#</th><th>Strategy</th><th>Model</th><th>Status</th><th class="num">P&amp;L</th><th class="num">Equity</th></tr></thead><tbody>${rows
        .map(
          (r, i) => `<tr data-bot="${r.id}" class="row-in" style="animation-delay:${i * 50}ms"><td class="rank">${String(i + 1).padStart(2, '0')}</td>
          <td class="bot-name"><b>${esc(r.name)}</b> <span class="tag ${esc(r.mode ?? 'paper')}">${esc(r.mode ?? 'paper')}</span></td>
          <td><span class="mono">${esc(r.strategy)}</span> <span class="dim">${esc(r.timeframe)}</span></td>
          <td><span class="status ${esc(r.status)}">${esc(r.status)}</span></td>
          <td class="num ${pnlClass(r.pnl_pct)}">${pct(r.pnl_pct)}</td><td class="num">${usd(r.equity_usd)}</td></tr>`,
        )
        .join('')}</tbody>`
    : `<tbody><tr><td class="empty">${EMPTY_ART}<h4>No strategies deployed yet</h4><p>Deploy a paper strategy to start a track record. Fills are quoted against live pool liquidity.</p>
        <div class="actions"><button class="btn glossy" data-tab="strategies" type="button">Browse strategies</button></div></td></tr></tbody>`
  $$('#home-board tr[data-bot]').forEach((tr) => tr.addEventListener('click', () => openBot(tr.dataset.bot)))
  bindTabs($('#home-board'))
}

// Right rail: the best strategies in rotation, like a carousel.
let topIndex = 0
let topTimer = null
function renderTopStrategies() {
  const top = pulse.rows.slice(0, 3)
  const show = (i) => {
    topIndex = i
    const r = top[i]
    $('#top-strat').innerHTML = r
      ? `<div class="pop-card">
          <div class="pop-top">
            <span class="avatar-sq">${icon('bolt')}</span>
            <span><span class="pop-name"><span>${esc(r.name)}</span><span class="tag ${r.mode === 'live' ? 'live' : 'verified'}">${icon('check')}${esc(r.mode ?? 'paper')}</span></span>
              <span class="pop-sub${r.status === 'running' ? '' : ' idle'}">${esc(r.status)} · @${esc(r.username)}</span></span>
            <span class="pop-roi"><b class="${pnlClass(r.pnl_pct)}">${pct(r.pnl_pct)}</b><span>P&amp;L</span></span>
          </div>
          <button class="btn outline" data-open="${r.id}" type="button">${icon('chart')}View strategy</button>
        </div>`
      : `<div class="pop-card">
          <div class="pop-top"><span class="avatar-sq">${icon('bolt')}</span><span><span class="pop-name">No strategies yet</span><span class="pop-sub idle">Be the first on the board</span></span><span></span></div>
          <button class="btn outline" data-tab="strategies" type="button">${icon('compass')}Deploy a strategy</button>
        </div>`
    $('#top-strat [data-open]')?.addEventListener('click', (e) => openBot(e.currentTarget.dataset.open))
    bindTabs($('#top-strat'))
    $$('#top-dots button').forEach((d, k) => d.classList.toggle('on', k === i))
  }
  $('#top-dots').innerHTML = top.length > 1 ? top.map((_, i) => `<button type="button" aria-label="Strategy ${i + 1}"></button>`).join('') : ''
  $$('#top-dots button').forEach((d, i) => d.addEventListener('click', () => show(i)))
  show(Math.min(topIndex, Math.max(0, top.length - 1)))
  clearInterval(topTimer)
  if (top.length > 1 && !reduced) topTimer = setInterval(() => !$('.pop:hover') && show((topIndex + 1) % top.length), 6000)
}

// --- leaderboard -----------------------------------------------------------------------

async function loadBoard() {
  const rows = await api(`/api/leaderboard?mode=${mode}`)
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.pnl_pct ?? 0)))
  $('#board').innerHTML = rows.length
    ? `<thead><tr><th>#</th><th>Strategy</th><th>Owner</th><th>Model</th><th>Universe</th><th>Status</th><th class="num">P&amp;L</th><th class="num">Equity</th><th class="num">Trades</th></tr></thead><tbody>` +
      rows
        .map(
          (r, i) => `<tr data-bot="${r.id}" class="row-in" style="animation-delay:${i * 40}ms">
            <td class="rank">${String(i + 1).padStart(2, '0')}</td>
            <td class="bot-name"><b>${esc(r.name)}</b> <span class="dim">#${r.id}</span></td>
            <td>@${esc(r.username)}${r.wallet ? `<br><a class="dim small mono" href="${explorer(`address/${r.wallet}`)}" target="_blank" onclick="event.stopPropagation()">${short(r.wallet)}</a>` : ''}</td>
            <td><span class="mono">${esc(r.strategy)}</span> <span class="dim">${esc(r.timeframe)}</span></td>
            <td><div class="chips">${r.assets.map((a) => `<span class="chip">${esc(a)}</span>`).join('')}</div></td>
            <td><span class="status ${esc(r.status)}">${esc(r.status)}</span></td>
            <td class="num pnl-cell ${pnlClass(r.pnl_pct)}"><div class="pnl-bar"><i style="width:${(Math.abs(r.pnl_pct ?? 0) / maxAbs) * 60}px"></i>${pct(r.pnl_pct)}</div></td>
            <td class="num">${usd(r.equity_usd)}</td><td class="num">${r.trades}</td></tr>`,
        )
        .join('') + '</tbody>'
    : `<tbody><tr><td class="empty">${EMPTY_ART}
        <h4>No ${mode} strategies deployed yet</h4>
        <p>${mode === 'paper' ? 'Deploy a paper strategy to start building a track record. Fills are quoted against live pool liquidity, net of fees and gas.' : 'Live strategies appear here once a paper bot is promoted to real funds with /live in Telegram.'}</p>
        <div class="actions"><button class="btn glossy" data-tab="strategies" type="button">Browse strategies</button></div>
      </td></tr></tbody>`
  $$('#board tr[data-bot]').forEach((tr) => tr.addEventListener('click', () => openBot(tr.dataset.bot)))
  bindTabs($('#board'))
}

// --- bot detail ------------------------------------------------------------------------

async function openBot(id) {
  const [b, trades, decisions] = await Promise.all([api(`/api/bots/${id}`), api(`/api/bots/${id}/trades`), api(`/api/bots/${id}/decisions`)])
  const positions = Object.entries(b.positions)
  $('#detail-eyebrow').textContent = `Strategy #${b.id}`
  $('#detail-body').innerHTML = `
    <h2>${esc(b.name)}</h2>
    <div class="d-meta"><span class="tag ${b.mode}">${b.mode}</span><span class="status ${esc(b.status)}">${esc(b.status)}</span>
      <span class="mono">${esc(b.strategy)} · ${esc(b.timeframe)}</span><span>by @${esc(b.owner)}</span></div>
    ${b.haltedReason ? `<div class="halt">Halted: ${esc(b.haltedReason)}</div>` : ''}
    <div class="stats">
      <div><span>Equity</span><b>${usd(b.equityUsd)}</b></div>
      <div><span>P&amp;L</span><b class="${pnlClass(b.pnlPct)}">${pct(b.pnlPct)}</b></div>
      <div><span>Cash</span><b>${usd(b.cashUsdt)}</b></div>
      <div><span>Start</span><b>${usd(b.startUsdt)}</b></div>
    </div>
    <h3>Mandate</h3>
    <dl class="kv">
      <dt>Universe</dt><dd>${b.assets.map((a) => esc(a.toUpperCase())).join(', ')}</dd>
      <dt>Positions</dt><dd>${positions.length ? positions.map(([a, q]) => `${esc(a)} ${qty(q)}`).join(' · ') : '<span class="dim">Flat</span>'}</dd>
      ${b.lp ? `<dt>Liquidity</dt><dd>${b.lp.range ? `${b.lp.range.side === 'usdt' ? `${usd(b.lp.range.depositUsdt)} USDT in buy range` : `${qty(b.lp.range.depositAsset)} ${esc(b.assets[0])} in sell range`} ${b.lp.range.lower.toPrecision(6)}–${b.lp.range.upper.toPrecision(6)}${b.lp.range.tokenId ? ` · <a href="${explorer(`token/0xDF0A9b833Db0E4CeEa103A4408f3B68e7FC0cad5/instance/${b.lp.range.tokenId}`)}" target="_blank">position #${esc(b.lp.range.tokenId)}</a>` : ''}` : 'No open range'} · fees ${usd(b.lp.feesUsd)} · ${b.lp.fills} fills</dd>` : ''}
      ${b.mode === 'live' && b.wallet ? `<dt>Wallet</dt><dd><a href="${explorer(`address/${b.wallet}`)}" target="_blank">${b.wallet}</a></dd>` : ''}
      <dt>Parameters</dt><dd>${esc(JSON.stringify(b.params))}</dd>
    </dl>
    <div class="chart-head"><h3>Execution chart</h3>${b.assets.length > 1 ? `<div class="seg" id="chart-assets">${b.assets.map((a, i) => `<button type="button" data-asset="${esc(a)}"${i ? '' : ' class="active"'}>${esc(a.toUpperCase())}</button>`).join('')}<span class="seg-ink"></span></div>` : ''}</div>
    <div id="chart" class="chart"></div>
    <p class="note" id="chart-note"></p>
    <h3>Fills</h3>
    ${trades.length ? `<div class="table-wrap"><table><thead><tr><th>Time</th><th>Side</th><th>Asset</th><th class="num">USDT</th><th class="num">Price</th><th class="num">P&amp;L</th><th></th></tr></thead><tbody>${trades
      .map((t) => `<tr title="${esc(t.reason)}"><td>${when(t.time)}</td><td class="${t.side === 'buy' ? 'up' : 'down'}">${t.side.toUpperCase()}</td><td class="mono">${esc(t.asset)}</td>
        <td class="num">${usd(t.usdt)}</td><td class="num">${t.exec_price.toPrecision(6)}</td><td class="num ${pnlClass(t.realized_pnl)}">${t.realized_pnl == null ? '' : usd(t.realized_pnl)}</td>
        <td>${t.tx_hash ? `<a href="${explorer(`tx/${t.tx_hash}`)}" target="_blank">tx ↗</a>` : ''}</td></tr>`)
      .join('')}</tbody></table></div>` : '<p class="dim">No fills yet.</p>'}
    <h3>Decision log</h3>
    <ul class="decisions">${decisions.slice(0, 20).map((d) => `<li><span class="t">${when(d.time)}</span><span class="mono">${esc(d.asset)}</span><span>${d.action ? `<b>${esc(d.action)}</b> ` : ''}<span class="muted">${esc(d.error ?? d.reason ?? '')}</span></span></li>`).join('') || '<li class="dim">None yet.</li>'}</ul>`
  $('#detail').showModal()
  $('#detail').scrollTop = 0
  requestAnimationFrame(syncInks)
  drawChart(b, trades, b.assets[0])
  $$('#chart-assets button').forEach((x) =>
    x.addEventListener('click', () => {
      $$('#chart-assets button').forEach((y) => y.classList.toggle('active', y === x))
      syncInks()
      drawChart(b, trades, x.dataset.asset)
    }),
  )
}
// Close the drawer on a backdrop click (outside its box), not on empty space inside it.
$('#detail').addEventListener('click', (e) => {
  const r = $('#detail').getBoundingClientRect()
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) $('#detail').close()
})

let chart = null
let chartReplay = null
const dropBotChart = () => {
  chartReplay?.stop()
  chart?.remove()
  chart = chartReplay = null
}
$('#detail').addEventListener('close', dropBotChart)

async function drawChart(b, trades, asset) {
  dropBotChart()
  const el = $('#chart')
  if (!window.LightweightCharts) return void ($('#chart-note').textContent = 'Chart library failed to load.')
  const [data, lv] = await Promise.all([
    api(`/assets/${asset}/candles?timeframe=${b.timeframe}&limit=200`).catch((err) => ({ error: err.message })),
    api(`/api/bots/${b.id}/levels?asset=${asset}`).catch(() => ({ levels: [] })),
  ])
  if (!data.candles?.length) return void ($('#chart-note').textContent = `No candles for ${asset}${data.error ? `: ${data.error}` : ''}.`)

  const candles = toBars(data.candles)
  chart = newChart(el)
  chartReplay = new Replay(chart)
  const series = chartReplay.add(LightweightCharts.CandlestickSeries, candleOptions(), candles)

  // Each trade goes on the candle it happened in; markers must be in time order.
  const first = candles[0].time
  const mine = trades.filter((t) => t.asset === asset).sort((x, y) => x.time.localeCompare(y.time))
  const markers = mine
    .map((t) => {
      const at = Date.parse(t.time) / 1000 + TZ
      const bar = candles.findLast((c) => c.time <= at)
      if (!bar || at < first) return null
      const buy = t.side === 'buy'
      return {
        time: bar.time,
        position: buy ? 'belowBar' : 'aboveBar',
        color: buy ? color('--up') : color('--down'),
        shape: buy ? 'arrowUp' : 'arrowDown',
        text: buy ? `B ${usd(t.usdt)}` : `S ${usd(t.usdt)}${t.realized_pnl == null ? '' : ` (${t.realized_pnl >= 0 ? '+' : ''}${usd(t.realized_pnl)})`}`,
      }
    })
    .filter(Boolean)
  chartReplay.markers(series, markers)

  // Entry, exits and the strategy's next triggers as horizontal price lines.
  const LINE = {
    entry: [color('--accent'), LightweightCharts.LineStyle.Solid],
    stop: [color('--down'), LightweightCharts.LineStyle.Dashed],
    target: [color('--up'), LightweightCharts.LineStyle.Dashed],
    trail: [color('--live'), LightweightCharts.LineStyle.Dashed],
    buy: [color('--up'), LightweightCharts.LineStyle.Dotted],
    sell: [color('--down'), LightweightCharts.LineStyle.Dotted],
  }
  for (const l of lv.levels) {
    const [lineColor, lineStyle] = LINE[l.kind] ?? LINE.entry
    series.createPriceLine({ price: l.price, color: lineColor, lineStyle, lineWidth: l.kind === 'entry' ? 2 : 1, axisLabelVisible: true, title: l.label })
  }
  // Show about three days, or back to the first trade if that is further.
  const from = Math.min(candles.length - 72, markers.length ? candles.findIndex((c) => c.time === markers[0].time) - 5 : Infinity)
  chartReplay.play({ range: { from: Math.max(0, from), to: candles.length + 6 } })

  const hidden = mine.length - markers.length
  $('#chart-note').textContent =
    `${data.source?.startsWith('geckoterminal') ? 'HashKey pool' : `Market reference (${data.source})`} candles, ${b.timeframe}. ` +
    `${markers.length} trade${markers.length === 1 ? '' : 's'} marked (B = buy, S = sell; fill prices in the table below)` +
    (hidden ? `; ${hidden} older trade${hidden === 1 ? '' : 's'} outside the window.` : '.') +
    (lv.position > 0
      ? ` Entry and exits use the HashKey pool price (now ${lv.poolPrice?.toPrecision(6)}), which can sit below the market candles.`
      : lv.levels.length
        ? ' No open position; dotted lines are where the strategy buys next.'
        : ` No open position; ${b.strategy} buys on an indicator signal, not a fixed price.`)
}

// --- account -----------------------------------------------------------------------------

// Wallet value in USD from token balances and the latest prices (USDT counts at $1).
const walletUsd = () =>
  me?.balances
    ? Object.entries(me.balances).reduce((sum, [k, v]) => sum + Number(v) * (prices.get(k.toLowerCase())?.priceUsd ?? (/usd/i.test(k) ? 1 : 0)), 0)
    : null

function renderWalletPill() {
  const pill = $('#wallet-pill-value')
  if (pill && me) pill.textContent = usd(walletUsd())
}

function renderAccount() {
  $('#account').innerHTML = me
    ? `<button class="wallet-pill" id="wallet-pill" type="button" title="${esc(me.wallet)}">${icon('wallet')}<span id="wallet-pill-value">${usd(walletUsd())}</span>${icon('chevron')}</button>`
    : `<button class="wallet-pill" id="login" type="button">${icon('login')}<span>Log in</span></button>`
  $('#login')?.addEventListener('click', openLogin)
  $('#wallet-pill')?.addEventListener('click', () => showTab('mine'))
  const side = $('#side-auth')
  side.innerHTML = me ? `${icon('logout')}<span>Log out</span>` : `${icon('login')}<span>Log in</span>`
  side.onclick = me ? logout : openLogin
  $('#welcome').textContent = me ? `Welcome back, @${me.username}` : 'Welcome to Swordfish'
  $('#mine-welcome').textContent = me ? `Signed in as @${me.username}` : 'Your custody wallet and bots'
  const tg = tgLink()
  for (const a of [$('#bolt'), $('#help-link')]) if (tg) a.href = tg
}

async function logout() {
  await api('/api/logout', { method: 'POST' })
  me = null
  renderAccount()
  toast('Signed out')
  if (!$('#mine').hidden) loadMine()
}

function onSignedIn(user) {
  me = user
  renderAccount()
  toast(`Connected as @${user.username}`)
  if (!$('#mine').hidden) loadMine()
}

// While signed out, check for a session so this tab updates once a /web link is opened elsewhere.
let loginWatch = null
function watchLogin() {
  if (loginWatch) return
  loginWatch = setInterval(async () => {
    if (document.hidden || me) return
    const user = await api('/api/me').catch(() => null)
    if (!user) return
    clearInterval(loginWatch)
    loginWatch = null
    if ($('#login-dialog').open) return
    onSignedIn(user)
  }, 3000)
}

// --- sign in: Log in -> bot opens with a one-time code -> Approve in Telegram ----------------

const CHECK = `<svg class="check" viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg>`
let login = null // { code, expires, timer }

function stopLogin() {
  clearInterval(login?.timer)
  login = null
}
$('#login-dialog').addEventListener('close', stopLogin)

// Left panel: fine vertical stripes grouped into bars, with two lines drawing across them.
function drawAuthArt() {
  const svg = $('#auth-chart')
  if (svg.dataset.ready) return
  svg.dataset.ready = '1'
  const W = 600, H = 700
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const stripes = []
  let h = 0
  for (let x = 0; x < W; x += 4.2) {
    if (Math.floor(x / 42) !== Math.floor((x - 4.2) / 42)) h = 120 + rnd() * 340
    stripes.push(`<rect x="${x.toFixed(1)}" y="${(H - h).toFixed(1)}" width="1.3" height="${h.toFixed(1)}"/>`)
  }
  const line = (base, amp) => {
    let y = base
    const pts = []
    for (let x = 0; x <= W; x += 30) {
      y = Math.max(190, Math.min(430, y - (x / W) * 7 + (rnd() - 0.5) * amp))
      pts.push(`${x} ${y.toFixed(1)}`)
    }
    return `M${pts.join('L')}`
  }
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
  svg.setAttribute('preserveAspectRatio', 'xMidYMax slice')
  svg.innerHTML = `<g class="bars">${stripes.join('')}</g>
    <path class="l-white" d="${line(390, 60)}" pathLength="1"/><path class="l-orange" d="${line(425, 80)}" pathLength="1"/>`
}

function renderAuthFloat() {
  const top = pulse.rows[0]
  const today = new Date().toLocaleDateString('en-GB').replaceAll('/', '.')
  const ch = change24('wbtc')
  $('#auth-float').innerHTML = top
    ? `<div class="f-top"><span class="f-ico">${icon('bolt')}</span><span><b>Top strategy</b><small>${today}</small></span></div>
       <div class="f-lab">${esc(top.name)}</div><div class="f-val">${pct(top.pnl_pct)}</div>
       <div class="f-state">${icon('clock')}${esc(top.status === 'running' ? 'Running' : top.status)}</div>`
    : `<div class="f-top"><span class="f-ico">₿</span><span><b>Market</b><small>${today}</small></span></div>
       <div class="f-lab">WBTC</div><div class="f-val">${ch == null ? `$${px(prices.get('wbtc')?.priceUsd)}` : pct(ch)}</div>
       <div class="f-state">${icon('clock')}Live on HashKey Chain</div>`
}

const copyBtn = (text) => `<button type="button" data-copy="${esc(text)}" aria-label="Copy">${icon('copy')}</button>`
function bindCopy(root) {
  root.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => navigator.clipboard.writeText(b.dataset.copy).then(() => toast('Copied'))))
}

async function openLogin() {
  stopLogin()
  drawAuthArt()
  renderAuthFloat()
  const dlg = $('#login-dialog')
  const body = $('#login-body')
  body.innerHTML = `<h2>Sign In Account</h2><p class="sub">Preparing a secure sign-in request…</p>`
  if (!dlg.open) dlg.showModal()
  let req
  try {
    req = await api('/api/auth/request', { method: 'POST' })
  } catch (err) {
    return void (body.innerHTML = `<h2>Sign In Account</h2><p class="sub">Sign-in is unavailable right now.</p>
      <div class="field bad"><label>Error</label><div class="box"><span class="grow">${esc(err.message)}</span></div></div>`)
  }
  const bot = req.bot ?? info.telegramBot
  const start = `login_${req.code}`
  const web = `https://web.telegram.org/k/#?tgaddr=${encodeURIComponent(`tg://resolve?domain=${bot}&start=${start}`)}`
  const app = `https://t.me/${encodeURIComponent(bot)}?start=${start}`
  login = { code: req.code, expires: Date.now() + req.ttlSec * 1000 }
  body.innerHTML = `<h2>Sign In Account</h2>
    <p class="sub">Approve this browser from your Telegram account</p>
    <div class="field"><label>Telegram bot</label><div class="box"><span class="grow">@${esc(bot)}</span>${copyBtn(`@${bot}`)}</div></div>
    <div class="field"><label>Sign-in code</label><div class="box"><code class="grow">/start ${start}</code>${copyBtn(`/start ${start}`)}</div>
      <p class="hint">Sent for you when you open the bot. Expires in <span id="login-ttl">10:00</span></p></div>
    <div class="field wait" id="login-state"><label>Status</label><div class="box"><span class="spin"></span><span class="grow">Waiting for approval in Telegram</span></div>
      <p class="hint">Press <b>Start</b> in the chat, then tap ✅ Approve sign-in.</p></div>
    <a class="btn-red" href="${web}" target="_blank">Open Telegram Web</a>
    <p class="auth-alt">Have the Telegram app? <a href="${app}" target="_blank">Open in app</a></p>`
  bindCopy(body)
  const tick = async () => {
    if (!login) return
    const left = Math.max(0, login.expires - Date.now())
    $('#login-ttl').textContent = `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`
    const r = await api(`/api/auth/poll?code=${encodeURIComponent(login.code)}`).catch(() => ({ status: 'pending' }))
    if (!login) return
    if (r.status === 'approved') {
      stopLogin()
      $('#login-state').className = 'field ok'
      $('#login-state .box').innerHTML = `${icon('check')}<span class="grow">Approved as @${esc(r.username)}</span>`
      const user = await api('/api/me').catch(() => null)
      setTimeout(() => {
        body.innerHTML = `<div class="login-done">${CHECK}<h2>Connected</h2><p class="sub">Signed in as <b>@${esc(r.username)}</b>. Loading your wallet and bots…</p></div>`
      }, 600)
      setTimeout(() => {
        $('#login-dialog').close()
        if (user) onSignedIn(user)
        if (user && $('#mine').hidden) showTab('mine')
      }, 2000)
    } else if (r.status === 'expired' || left === 0) {
      stopLogin()
      $('#login-state').className = 'field bad'
      $('#login-state .box').innerHTML = `<span class="grow">Request expired</span>`
      $('#login-state .hint').textContent = 'Sign-in requests last 10 minutes. Start a new one to continue.'
      body.querySelector('.btn-red').outerHTML = `<button class="btn-red" id="login-retry" type="button">Try again</button>`
      $('#login-retry').addEventListener('click', openLogin)
    }
  }
  login.timer = setInterval(tick, 2000)
  tick()
}

// --- portfolio -------------------------------------------------------------------------

async function loadMine() {
  if (!me) {
    const bot = info.telegramBot ? `@${esc(info.telegramBot)}` : 'the Swordfish bot'
    $('#login-note').hidden = false
    $('#login-note').innerHTML = `${EMPTY_ART}<p class="eyebrow">Authentication</p><h2>Sign in with Telegram</h2>
      <p>Wallets are created and held by ${bot}. Approve the sign-in from your Telegram account; it works with Telegram Web, so no app is needed.</p>
      <div class="steps"><div><b>01</b>Click <b>Sign in</b> and open the bot</div><div><b>02</b>Press <b>Start</b> in the chat</div><div><b>03</b>Tap <b>Approve sign-in</b></div></div>
      <div class="actions"><button class="btn glossy" id="gate-login" type="button">${icon('login')}Sign in with Telegram</button></div>
      <p class="dim small gate-alt">Already have a login link from <code>/web</code>? Open it in this browser and this page updates by itself.</p>`
    $('#gate-login').addEventListener('click', openLogin)
    watchLogin()
    $('#wallet').hidden = true
    $('#new-bot').hidden = true
    $('#my-bots-panel').hidden = true
    $('#my-bots').innerHTML = ''
    return
  }
  $('#login-note').hidden = true
  me = await api('/api/me')
  renderWalletPill()
  $('#wallet').hidden = false
  $('#wallet').innerHTML = `<div class="card-head"><h2>Custody wallet</h2><span class="dim small">Worth about <b class="muted">${usd(walletUsd())}</b></span></div>
    <p class="dim small lead">Deposit USDT plus a little HSK for gas on HashKey Chain to run live strategies. Withdraw with <code>/withdraw</code> in Telegram.</p>
    <div class="addr"><a href="${explorer(`address/${me.wallet}`)}" target="_blank">${me.wallet}</a><button class="btn sm ghost" id="copy" type="button">${icon('copy')}Copy</button><button class="btn sm ghost" id="wallet-logout" type="button">${icon('logout')}Log out</button></div>
    <div class="balances">${Object.entries(me.balances).map(([k, v]) => `<div><span>${esc(k.toUpperCase())}</span><b>${qty(Number(v))}</b></div>`).join('')}</div>`
  $('#copy').addEventListener('click', () => navigator.clipboard.writeText(me.wallet).then(() => toast('Address copied')))
  $('#wallet-logout').addEventListener('click', logout)
  const bots = await api('/api/me/bots')
  $('#my-bots-panel').hidden = false
  $('#my-bots').innerHTML =
    bots
      .map(
        (b, i) => `<div class="bot-card" style="animation-delay:${i * 50}ms">
          <div class="top"><b>${esc(b.name)}</b><span class="tag ${b.mode}">${b.mode}</span></div>
          <div class="meta">#${b.id} · ${esc(b.strategy)} · ${b.assets.map(esc).join(', ')} · ${esc(b.timeframe)}</div>
          <div class="figs"><b class="${pnlClass(b.pnlPct)}">${pct(b.pnlPct)}</b><span>${usd(b.equityUsd)}<br>${b.trades} fills</span></div>
          <div class="acts"><span class="status ${esc(b.status)}">${esc(b.status)}</span>
            <button class="btn sm ghost" data-open="${b.id}" type="button">Details</button>
            ${b.status === 'running' ? `<button class="btn sm" data-act="stop" data-id="${b.id}" type="button">Stop</button>` : `<button class="btn sm" data-act="resume" data-id="${b.id}" type="button">Resume</button>`}
            <button class="btn sm danger" data-act="delete" data-id="${b.id}" type="button">Delete</button></div>
        </div>`,
      )
      .join('') || '<p class="dim">No strategies deployed yet. Use the form below to start one on paper.</p>'
  $$('#my-bots [data-open]').forEach((x) => x.addEventListener('click', () => openBot(x.dataset.open)))
  $$('#my-bots [data-act]').forEach((x) =>
    x.addEventListener('click', async () => {
      if (x.dataset.act === 'delete' && !confirm(`Delete bot #${x.dataset.id} and its history?`)) return
      try {
        await api(`/api/bots/${x.dataset.id}/${x.dataset.act}`, { method: 'POST' })
        toast(`Bot #${x.dataset.id}: ${x.dataset.act === 'stop' ? 'stopped' : x.dataset.act === 'resume' ? 'resumed' : 'deleted'}`)
      } catch (err) {
        toast(err.message)
      }
      loadMine()
    }),
  )
  $('#new-bot').hidden = false
}

$('#new-bot').addEventListener('submit', async (e) => {
  e.preventDefault()
  const f = new FormData(e.target)
  const params = {}
  for (const k of ['tradeUsd', 'stopLossPct', 'takeProfitPct', 'trailingStopPct']) if (f.get(k)) params[k] = Number(f.get(k))
  try {
    $('#form-error').textContent = ''
    const b = await api('/api/me/bots', {
      method: 'POST',
      body: JSON.stringify({ strategy: f.get('strategy'), assets: f.getAll('assets'), timeframe: f.get('timeframe'), params }),
    })
    toast(`Paper bot #${b.id} deployed`)
    loadMine()
  } catch (err) {
    $('#form-error').textContent = err.message
  }
})

// --- strategies --------------------------------------------------------------------

const kindOf = (s) => (s.llm ? 'AI' : s.lp ? 'Liquidity' : s.description.split(':')[0].trim())
const KIND_ICON = { All: 'layers', Trend: 'chart', 'Mean reversion': 'signal', Breakout: 'bolt-line', Liquidity: 'pie', AI: 'sparkle' }
let strategies = []

async function loadStrategies() {
  strategies = await api('/api/strategies')
  $('#strategy-list').innerHTML = strategies
    .map((s, i) => {
      const kind = kindOf(s)
      const desc = s.description.includes(':') ? s.description.slice(s.description.indexOf(':') + 1).trim() : s.description
      const params = Object.entries(s.params)
      return `<div class="strat" data-kind="${esc(kind)}" style="animation-delay:${i * 50}ms">
        <div class="strat-row"><span class="kind">${esc(kind)}</span>${s.llm ? '<span class="tag">Claude Haiku</span>' : ''}</div>
        ${strategyArt(s.name, kind)}
        <h4>${esc(s.name)}</h4>
        <p>${esc(desc)}</p>
        ${params.length ? `<div class="params-line">${params.map(([k, v]) => `${esc(k)}=${esc(v)}`).join('  ')}</div>` : ''}
        <div class="strat-row"><button class="link" data-preview="${esc(s.name)}" type="button">Backtest preview →</button></div>
      </div>`
    })
    .join('')
  $$('.strat').forEach((el) =>
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect()
      el.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`)
    }),
  )
  const kinds = ['All', ...new Set(strategies.map(kindOf))]
  $('#strat-filter').innerHTML = kinds.map((k, i) => `<button type="button" data-kind="${esc(k)}"${i ? '' : ' class="active"'}>${icon(KIND_ICON[k] ?? 'layers')}${esc(k)}</button>`).join('')
  $$('#strat-filter button').forEach((b) =>
    b.addEventListener('click', () => {
      $$('#strat-filter button').forEach((x) => x.classList.toggle('active', x === b))
      $$('.strat').forEach((el) => (el.hidden = b.dataset.kind !== 'All' && el.dataset.kind !== b.dataset.kind))
    }),
  )
  const options = strategies.map((s) => `<option value="${esc(s.name)}">${esc(s.name)}</option>`).join('')
  $('#new-bot select[name=strategy]').innerHTML = options
  $('#preview select[name=strategy]').innerHTML = options
  $$('[data-preview]').forEach((x) => x.addEventListener('click', () => previewStrategy(x.dataset.preview)))
}

function previewStrategy(name) {
  if ($('#strategies').hidden) showTab('strategies')
  $('#preview select[name=strategy]').value = name
  setTimeout(() => $('#preview').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' }), 100)
  loadPreview()
}

// --- assets ----------------------------------------------------------------------------

// Tradable assets: everything except stablecoins, wrapped HSK and test listings.
const PINNED = ['wbtc', 'weth', 'hsk']
const rank = (a) => (PINNED.includes(a.id) ? PINNED.indexOf(a.id) : PINNED.length)
let tradable = []

async function loadAssets() {
  const all = await api('/assets')
  tradable = all
    .filter((a) => ['crypto', 'stock'].includes(a.category) && !STABLE.test(a.id))
    .sort((a, b) => rank(a) - rank(b) || a.category.localeCompare(b.category) || a.symbol.localeCompare(b.symbol))
  const group = (cat, label) =>
    `<optgroup label="${label}">${tradable.filter((a) => a.category === cat).map((a) => `<option value="${esc(a.id)}">${esc(a.symbol)} · ${esc(a.name)}</option>`).join('')}</optgroup>`
  $('#preview select[name=asset]').innerHTML = group('crypto', 'Crypto') + group('stock', 'Tokenized stocks')
  $('#asset-picks').innerHTML = tradable
    .map((a) => `<label class="pick"><input type="checkbox" name="assets" value="${esc(a.id)}"${['wbtc', 'weth'].includes(a.id) ? ' checked' : ''}><span>${esc(a.symbol)}</span></label>`)
    .join('')
}

// --- search ------------------------------------------------------------------------------

const searchBox = $('#search')
const results = $('#search-results')
let hits = []
let hit = 0

function renderSearch() {
  const q = searchBox.value.trim().toLowerCase()
  if (!q) return void (results.hidden = true)
  hits = [
    ...tradable.filter((a) => `${a.symbol} ${a.name} ${a.id}`.toLowerCase().includes(q)).slice(0, 5).map((a) => ({ kind: 'asset', id: a.id, label: a.symbol, sub: a.name })),
    ...strategies.filter((s) => `${s.name} ${s.description}`.toLowerCase().includes(q)).slice(0, 4).map((s) => ({ kind: 'strategy', id: s.name, label: s.name, sub: kindOf(s) })),
  ]
  hit = 0
  results.hidden = false
  results.innerHTML = hits.length
    ? hits.map((h, i) => `<button type="button" data-i="${i}"${i ? '' : ' class="on"'}>${icon(h.kind === 'asset' ? 'chart' : 'compass')}<span>${esc(h.label)}</span><small>${esc(h.sub)}</small></button>`).join('')
    : '<p>No matching assets or strategies.</p>'
  results.querySelectorAll('button').forEach((b) => b.addEventListener('mousedown', (e) => (e.preventDefault(), pick(hits[b.dataset.i]))))
}

function pick(h) {
  if (!h) return
  searchBox.value = ''
  results.hidden = true
  searchBox.blur()
  if (h.kind === 'strategy') return previewStrategy(h.id)
  if (FEATURED.includes(h.id)) {
    showTab('leaderboard')
    return selectMarket(h.id)
  }
  // Other assets: open the backtest preview on them.
  showTab('strategies')
  $('#preview select[name=asset]').value = h.id
  loadPreview()
}

searchBox.addEventListener('input', renderSearch)
searchBox.addEventListener('blur', () => setTimeout(() => (results.hidden = true), 120))
searchBox.addEventListener('keydown', (e) => {
  const buttons = results.querySelectorAll('button')
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    hit = (hit + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % Math.max(1, buttons.length)
    buttons.forEach((b, i) => b.classList.toggle('on', i === hit))
  } else if (e.key === 'Enter') pick(hits[hit])
  else if (e.key === 'Escape') (searchBox.value = ''), (results.hidden = true)
})
addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && !document.querySelector('dialog[open]')) (e.preventDefault(), searchBox.focus())
})

// --- strategy preview -------------------------------------------------------------------

let previewCharts = []
let previewReplay = null
let previewSeq = 0
const previewQuery = () => {
  const f = new FormData($('#preview'))
  const q = new URLSearchParams()
  for (const [k, v] of f) if (v !== '') q.set(k, v)
  return q
}

async function loadPreview() {
  if (!window.LightweightCharts) return void ($('#preview-note').textContent = 'Chart library failed to load.')
  const seq = ++previewSeq
  const q = previewQuery()
  $('#preview-loading').classList.add('on')
  $('#preview-msg').textContent = ''
  const data = await api(`/api/preview?${q}`).catch((err) => ({ error: err.message }))
  if (seq !== previewSeq) return
  $('#preview-loading').classList.remove('on')
  previewReplay?.stop()
  for (const c of previewCharts) c.remove()
  previewCharts = []
  $('#preview-stats').innerHTML = ''
  $('#preview-legend').innerHTML = ''
  if (data.error || !data.candles?.length) return void ($('#preview-note').textContent = data.error ?? 'No candles for this asset.')

  const bars = toBars(data.candles)
  $('#preview-chart').classList.toggle('with-pane', Boolean(data.pane))
  const main = newChart($('#preview-chart'))
  previewCharts.push(main)
  const replay = (previewReplay = new Replay(main))
  const series = replay.add(LightweightCharts.CandlestickSeries, candleOptions(), bars)

  // Indicator lines: bands share a colour with a muted middle, others get the palette.
  const bands = data.lines.length === 3
  const palette = bands ? [color('--accent'), color('--dim'), color('--accent')] : [color('--accent'), color('--live'), color('--dim')]
  const legend = []
  data.lines.forEach((l, i) => {
    const c = palette[i % palette.length]
    replay.add(LightweightCharts.LineSeries, { color: c, lineWidth: bands && i === 1 ? 1 : 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, toPoints(l.data))
    legend.push([l.name, c])
  })

  replay.markers(
    series,
    data.markers.map((m) => {
      const buy = m.side === 'buy'
      return {
        time: m.time + TZ,
        position: buy ? 'belowBar' : 'aboveBar',
        color: buy ? color('--up') : color('--down'),
        shape: buy ? 'arrowUp' : 'arrowDown',
        text: buy ? 'B' : `S ${m.returnPct >= 0 ? '+' : ''}${m.returnPct.toFixed(1)}%`,
      }
    }),
  )

  // Oscillator (MACD / RSI) in a second pane that shares the time scale.
  if (data.pane) {
    if (data.pane.histogram.length) {
      replay.add(
        LightweightCharts.HistogramSeries,
        { priceLineVisible: false, lastValueVisible: false },
        toPoints(data.pane.histogram).map((d) => ({ ...d, color: alpha(color(d.value >= 0 ? '--up' : '--down'), 0.7) })),
        1,
      )
      legend.push([`${data.pane.title} histogram`, color('--up')])
    }
    data.pane.lines.forEach((l, i) => {
      const lineColor = [color('--accent'), color('--live')][i % 2]
      // Keep threshold lines (RSI 30/70) in view even when the indicator never reaches them.
      const autoscaleInfoProvider = (base) => {
        const r = base()
        if (!r || !data.pane.hlines.length) return r
        const levels = data.pane.hlines.map((h) => h.price)
        return { ...r, priceRange: { minValue: Math.min(r.priceRange.minValue, ...levels), maxValue: Math.max(r.priceRange.maxValue, ...levels) } }
      }
      const s = replay.add(LightweightCharts.LineSeries, { color: lineColor, lineWidth: 2, priceLineVisible: false, crosshairMarkerVisible: false, autoscaleInfoProvider }, toPoints(l.data), 1)
      if (i === 0) for (const h of data.pane.hlines) s.createPriceLine({ price: h.price, color: color('--dim'), lineStyle: LightweightCharts.LineStyle.Dashed, lineWidth: 1, title: h.label })
      legend.push([l.name, lineColor])
    })
    main.panes()[0].setStretchFactor(3)
    main.panes()[1]?.setStretchFactor(1)
  }
  replay.play({ duration: 1800 })

  $('#preview-legend').innerHTML =
    legend.map(([name, c]) => `<span><i style="background:${c}"></i>${esc(name)}</span>`).join('') +
    (data.stats ? `<span><b class="up">▲ B</b> buy</span><span><b class="down">▼ S</b> sell (return after fees)</span>` : '')

  const st = data.stats
  const days = ((data.candles.at(-1).time - data.candles[0].time) / 86_400).toFixed(0)
  if (st) {
    $('#preview-stats').innerHTML = [
      ['Round trips', st.roundTrips + (st.openPct != null ? ' + open' : '')],
      ['Win rate', st.winRatePct == null ? '–' : `${st.winRatePct.toFixed(0)}%`],
      ['Strategy return', `<span class="${pnlClass(st.returnPct)}">${pct(st.returnPct)}</span>`],
      ['Buy & hold', `<span class="${pnlClass(st.buyHoldPct)}">${pct(st.buyHoldPct)}</span>`],
      ...(st.lp ? [['LP fees earned', `<span class="up">${pct(st.feesEarnedPct)}</span>`]] : []),
    ]
      .map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`)
      .join('')
  }
  $('#preview-note').innerHTML =
    data.warnings.map((w) => `<span class="error">⚠ ${esc(w)}</span>`).join('') +
    esc(`${data.symbol}, ${data.candles.length} × ${data.timeframe} candles (~${days} days) from ${data.source?.startsWith('geckoterminal') ? 'the HashKey pool' : data.source}. ` +
    (st?.lp
      ? `Simulated one-sided liquidity: USDT sits in a range just below the price and fills as the price falls through it, then the coin sits in a range above entry to sell back. Fees are estimated as ${st.feePct}% of the value that crosses the range; real fills need the HashKey pool itself to trade through the range.`
      : st
      ? `Replayed one position at a time with your exit rules and the ${st.feePct}% pool fee on each swap; price impact and pool lag are not included, and past signals do not predict future ones.`
      : 'Claude is not replayed (that would take one AI call per candle); the chart shows the indicators it reads: Bollinger Bands and RSI.'))
}

$('#preview').addEventListener('change', loadPreview)
$('#preview').addEventListener('submit', (e) => e.preventDefault())
$('#preview-create').addEventListener('click', async () => {
  if (!me) return openLogin()
  const q = previewQuery()
  const params = {}
  for (const k of ['stopLossPct', 'takeProfitPct', 'trailingStopPct']) if (q.has(k)) params[k] = Number(q.get(k))
  try {
    const b = await api('/api/me/bots', { method: 'POST', body: JSON.stringify({ strategy: q.get('strategy'), assets: [q.get('asset')], timeframe: q.get('timeframe'), params }) })
    $('#preview-msg').innerHTML = `<span class="up">Paper bot #${b.id} deployed.</span> <span class="muted">See it under Portfolio.</span>`
    toast(`Paper bot #${b.id} deployed`)
  } catch (err) {
    $('#preview-msg').innerHTML = `<span class="error">${esc(err.message)}</span>`
  }
})

// --- boot ----------------------------------------------------------------------------

hydrateIcons()
bindTabs()
syncInks()
pollBlock()
setInterval(pollBlock, 4_000)
info = await api('/api/info').catch(() => ({}))
me = await api('/api/me').catch(() => null)
renderAccount()
await loadPrices()
await Promise.all([loadMarkets(), loadStrategies(), loadAssets().catch(() => {}), loadOverview()])
// #strategies, #board and #mine open that view; #login opens the sign-in screen.
const linked = location.hash.slice(1)
if (TABS.includes(linked) && linked !== 'leaderboard') showTab(linked)
if (linked === 'login' && !me) openLogin()
syncInks()
setInterval(loadPrices, 15_000)
setInterval(refreshMarket, 30_000)
setInterval(() => !$('#leaderboard').hidden && loadOverview(), 60_000)
setInterval(() => !$('#board-view').hidden && loadBoard(), 60_000)
