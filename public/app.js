// Swordfish dashboard: markets, leaderboard, your wallet and bots, strategy catalogue.

import { strategyArt } from '/art.js'
import { alpha, areaOptions, candleOptions, css as color, localTime, newChart, openTradingView, Replay, toBars, toPoints, TV_SYMBOLS, TZ } from '/charts.js'

const $ = (sel) => document.querySelector(sel)
const $$ = (sel) => document.querySelectorAll(sel)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const usd = (n) => (n == null ? '–' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }))
const compact = (n) => (n == null ? '–' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }))
const round2 = (n) => (Math.abs(n) < 0.005 ? 0 : n)
const pct = (n) => (n == null ? '–' : `${round2(n) > 0 ? '+' : ''}${round2(n).toFixed(2)}%`)
const pnlClass = (n) => (n == null ? '' : round2(n) > 0 ? 'up' : round2(n) < 0 ? 'down' : '')
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

// Copy to the clipboard; browsers can refuse (unfocused page, permissions), so say so.
const copyText = (text, done) =>
  navigator.clipboard?.writeText(text).then(() => toast(done), () => toast('Couldn\'t copy. Select the text and copy it manually.')) ??
  toast('Couldn\'t copy. Select the text and copy it manually.')

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
  arrowUp: '<path d="M7 17 17 7M8.5 7H17v8.5"/>',
  arrowDown: '<path d="M17 7 7 17M15.5 17H7V8.5"/>',
  swap: '<path d="m7 4-3.5 3.5L7 11M3.5 7.5h13M17 13l3.5 3.5L17 20M20.5 16.5h-13"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  pause: '<path d="M8.5 5.5v13M15.5 5.5v13"/>',
  send: '<path d="M21 3.5 3.5 10.6l6.4 2.3M21 3.5l-3.4 17-7.7-7.7M21 3.5 9.9 12.9"/>',
  external: '<path d="M14 4.5h5.5V10M19.5 4.5 11 13M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
  user: '<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
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
  // The middle column scrolls on desktop; the body or the page does on smaller screens.
  for (const el of [$('.content'), $('.body'), document.scrollingElement]) el?.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })
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

// Hot assets sparkline over the same 24h window as the change badge: a smoothed line coloured by
// direction, a soft fill, a dashed line at the window's opening price and a dot on the last close.
const SPARK_W = 76
const SPARK_H = 36

// Monotone cubic path (Fritsch–Carlson): smooth, and never overshoots the real highs and lows.
function smoothPath(pts) {
  const n = pts.length
  const d = pts.slice(0, -1).map(([x, y], i) => (pts[i + 1][1] - y) / (pts[i + 1][0] - x))
  const m = pts.map((_, i) => (i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2))
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) (m[i] = 0), (m[i + 1] = 0)
    else {
      const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b
      if (h > 9) (m[i] = (3 * a * d[i]) / Math.sqrt(h)), (m[i + 1] = (3 * b * d[i]) / Math.sqrt(h))
    }
  }
  const f = (v) => v.toFixed(1)
  return pts.reduce((path, [x, y], i) => {
    if (!i) return `M${f(x)} ${f(y)}`
    const [x0, y0] = pts[i - 1], dx = (x - x0) / 3
    return `${path}C${f(x0 + dx)} ${f(y0 + m[i - 1] * dx)} ${f(x - dx)} ${f(y - m[i] * dx)} ${f(x)} ${f(y)}`
  }, '')
}

function sparkline(candles, id) {
  const W = SPARK_W, H = SPARK_H, pad = 4
  const win = (candles ?? []).slice(-25)
  if (win.length < 2) return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path class="spark-base" d="M2 ${H / 2}H${W - 2}"/></svg>`
  // Average into at most 16 buckets so hourly noise doesn't turn into jitter at this size.
  const step = Math.max(1, Math.ceil(win.length / 16))
  const ys = []
  for (let i = 0; i < win.length; i += step) ys.push(win.slice(i, i + step).reduce((a, c) => a + c.close, 0) / win.slice(i, i + step).length)
  ys[0] = win[0].close
  ys[ys.length - 1] = win.at(-1).close
  const open = ys[0]
  const lo = Math.min(...ys, open), hi = Math.max(...ys, open), span = hi - lo || 1
  const y = (v) => (hi === lo ? H / 2 : H - pad - ((v - lo) / span) * (H - pad * 2))
  const pts = ys.map((v, i) => [2 + (i / (ys.length - 1)) * (W - 8), y(v)])
  const line = smoothPath(pts)
  const dir = round2((win.at(-1).close / open - 1) * 100) > 0 ? 'up' : round2((win.at(-1).close / open - 1) * 100) < 0 ? 'down' : 'flat'
  const [lx, ly] = pts.at(-1)
  return `<svg class="spark ${dir}" viewBox="0 0 ${W} ${H}" aria-hidden="true">
    <defs><linearGradient id="sg-${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" class="s0"/><stop offset="1" class="s1"/></linearGradient></defs>
    <path class="spark-base" d="M2 ${y(open).toFixed(1)}H${W - 6}"/>
    <path class="spark-area" d="${line}L${lx.toFixed(1)} ${H}L2 ${H}Z" fill="url(#sg-${id})"/>
    <path class="spark-line" d="${line}" pathLength="1"/>
    <circle class="spark-ring" cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2.5"/>
    <circle class="spark-dot" cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2.5"/>
  </svg>`
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
        ${sparkline(data[i].candles, id)}
      </button>`
    })
    .join('')
  $$('.hot-row[data-asset]').forEach((el) => el.addEventListener('click', () => openAsset(el.dataset.asset)))
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
    $('#pulse-share').addEventListener('click', () => copyText(location.href, 'Dashboard link copied'))
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

// Home's Top strategies card shows paper or live bots, like the leaderboard.
let homeMode = 'paper'
$$('#home-mode button').forEach((b) =>
  b.addEventListener('click', () => {
    homeMode = b.dataset.mode
    $$('#home-mode button').forEach((x) => x.classList.toggle('active', x === b))
    syncInks()
    renderHomeBoard()
  }),
)
// "View leaderboard" opens the full board on the same mode.
$('#home-view-all').addEventListener('click', () => {
  mode = homeMode
  $$('#mode button').forEach((x) => x.classList.toggle('active', x.dataset.mode === mode))
  showTab('board')
})

function renderHomeBoard() {
  for (const b of $$('#home-mode button')) b.innerHTML = `${b.dataset.mode === 'paper' ? 'Paper' : 'Live'}<span class="count">${pulse[b.dataset.mode].length}</span>`
  syncInks()
  const rows = pulse.rows.filter((r) => r.mode === homeMode).slice(0, 5)
  const tg = tgLink()
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
    : homeMode === 'live'
      ? `<tbody><tr><td class="empty">${EMPTY_ART}<h4>No live strategies yet</h4><p>A bot goes live when you move it from paper to real funds in Telegram: open the bot, tap 🚀 Go live, pick a USDT budget and confirm.</p>
        <div class="actions">${tg ? `<a class="btn glossy" href="${tg}" target="_blank">Open the Telegram bot</a>` : ''}</div></td></tr></tbody>`
      : `<tbody><tr><td class="empty">${EMPTY_ART}<h4>No paper strategies yet</h4><p>Deploy a paper strategy to start a track record. Fills are quoted against live pool liquidity.</p>
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

// --- detail popup ------------------------------------------------------------------------------
// One popup layout (the wallet view's) for an asset, a bot or a strategy: a headline figure with
// actions, a range switch and a replayed chart on the left; a summary card and tabs on the right.

const dm = { spec: null, range: null, tab: null, data: null, chart: null, replay: null, main: null, seq: 0 }
const precisionFor = (v) => (Math.abs(v) >= 1 ? 2 : Math.min(8, Math.ceil(-Math.log10(Math.abs(v) || 1e-8)) + 3))

function dropDetailChart() {
  dm.replay?.stop()
  dm.chart?.remove()
  dm.chart = dm.replay = dm.main = null
}
$('#dm').addEventListener('close', () => {
  dm.seq++
  dropDetailChart()
})
// Close on a backdrop click (outside the popup's box).
$('#dm').addEventListener('click', (e) => {
  // Backdrop clicks target the dialog itself; keyboard-activated buttons report 0,0, so check both.
  if (e.target !== $('#dm')) return
  const r = $('#dm').getBoundingClientRect()
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) $('#dm').close()
})

function openDetail(spec) {
  dm.spec = spec
  dm.range = spec.range ?? null
  dm.tab = spec.tabs?.[0]?.[0] ?? null
  dm.data = null
  const el = $('#dm-body')
  const card = spec.card
  el.innerHTML = `<div class="wv">
    <div class="wv-main">
      <svg class="wv-bars" id="dm-bars" aria-hidden="true"></svg>
      <div class="wv-top">
        <div>
          <p class="wv-label">${spec.label}</p>
          <div class="wv-total"><b id="dm-value">${spec.value}</b><span class="badge ${spec.badge?.cls ?? ''}" id="dm-badge"${spec.badge ? '' : ' hidden'}>${spec.badge?.text ?? ''}</span></div>
          <p class="wv-sub" id="dm-sub">${spec.sub ?? ''}</p>
        </div>
        <div class="wv-actions">${spec.actions
          .map((a, i) => `<button class="round${a.wide ? ' wide' : ''}" data-a="${i}" type="button" title="${esc(a.title)}">${a.icon ? icon(a.icon) : ''}${a.text ? `<span>${esc(a.text)}</span>` : ''}</button>`)
          .join('')}</div>
      </div>
      ${spec.ranges ? `<div class="wv-ranges">${spec.ranges.map((r) => `<button type="button" data-range="${r}"${r === dm.range ? ' class="active"' : ''}>${r.toUpperCase()}</button>`).join('')}</div>` : ''}
      <div class="wv-chart"><div id="dm-chart"></div><div class="tip" id="dm-tip" hidden></div><p class="wv-empty" id="dm-empty" hidden></p></div>
      <div class="wv-legend" id="dm-legend"></div>
    </div>
    <div class="wv-side">
      <div class="wv-addr dm-head">${spec.head}<button class="icon-btn" id="dm-close" type="button" title="Close">${icon('x')}</button></div>
      ${card ? `<div class="profit">
        <div><p>${card.label}</p><div class="profit-v"><b class="${card.valueCls ?? ''}" id="dm-card-value">${card.value}</b><span class="badge ${card.badge?.cls ?? ''}" id="dm-card-badge"${card.badge ? '' : ' hidden'}>${card.badge?.text ?? ''}</span></div>
          <small id="dm-card-small">${card.small ?? ''}</small></div>
        <svg class="profit-spark" id="dm-spark" viewBox="0 0 150 64" aria-hidden="true"></svg>
      </div>` : ''}
      ${spec.tabs ? `<div class="wv-tabs" style="grid-template-columns: repeat(${spec.tabs.length}, 1fr)">${spec.tabs.map(([k, label]) => `<button type="button" data-dtab="${k}"${k === dm.tab ? ' class="active"' : ''}>${label}</button>`).join('')}</div>` : ''}
      <div class="wv-grid" id="dm-grid"></div>
    </div>
  </div>`
  el.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => spec.actions[b.dataset.a].run()))
  el.querySelectorAll('[data-range]').forEach((b) =>
    b.addEventListener('click', () => {
      dm.range = b.dataset.range
      el.querySelectorAll('[data-range]').forEach((x) => x.classList.toggle('active', x === b))
      drawDetailChart()
    }),
  )
  el.querySelectorAll('[data-dtab]').forEach((b) =>
    b.addEventListener('click', () => {
      dm.tab = b.dataset.dtab
      el.querySelectorAll('[data-dtab]').forEach((x) => x.classList.toggle('active', x === b))
      renderDetailTab()
    }),
  )
  $('#dm-close').addEventListener('click', () => $('#dm').close())
  if (!$('#dm').open) $('#dm').showModal()
  $('#dm').scrollTop = 0
  drawStripes($('#dm-bars'), 0.05)
  setLegend(spec.legend ?? [])
  renderDetailTab()
  drawDetailChart()
}

function setLegend(items) {
  $('#dm-legend').innerHTML = items.map(([cls, label]) => `<span><i class="${cls}"></i>${esc(label)}</span>`).join('')
}

function renderDetailTab() {
  const grid = $('#dm-grid')
  grid.className = 'wv-grid'
  dm.spec.renderTab?.(dm.tab, grid)
  hydrateIcons(grid)
}

async function drawDetailChart() {
  const seq = ++dm.seq
  const spec = dm.spec
  $('#dm-empty').hidden = true
  const data = await spec.chart(dm.range).catch((err) => ({ empty: err.message }))
  if (seq !== dm.seq || spec !== dm.spec) return
  dm.data = data
  dropDetailChart()
  $('#dm-tip').hidden = true
  drawSpark($('#dm-spark'), data.spark ?? [])
  if (data.legend) setLegend(data.legend)
  spec.onData?.(data)
  const main = data.lines?.[0]?.data ?? []
  if (data.empty || main.length < 2) {
    $('#dm-empty').hidden = false
    $('#dm-empty').textContent = data.empty ?? 'Not enough history for this range yet.'
    return
  }
  const chart = (dm.chart = newChart($('#dm-chart'), {
    leftPriceScale: { visible: true, borderVisible: false, scaleMargins: { top: 0.16, bottom: 0.1 } },
    rightPriceScale: { visible: false },
    grid: { vertLines: { visible: false }, horzLines: { visible: false } },
    timeScale: { borderVisible: false, timeVisible: true, rightOffset: 2, shiftVisibleRangeOnNewBar: false },
  }))
  const replay = (dm.replay = new Replay(chart))
  data.lines.forEach((l, i) => {
    const precision = l.precision ?? 2
    const series = replay.add(
      LightweightCharts.LineSeries,
      {
        priceScaleId: 'left', priceLineVisible: false, lastValueVisible: false, color: l.color, lineWidth: l.width ?? 2,
        lineStyle: l.dashed ? LightweightCharts.LineStyle.Dashed : LightweightCharts.LineStyle.Solid,
        priceFormat: { type: 'price', precision, minMove: 10 ** -precision },
        crosshairMarkerVisible: i === 0, crosshairMarkerRadius: 5, crosshairMarkerBorderWidth: 3,
        crosshairMarkerBackgroundColor: l.color, crosshairMarkerBorderColor: alpha(color('--accent'), 0.35),
      },
      l.data,
    )
    if (!i) dm.main = series
  })
  if (data.markers?.length) replay.markers(dm.main, data.markers)
  if (data.baseline != null) dm.main.createPriceLine({ price: data.baseline, color: alpha('#ffffff', 0.25), lineStyle: LightweightCharts.LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false })
  chart.subscribeCrosshairMove((p) => {
    const tip = $('#dm-tip')
    const d = p?.point && p.seriesData.get(dm.main)
    const y = d && dm.main.priceToCoordinate(d.value)
    if (!d || y == null) return void (tip.hidden = true)
    tip.innerHTML = data.tip(d.value)
    tip.style.left = `${p.point.x}px`
    tip.style.top = `${y}px`
    tip.hidden = false
  })
  replay.play({ duration: 1500 })
}

const statCards = (rows) =>
  rows.map(([label, value, cls], i) => `<div class="hold stat" style="animation-delay:${i * 50}ms"><span>${label}</span><b class="${cls ?? ''}">${value}</b></div>`).join('')
const miniRows = (rows) => `<div class="mini-list">${rows.join('')}</div>`

// Open the Portfolio deploy form with these settings filled in (sign-in first if needed).
function deployOn(assets, strategy) {
  $('#dm').close()
  if (!me) return openLogin()
  showTab('mine')
  if (strategy) $('#new-bot select[name=strategy]').value = strategy
  $$('#asset-picks input').forEach((i) => (i.checked = assets.includes(i.value)))
  setTimeout(() => $('#new-bot').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' }), 350)
  toast('Settings filled in below. Check them and press Deploy on paper.')
}

// --- asset popup -----------------------------------------------------------------------------

function openAsset(id) {
  const a = assetsById.get(id) ?? tradable.find((x) => x.id === id)
  if (!a) return
  const p = prices.get(id)
  const ch = change24(id)
  const onchain = p?.source && !p.source.startsWith('yahoo')
  const name = SHORT_NAME[id] ?? a.name.replace(/\s*\(.*\)/, '')
  openDetail({
    label: `${esc(a.symbol)} · ${esc(name)}`,
    value: `$${px(p?.priceUsd)}`,
    badge: { text: ch == null ? 'sampling' : pct(ch), cls: pnlClass(ch) },
    sub: onchain ? `HashKey ${esc(p.source.toUpperCase())} pool · depth ${compact(p.liquidityUsd)}` : 'Reference market price · thin on-chain liquidity',
    head: `<span class="coin xs">${coin(id, a.symbol)}</span><b>${esc(a.symbol)}</b><span class="dim">${a.category === 'stock' ? 'Tokenized stock' : 'Crypto'}</span>`,
    actions: [
      { icon: 'swap', title: 'Backtest a strategy on this asset', run: () => openStrategy(strategies[0]?.name ?? 'sma-cross', id) },
      ...(TV_SYMBOLS[id] ? [{ icon: 'external', title: 'Open the full chart on TradingView', run: () => { $('#tv-title').textContent = `${a.symbol} · ${TV_SYMBOLS[id]}`; openTradingView($('#tv-dialog'), $('#tv-mount'), id, '1h') } }] : []),
      { icon: 'plus', wide: true, text: 'Deploy', title: 'Deploy a paper bot on this asset', run: () => deployOn([id]) },
    ],
    ranges: Object.keys(RANGES),
    range: '1W',
    legend: [['k-eq', `${a.symbol} price`]],
    card: { label: '24h change', value: ch == null ? '–' : pct(ch), valueCls: pnlClass(ch), small: onchain ? `Pool depth ${compact(p.liquidityUsd)}` : 'Reference price' },
    tabs: [['overview', 'Overview'], ['bots', 'Bots'], ['backtest', 'Backtest']],
    renderTab(tab, grid) {
      if (tab === 'overview') {
        grid.innerHTML = statCards([
          ['Price', `$${px(p?.priceUsd)}`],
          ['24h change', ch == null ? '–' : pct(ch), pnlClass(ch)],
          ['Pool depth', onchain ? compact(p.liquidityUsd) : '–'],
          ['Source', onchain ? `${p.source.toUpperCase()} pool` : 'Reference'],
        ]) + (p?.pool ? `<a class="btn sm ghost wide-link" href="${explorer(`address/${p.pool}`)}" target="_blank">${icon('external')}View pool on Blockscout</a>` : '')
        return
      }
      if (tab === 'bots') {
        const rows = pulse.rows.filter((r) => r.assets.includes(id))
        grid.innerHTML = rows.length
          ? miniRows(rows.map((r) => `<button class="mini-row" data-bot="${r.id}" type="button"><span><b>${esc(r.name)}</b><small>${esc(r.strategy)} · @${esc(r.username)}</small></span><span class="tag ${r.mode}">${r.mode}</span><b class="${pnlClass(r.pnl_pct)}">${pct(r.pnl_pct)}</b></button>`))
          : `<p class="dim small wv-none">No bots trade ${esc(a.symbol)} yet.</p>`
        grid.querySelectorAll('[data-bot]').forEach((b) => b.addEventListener('click', () => openBot(b.dataset.bot)))
        return
      }
      grid.innerHTML = miniRows(strategies.map((s) => `<button class="mini-row" data-strat="${esc(s.name)}" type="button"><span><b class="mono">${esc(s.name)}</b><small>${esc(kindOf(s))}</small></span><span></span><span class="dim small">Replay →</span></button>`))
      grid.querySelectorAll('[data-strat]').forEach((b) => b.addEventListener('click', () => openStrategy(b.dataset.strat, id)))
    },
    async chart(range) {
      const [tf, limit] = RANGES[range]
      const d = await api(`/assets/${id}/candles?timeframe=${tf}&limit=${limit}`)
      const c = d.candles ?? []
      if (c.length < 2) return { empty: d.source === 'sampler' ? `${a.symbol} history is sampled from its HashKey pool while the server runs: ${c.length} candle${c.length === 1 ? '' : 's'} so far.` : 'No history for this range.' }
      const first = c[0].close
      const up = c.at(-1).close >= first
      return {
        lines: [{ data: c.map((x) => ({ time: x.time + TZ, value: x.close })), color: color(up ? '--accent' : '--down'), width: 2.5, precision: precisionFor(c.at(-1).close) }],
        tip: (v) => `$${px(v)}<small class="${pnlClass(v / first - 1)}">${pct((v / first - 1) * 100)}</small>`,
        spark: (candles24.get(id) ?? c).slice(-25).map((x) => x.close),
      }
    },
  })
}

// --- bot popup -------------------------------------------------------------------------------

async function openBot(id) {
  const [b, trades, decisions] = await Promise.all([api(`/api/bots/${id}`), api(`/api/bots/${id}/trades`), api(`/api/bots/${id}/decisions`)])
  const mine = Boolean(me && b.owner === me.username)
  const pnl = (b.equityUsd ?? b.startUsdt) - b.startUsdt
  const positions = Object.entries(b.positions).filter(([, q]) => q > 0)
  const tg = tgLink()
  const toggle = b.status === 'running' ? 'stop' : 'resume'
  openDetail({
    label: `${esc(b.name)} · #${b.id}`,
    value: usd(b.equityUsd),
    badge: { text: pct(b.pnlPct), cls: pnlClass(b.pnlPct) },
    sub: `${b.mode === 'live' ? 'Live' : 'Paper'} · ${esc(b.strategy)} · ${b.assets.map((x) => esc(x.toUpperCase())).join(', ')} · ${esc(b.timeframe)} · by @${esc(b.owner)}`,
    head: `<span class="tag ${b.mode}">${b.mode}</span><span class="status ${esc(b.status)}">${esc(b.status)}</span>${b.haltedReason ? `<span class="dim small" title="${esc(b.haltedReason)}">halted</span>` : ''}`,
    actions: mine
      ? [
          { icon: 'swap', title: 'Backtest this strategy', run: () => openStrategy(b.strategy, b.assets[0]) },
          ...(tg ? [{ icon: 'send', title: 'Manage in Telegram: go live, withdraw', run: () => open(tg, '_blank') }] : []),
          {
            icon: 'trash', title: 'Delete this bot and its history',
            async run() {
              if (!confirm(`Delete bot #${b.id} and its history?`)) return
              try {
                await api(`/api/bots/${b.id}/delete`, { method: 'POST' })
                toast(`Bot #${b.id} deleted`)
                $('#dm').close()
                if (!$('#mine').hidden) loadMine()
                loadOverview()
              } catch (err) {
                toast(err.message)
              }
            },
          },
          {
            icon: toggle === 'stop' ? 'pause' : 'play', wide: true, text: toggle === 'stop' ? 'Stop' : 'Resume', title: toggle === 'stop' ? 'Stop this bot' : 'Resume this bot',
            async run() {
              try {
                await api(`/api/bots/${b.id}/${toggle}`, { method: 'POST' })
                toast(`Bot #${b.id} ${toggle === 'stop' ? 'stopped' : 'resumed'}`)
                if (!$('#mine').hidden) loadMine()
                openBot(b.id)
              } catch (err) {
                toast(err.message)
              }
            },
          },
        ]
      : [
          { icon: 'swap', title: 'Backtest this strategy', run: () => openStrategy(b.strategy, b.assets[0]) },
          { icon: 'plus', wide: true, text: 'Copy', title: 'Deploy the same setup on paper', run: () => deployOn(b.assets, b.strategy) },
        ],
    ranges: Object.keys(RANGES),
    range: '1W',
    legend: [['k-eq', 'P&L'], ['k-hold', 'Buy & hold P&L'], ['k-buy', 'Buy'], ['k-sell', 'Sell']],
    card: { label: 'Total P&L', value: `${pnl >= 0 ? '+' : '−'}${usd(Math.abs(pnl))}`, valueCls: pnlClass(pnl), badge: { text: pct(b.pnlPct), cls: pnlClass(b.pnlPct) }, small: `Cash ${usd(b.cashUsdt)} · started with ${usd(b.startUsdt)}` },
    tabs: [['positions', 'Positions'], ['fills', 'Fills'], ['log', 'Log'], ['info', 'Info']],
    renderTab(tab, grid) {
      if (tab === 'positions') {
        grid.innerHTML =
          [...positions.map(([asset, q]) => [asset, q]), ['usdt', b.cashUsdt]]
            .map(([asset, q], i) => {
              const v = asset === 'usdt' ? q : q * assetUsd(asset)
              return `<div class="hold" style="animation-delay:${i * 60}ms">
                <div class="hold-top"><span class="coin sm">${asset === 'usdt' ? '₮' : coin(asset, asset)}</span><span class="hold-chip">${esc(asset.toUpperCase())}</span></div>
                <div class="hold-amt">${qty(q)}</div>
                <div class="hold-name">${asset === 'usdt' ? 'Cash' : esc(SHORT_NAME[asset] ?? asset.toUpperCase())}</div>
                <div class="hold-v"><span>${usd(v)}</span></div>
              </div>`
            })
            .join('')
        return
      }
      grid.className = 'wv-grid list'
      if (tab === 'fills') {
        grid.innerHTML = trades.length
          ? miniRows(trades.slice(0, 40).map((t) => `<div class="mini-row"><span><b class="${t.side === 'buy' ? 'up' : 'down'}">${t.side.toUpperCase()} ${esc(t.asset.toUpperCase())}</b><small>${when(t.time)} · @ ${t.exec_price.toPrecision(6)}</small></span><span>${usd(t.usdt)}</span><b class="${pnlClass(t.realized_pnl)}">${t.realized_pnl == null ? (t.tx_hash ? `<a href="${explorer(`tx/${t.tx_hash}`)}" target="_blank">tx ↗</a>` : '') : usd(t.realized_pnl)}</b></div>`))
          : '<p class="dim small wv-none">No fills yet.</p>'
        return
      }
      if (tab === 'log') {
        grid.innerHTML = decisions.length
          ? miniRows(decisions.slice(0, 30).map((d) => `<div class="mini-row log"><span><b>${esc(d.action ?? 'hold')}</b> <span class="dim">${esc(d.asset)}</span><small>${when(d.time)}</small></span><span class="muted small">${esc(d.error ?? d.reason ?? '')}</span></div>`))
          : '<p class="dim small wv-none">No decisions yet.</p>'
        return
      }
      grid.innerHTML = `<dl class="kv">
        <dt>Universe</dt><dd>${b.assets.map((x) => esc(x.toUpperCase())).join(', ')}</dd>
        <dt>Timeframe</dt><dd>${esc(b.timeframe)}</dd>
        <dt>Parameters</dt><dd>${esc(JSON.stringify(b.params))}</dd>
        ${b.lp ? `<dt>Liquidity</dt><dd>${b.lp.range ? `${b.lp.range.side === 'usdt' ? `${usd(b.lp.range.depositUsdt)} USDT in buy range` : `${qty(b.lp.range.depositAsset)} ${esc(b.assets[0])} in sell range`} ${b.lp.range.lower.toPrecision(6)}–${b.lp.range.upper.toPrecision(6)}` : 'No open range'} · fees ${usd(b.lp.feesUsd)}</dd>` : ''}
        ${b.haltedReason ? `<dt>Halted</dt><dd class="down">${esc(b.haltedReason)}</dd>` : ''}
        ${b.wallet ? `<dt>Wallet</dt><dd><a href="${explorer(`address/${b.wallet}`)}" target="_blank">${short(b.wallet)} ↗</a></dd>` : ''}
        <dt>Created</dt><dd>${when(b.createdAt)}</dd>
      </dl>`
    },
    async chart(range) {
      const [tf, limit] = RANGES[range]
      const { eq, hold } = await equityHistory([b], tf, limit)
      // Each fill as a dot on the P&L line, on the last point at or before it.
      const times = eq.map((x) => x.time)
      const marks = new Map()
      for (const t of trades) {
        const at = Date.parse(t.time) / 1000 + TZ
        const time = times.findLast((x) => x <= at)
        if (time != null) marks.set(`${time}${t.side}`, { time, position: 'inBar', shape: 'circle', size: 1, color: color(t.side === 'buy' ? '--up' : '--down') })
      }
      return {
        lines: [
          { data: eq, color: color('--accent'), width: 2.5 },
          { data: hold, color: alpha('#ffffff', 0.85), width: 2 },
        ],
        markers: [...marks.values()],
        baseline: 0,
        tip: (v) => `${v >= 0 ? '+' : '−'} ${usd(Math.abs(v))}<small class="muted">P&amp;L</small>`,
        spark: eq.map((x) => x.value),
      }
    },
  })
}

// --- strategy popup --------------------------------------------------------------------------

function openStrategy(name, asset = 'wbtc') {
  const s = strategies.find((x) => x.name === name)
  if (!s) return
  const kind = kindOf(s)
  const desc = s.description.includes(':') ? s.description.slice(s.description.indexOf(':') + 1).trim() : s.description
  const pick = { asset }
  const choices = tradable.filter((a) => a.category === 'crypto' || FEATURED.includes(a.id))
  const sym = () => (assetsById.get(pick.asset) ?? tradable.find((a) => a.id === pick.asset))?.symbol ?? pick.asset.toUpperCase()
  openDetail({
    label: `${esc(kind)} · <span class="mono">${esc(name)}</span>`,
    value: '…',
    sub: esc(desc),
    head: `<span class="tag">${esc(kind)}</span><b class="mono">${esc(name)}</b>${s.llm && s.model ? `<span class="tag">${esc(s.model)}</span>` : ''}`,
    actions: [
      { icon: 'chart', title: 'Open the full backtest with exit rules', run: () => { $('#dm').close(); $('#preview select[name=asset]').value = pick.asset; previewStrategy(name) } },
      { icon: 'plus', wide: true, text: 'Deploy', title: 'Deploy this strategy on paper', run: () => deployOn([pick.asset], name) },
    ],
    ranges: ['15m', '1h', '4h', '1d'],
    range: '1h',
    legend: [['k-hold', 'Price'], ['k-buy', 'Entry'], ['k-sell', 'Exit']],
    card: { label: 'Strategy return', value: '…', small: 'Replaying…' },
    tabs: [['results', 'Results'], ['params', 'Parameters'], ['asset', 'Asset']],
    onData(data) {
      const st = data.stats
      const ret = st?.returnPct
      $('#dm-value').textContent = ret == null ? '–' : pct(ret)
      $('#dm-value').className = pnlClass(ret)
      $('#dm-badge').hidden = !st
      if (st) {
        $('#dm-badge').textContent = `${pct(st.buyHoldPct)} hold`
        $('#dm-badge').className = `badge ${pnlClass(st.buyHoldPct)}`
      }
      $('#dm-card-value').textContent = ret == null ? '–' : pct(ret)
      $('#dm-card-value').className = pnlClass(ret)
      $('#dm-card-small').textContent = st ? `${sym()} · ${st.roundTrips} round trip${st.roundTrips === 1 ? '' : 's'} · win ${st.winRatePct == null ? '–' : `${st.winRatePct.toFixed(0)}%`}` : data.empty ?? `${sym()} · indicators only`
      if (dm.tab === 'results') renderDetailTab()
    },
    renderTab(tab, grid) {
      if (tab === 'results') {
        const st = dm.data?.stats
        grid.innerHTML = st
          ? statCards([
              ['Strategy return', pct(st.returnPct), pnlClass(st.returnPct)],
              ['Buy & hold', pct(st.buyHoldPct), pnlClass(st.buyHoldPct)],
              ['Round trips', st.roundTrips + (st.openPct != null ? ' + open' : '')],
              ['Win rate', st.winRatePct == null ? '–' : `${st.winRatePct.toFixed(0)}%`],
              ...(st.lp ? [['LP fees earned', pct(st.feesEarnedPct), 'up']] : []),
            ]) + `<p class="dim small wv-none">Includes the ${st.feePct}% pool fee on every swap. Past signals do not predict future ones.</p>`
          : `<p class="dim small wv-none">${dm.data ? (s.llm ? 'The AI strategy is not replayed (one AI call per candle); the chart shows the indicators it reads.' : 'No results for this asset and timeframe.') : 'Replaying…'}</p>`
        return
      }
      if (tab === 'params') {
        const params = Object.entries(s.params)
        grid.innerHTML = params.length ? statCards(params.map(([k, v]) => [esc(k), esc(v)])) : '<p class="dim small wv-none">No parameters; it uses the indicator defaults.</p>'
        return
      }
      grid.className = 'wv-grid list'
      grid.innerHTML = `<div class="asset-picks">${choices.map((a) => `<button type="button" data-pick="${esc(a.id)}"${a.id === pick.asset ? ' class="active"' : ''}>${esc(a.symbol)}</button>`).join('')}</div>`
      grid.querySelectorAll('[data-pick]').forEach((b) =>
        b.addEventListener('click', () => {
          pick.asset = b.dataset.pick
          grid.querySelectorAll('[data-pick]').forEach((x) => x.classList.toggle('active', x === b))
          drawDetailChart()
        }),
      )
    },
    async chart(tf) {
      const d = await api(`/api/preview?strategy=${encodeURIComponent(name)}&asset=${encodeURIComponent(pick.asset)}&timeframe=${tf}`)
      if (d.error || !d.candles?.length) return { empty: d.error ?? `No candles for ${sym()}.` }
      const first = d.candles[0].close
      const palette = [color('--accent'), color('--live'), color('--dim')]
      return {
        stats: d.stats,
        lines: [
          { data: d.candles.map((c) => ({ time: c.time + TZ, value: c.close })), color: alpha('#ffffff', 0.9), width: 2, precision: precisionFor(d.candles.at(-1).close) },
          ...d.lines.map((l, i) => ({ data: toPoints(l.data), color: palette[i % palette.length], width: 1.5, dashed: i > 0, precision: precisionFor(d.candles.at(-1).close) })),
        ],
        markers: d.markers.map((m) => ({ time: m.time + TZ, position: m.side === 'buy' ? 'belowBar' : 'aboveBar', shape: m.side === 'buy' ? 'arrowUp' : 'arrowDown', color: color(m.side === 'buy' ? '--up' : '--down'), text: m.side === 'buy' ? '' : `${m.returnPct >= 0 ? '+' : ''}${m.returnPct.toFixed(1)}%` })),
        legend: [['k-hold', `${sym()} price`], ...d.lines.slice(0, 3).map((l, i) => [['k-eq', 'k-l2', 'k-mid'][i], l.name]), ['k-buy', 'Entry'], ['k-sell', 'Exit']],
        tip: (v) => `$${px(v)}<small class="${pnlClass(v / first - 1)}">${pct((v / first - 1) * 100)}</small>`,
        spark: d.candles.slice(-40).map((c) => c.close),
      }
    },
  })
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
  $('#wallet-pill')?.addEventListener('click', openWallet)
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

// Remembered per browser: who signed in here before, and which Telegram they used.
const remember = {
  get: (k) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch {} },
}

function onSignedIn(user) {
  me = user
  remember.set('sf_known_user', user.username)
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
// The Telegram Web tab the sign-in opened, closed after approval so you land back here.
let telegramTab = null

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
    <path class="l-white" d="${line(390, 60)}" pathLength="1"/><path class="l-dark" d="${line(425, 80)}" pathLength="1"/>`
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
  root.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => copyText(b.dataset.copy, 'Copied')))
}

const LOGIN_TIP = `<span class="need-tip" tabindex="0" role="button" aria-describedby="login-tip"><i aria-hidden="true">?</i>New here? How it works<span class="need-tip-bubble" id="login-tip" role="tooltip">
    <b>Your Telegram account is your Swordfish account.</b>
    <span>Pressing <b>Start</b> in the Swordfish bot creates your account and your own wallet on HashKey Chain. No sign-up form, nothing to install.</span>
    <span>Then, in Telegram or here, you can pick a strategy, run it on paper money first, fund your wallet to go live, follow every trade and climb the P&amp;L leaderboard.</span>
    <span>Next time, signing in is one tap on <b>Approve</b>.</span>
    <span class="need-tip-foot">No Telegram yet? It's free at <a href="https://telegram.org/apps" target="_blank" rel="noopener">telegram.org</a>.</span>
  </span></span>`

async function openLogin() {
  stopLogin()
  drawAuthArt()
  renderAuthFloat()
  const dlg = $('#login-dialog')
  const body = $('#login-body')
  const known = remember.get('sf_known_user')
  const title = known ? 'Welcome back' : 'Sign in with Telegram'
  body.innerHTML = `<h2>${title}</h2><p class="sub">Preparing a secure sign-in request…</p>`
  if (!dlg.open) dlg.showModal()
  let req
  try {
    req = await api('/api/auth/request', { method: 'POST' })
  } catch (err) {
    return void (body.innerHTML = `<h2>${title}</h2><p class="sub">Sign-in is unavailable right now.</p>
      <div class="field bad"><label>Error</label><div class="box"><span class="grow">${esc(err.message)}</span></div></div>`)
  }
  const bot = req.bot ?? info.telegramBot
  const start = `login_${req.code}`
  const links = {
    web: `https://web.telegram.org/k/#?tgaddr=${encodeURIComponent(`tg://resolve?domain=${bot}&start=${start}`)}`,
    app: `https://t.me/${encodeURIComponent(bot)}?start=${start}`,
  }
  const method = remember.get('sf_tg_method') === 'app' ? 'app' : 'web'
  const other = method === 'web' ? 'app' : 'web'
  const label = { web: 'Open Telegram Web', app: 'Open Telegram app' }
  login = { code: req.code, expires: Date.now() + req.ttlSec * 1000 }
  body.innerHTML = `<h2>${title}</h2>
    <p class="sub">${known ? `Approve this browser as <b>@${esc(known)}</b>. It takes one tap in Telegram.` : 'No password or sign-up form. Your Telegram account is your login.'}</p>
    ${known ? '' : LOGIN_TIP}
    <ol class="login-steps${known ? ' compact' : ''}" id="login-steps">
      <li class="active"><span class="n">1</span><div><b>Open the bot</b><small>Telegram Web or the app</small></div></li>
      <li><span class="n">2</span><div><b>Press Start</b><small>${known ? 'Your sign-in code is sent for you' : 'Creates your account and wallet'}</small></div></li>
      <li><span class="n">3</span><div><b>Tap ✅ Approve</b><small>This browser signs in by itself</small></div></li>
    </ol>
    <button class="btn-accent" id="login-primary" type="button">${label[method]}</button>
    <p class="auth-alt">${method === 'web' ? 'Have the Telegram app?' : 'No app on this device?'} <button type="button" id="login-other">${label[other]}</button></p>
    <div class="login-status wait" id="login-state"><span class="spin"></span><span class="grow">Waiting for you in Telegram</span><span class="ttl" id="login-ttl">10:00</span></div>
    <details class="login-manual"><summary>Link didn't open? Use the code instead</summary>
      <div class="field"><label>1. Find this bot in Telegram</label><div class="box"><span class="grow">@${esc(bot)}</span>${copyBtn(`@${bot}`)}</div></div>
      <div class="field"><label>2. Send it this message</label><div class="box"><code class="grow">/start ${start}</code>${copyBtn(`/start ${start}`)}</div></div>
    </details>`
  bindCopy(body)
  const steps = [...body.querySelectorAll('#login-steps li')]
  const setStatus = (cls, html) => {
    $('#login-state').className = `login-status ${cls}`
    $('#login-state').innerHTML = html
  }
  const reach = (n) => steps.forEach((li, i) => {
    li.classList.toggle('done', i < n)
    li.classList.toggle('active', i === n)
  })
  const ttlBox = () => `<span class="ttl" id="login-ttl">${$('#login-ttl')?.textContent ?? ''}</span>`
  // Opened from script (not a plain link) so this page keeps a handle and can close the tab.
  const go = (m) => {
    remember.set('sf_tg_method', m)
    if (m === 'web') {
      telegramTab = open(links.web, 'swordfish-telegram')
      if (!telegramTab) location.href = links.web
    } else {
      open(links.app, '_blank', 'noopener')
    }
    if (login && !login.opened) {
      reach(1)
      setStatus('wait', `<span class="spin"></span><span class="grow">Telegram is opening. Press <b>Start</b> in the chat</span>${ttlBox()}`)
    }
  }
  $('#login-primary').addEventListener('click', () => go(method))
  $('#login-other').addEventListener('click', () => go(other))
  const tick = async () => {
    if (!login) return
    const left = Math.max(0, login.expires - Date.now())
    if ($('#login-ttl')) $('#login-ttl').textContent = `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`
    const r = await api(`/api/auth/poll?code=${encodeURIComponent(login.code)}`).catch(() => ({ status: 'pending' }))
    if (!login) return
    if (r.status === 'opened' && !login.opened) {
      login.opened = true
      reach(2)
      setStatus('wait', `<span class="spin"></span><span class="grow">Chat open. Tap <b>✅ Approve sign-in</b></span>${ttlBox()}`)
    } else if (r.status === 'approved') {
      stopLogin()
      try {
        telegramTab?.close()
      } catch {}
      telegramTab = null
      focus()
      remember.set('sf_known_user', r.username)
      reach(3)
      setStatus('ok', `${icon('check')}<span class="grow">Approved as @${esc(r.username)}</span>`)
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
      setStatus('bad', `<span class="grow">Request expired. Sign-in links last 10 minutes.</span>`)
      $('#login-primary').outerHTML = `<button class="btn-accent" id="login-retry" type="button">Start a new sign-in</button>`
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
    $('#my-bots-panel').hidden = true
    $('#new-bot').hidden = true
    return
  }
  $('#login-note').hidden = true
  const [user, bots] = await Promise.all([api('/api/me'), api('/api/me/bots')])
  me = user
  renderWalletPill()
  $('#my-bots-panel').hidden = false
  $('#my-bots').innerHTML = botCards(bots) || '<p class="dim">No strategies deployed yet. Use the form below to start one on paper.</p>'
  bindBotCards($('#my-bots'))
  $('#new-bot').hidden = false
}
$('#open-wallet').addEventListener('click', openWallet)

// Bot cards for the Portfolio list.
function botCards(list) {
  return list
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
    .join('')
}

function bindBotCards(root) {
  root.querySelectorAll('[data-open]').forEach((x) => x.addEventListener('click', () => openBot(x.dataset.open)))
  root.querySelectorAll('[data-act]').forEach((x) =>
    x.addEventListener('click', async () => {
      if (x.dataset.act === 'delete' && !confirm(`Delete bot #${x.dataset.id} and its history?`)) return
      try {
        await api(`/api/bots/${x.dataset.id}/${x.dataset.act}`, { method: 'POST' })
        toast(`Bot #${x.dataset.id}: ${x.dataset.act === 'stop' ? 'stopped' : x.dataset.act === 'resume' ? 'resumed' : 'deleted'}`)
      } catch (err) {
        toast(err.message)
      }
      if (!$('#mine').hidden) loadMine()
    }),
  )
}

// --- wallet popup --------------------------------------------------------------------------

async function openWallet() {
  if (!me) return openLogin()
  const [user, bots] = await Promise.all([api('/api/me'), api('/api/me/bots')])
  me = user
  wv.bots = bots
  renderWalletPill()
  $('#wallet-dialog').showModal()
  renderWalletView()
  loadActivity()
}
// Close on a backdrop click (outside the popup's box).
$('#wallet-dialog').addEventListener('click', (e) => {
  // Backdrop clicks target the dialog itself; keyboard-activated buttons report 0,0, so check both.
  if (e.target !== $('#wallet-dialog')) return
  const r = $('#wallet-dialog').getBoundingClientRect()
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) $('#wallet-dialog').close()
})

// --- wallet view (inside the popup) ---------------------------------------------------------
// The custody wallet's job is money in and out: how to fund it, what it holds, whether /live
// would accept a bot, and recent on-chain activity. Bot performance lives with the bots.

const RANGES = { '1D': ['15m', 96], '1W': ['1h', 168], '1M': ['4h', 180] }
const HOLDINGS = [['usdt', 'Tether'], ['hsk', 'HashKey'], ['weth', 'Ethereum'], ['wbtc', 'Bitcoin']]
const wv = { bots: [], activity: null }
const assetUsd = (id) => prices.get(id)?.priceUsd ?? (id === 'usdt' ? 1 : 0)
const BLOCKSCOUT_API = 'https://hsk.blockscout.com/api/v2'

// QR code of the address as an SVG path (qrcode-generator from the CDN; skipped if it didn't load).
function qrSvg(text) {
  if (!window.qrcode) return ''
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  const n = qr.getModuleCount()
  let d = ''
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`
  return `<svg class="qr-svg" viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges" aria-label="QR code of your wallet address"><path d="${d}"/></svg>`
}

function renderWalletView() {
  const bal = (id) => Number(me.balances?.[id] ?? 0)
  const values = HOLDINGS.map(([id]) => bal(id) * assetUsd(id))
  const total = values.reduce((a, b) => a + b, 0)
  // 24h change of what the wallet holds now, from each asset's 24h move.
  const prev = HOLDINGS.reduce((s, [id], i) => {
    const ch = id === 'usdt' ? 0 : change24(id)
    return s + (ch == null ? values[i] : values[i] / (1 + ch / 100))
  }, 0)
  const chg = prev > 0 ? (total / prev - 1) * 100 : 0
  const live = me.live ?? { reserved: {}, minGasHsk: 0.5, maxBudgetUsd: 500, maxTradeUsd: 50, dailyLossPct: 10 }
  const reservedUsdt = live.reserved.usdt ?? 0
  const freeUsdt = Math.max(0, bal('usdt') - reservedUsdt)
  const liveBots = wv.bots.filter((b) => b.mode === 'live' && b.status !== 'stopped').length
  // /live refuses bots holding assets priced from the market reference (no pool liquidity).
  const onPool = (a) => Boolean(prices.get(a)?.source) && !prices.get(a).source.startsWith('yahoo')
  const paperOnPools = wv.bots.filter((b) => b.mode === 'paper' && b.assets.every(onPool))
  const checks = [
    [freeUsdt >= 1, 'USDT to trade with', `${qty(freeUsdt)} USDT free${reservedUsdt ? ` · ${qty(reservedUsdt)} reserved` : ''}`, freeUsdt >= 1 ? '' : 'Deposit at least 1 USDT'],
    [bal('hsk') >= live.minGasHsk, 'HSK for gas', `${qty(bal('hsk'))} of ${live.minGasHsk} HSK needed`, bal('hsk') >= live.minGasHsk ? '' : `Deposit at least ${live.minGasHsk} HSK`],
    [paperOnPools.length > 0, 'A paper bot on pool assets', `${paperOnPools.length} paper bot${paperOnPools.length === 1 ? '' : 's'} can go live`, 'Deploy one on paper first (reference-priced stocks can\'t go live)'],
  ]
  const ready = checks.every(([ok]) => ok)
  const tg = tgLink()
  const empty = total === 0
  const el = $('#wallet')
  el.innerHTML = `<div class="wv wallet">
    <div class="wv-main">
      <svg class="wv-bars" id="wv-bars" aria-hidden="true"></svg>
      <div class="wv-top">
        <div>
          <p class="wv-label">Wallet (USD)</p>
          <div class="wv-total"><b>${usd(total)}</b><span class="badge ${pnlClass(chg)}">${pct(chg)}</span></div>
          <p class="wv-sub">Custody wallet on HashKey Chain${info.telegramBot ? `, held by @${esc(info.telegramBot)}` : ''}</p>
        </div>
      </div>
      <div class="wl-actions">
        <button class="pill-btn light" id="wl-deposit" type="button">${icon('arrowDown')}Deposit</button>
        <button class="pill-btn" id="wl-withdraw" type="button">${icon('arrowUp')}Withdraw</button>
        <a class="pill-btn" href="${explorer(`address/${me.wallet}`)}" target="_blank">${icon('external')}Blockscout</a>
      </div>

      <section class="fund" id="wl-fund">
        <div class="qr">${qrSvg(me.wallet)}</div>
        <div class="fund-info">
          <h3>${empty ? 'Fund your wallet to trade live' : 'Deposit address'}</h3>
          <div class="addr-full"><code>${esc(me.wallet)}</code><button class="icon-btn" id="wl-copy" type="button" title="Copy address">${icon('copy')}</button></div>
          <dl class="net-rows">
            <dt>Network</dt><dd>HashKey Chain <span class="dim">· chain 177</span></dd>
            <dt>Send</dt><dd>USDT to trade, plus at least ${live.minGasHsk} HSK for gas</dd>
          </dl>
          <p class="warn">Only send on HashKey Chain. Tokens sent on another network can't be recovered.</p>
        </div>
      </section>

      <section class="ready${ready ? ' ok' : ''}">
        <div class="ready-head"><h3>Ready to go live?</h3><span class="badge ${ready ? 'up' : ''}">${ready ? 'Ready' : `${checks.filter(([ok]) => ok).length}/${checks.length}`}</span></div>
        <ul>${checks
          .map(([ok, title, detail, todo]) => `<li class="${ok ? 'ok' : ''}"><span class="tick">${icon(ok ? 'check' : 'x')}</span><span><b>${title}</b><small>${detail}${!ok && todo ? ` · <em>${todo}</em>` : ''}</small></span></li>`)
          .join('')}</ul>
        <p class="ready-foot">${ready
          ? `In Telegram, open a bot and tap 🚀 Go live, then pick a budget up to ${live.maxBudgetUsd} USDT.`
          : `Live bots trade up to ${live.maxTradeUsd} USDT per trade and halt after a ${live.dailyLossPct}% daily loss.`}
          ${liveBots ? ` ${liveBots} live bot${liveBots === 1 ? ' is' : 's are'} running.` : ''}</p>
      </section>
    </div>

    <div class="wv-side">
      <div class="wv-addr">${icon('user')}<a href="${explorer(`address/${me.wallet}`)}" target="_blank">${short(me.wallet)}</a>
        <button class="icon-btn" id="wallet-logout" type="button" title="Log out">${icon('logout')}</button>
        <button class="icon-btn" id="wv-close" type="button" title="Close">${icon('x')}</button></div>
      <h3 class="side-h">Holdings</h3>
      <div class="holdings">${HOLDINGS.map(([id, name], i) => {
        const share = total > 0 ? (values[i] / total) * 100 : 0
        const ch = id === 'usdt' ? 0 : change24(id)
        return `<div class="holding" style="animation-delay:${i * 50}ms">
          <span class="coin sm">${id === 'usdt' ? '₮' : coin(id, id)}</span>
          <span class="h-name"><b>${id.toUpperCase()}</b><small>${name}</small></span>
          <span class="h-val"><b>${usd(values[i])}</b><small>${qty(bal(id))} ${id.toUpperCase()}${ch ? ` · <span class="${pnlClass(ch)}">${pct(ch)}</span>` : ''}</small></span>
          <span class="h-bar"><i style="width:${share.toFixed(1)}%"></i></span>
        </div>`
      }).join('')}</div>
      ${empty ? '<p class="dim small wv-none">Empty for now. Deposits show up here within a few seconds of confirming.</p>' : ''}
      <h3 class="side-h">Recent activity <a class="dim small" href="${explorer(`address/${me.wallet}`)}" target="_blank">All ↗</a></h3>
      <div class="activity" id="wl-activity">${activityHtml()}</div>
    </div>
  </div>`
  hydrateIcons(el)
  drawStripes($('#wv-bars'), 0.04)
  const copy = () => copyText(me.wallet, 'Address copied. Send USDT and a little HSK on HashKey Chain.')
  $('#wl-copy').addEventListener('click', copy)
  $('#wl-deposit').addEventListener('click', () => {
    copy()
    const fund = $('#wl-fund')
    fund.classList.remove('flash')
    void fund.offsetWidth
    fund.classList.add('flash')
  })
  $('#wl-withdraw').addEventListener('click', () => {
    if (tg) open(tg, '_blank')
    toast('Withdraw in Telegram: /withdraw <asset> <amount|max> <address>')
  })
  $('#wv-close').addEventListener('click', () => $('#wallet-dialog').close())
  $('#wallet-logout').addEventListener('click', () => ($('#wallet-dialog').close(), logout()))
}

// Token transfers and native HSK transactions for the wallet, newest first (Blockscout allows CORS).
async function loadActivity() {
  const addr = me?.wallet
  if (!addr) return
  wv.activity = null
  const get = (path) => fetch(`${BLOCKSCOUT_API}/addresses/${addr}/${path}`).then((r) => (r.ok ? r.json() : { items: [] })).catch(() => ({ items: [] }))
  const [tokens, txs] = await Promise.all([get('token-transfers'), get('transactions')])
  const mine = (h) => h?.toLowerCase() === addr.toLowerCase()
  const rows = [
    ...(tokens.items ?? []).map((t) => ({
      time: t.timestamp, hash: t.transaction_hash ?? t.tx_hash, in: mine(t.to?.hash), other: mine(t.to?.hash) ? t.from?.hash : t.to?.hash,
      amount: Number(t.total?.value ?? 0) / 10 ** Number(t.total?.decimals ?? t.token?.decimals ?? 18), symbol: t.token?.symbol ?? '?',
    })),
    ...(txs.items ?? []).filter((t) => Number(t.value) > 0).map((t) => ({
      time: t.timestamp, hash: t.hash, in: mine(t.to?.hash), other: mine(t.to?.hash) ? t.from?.hash : t.to?.hash, amount: Number(t.value) / 1e18, symbol: 'HSK',
    })),
  ].sort((a, b) => Date.parse(b.time) - Date.parse(a.time))
  wv.activity = rows.slice(0, 12)
  if ($('#wl-activity')) $('#wl-activity').innerHTML = activityHtml()
}

function activityHtml() {
  if (wv.activity == null) return '<div class="act-row skel" style="height:46px"></div><div class="act-row skel" style="height:46px"></div>'
  if (!wv.activity.length) return '<p class="dim small wv-none">No activity yet. Deposits, withdrawals and live-bot swaps show up here.</p>'
  return wv.activity
    .map((a) => `<a class="act-row" href="${explorer(`tx/${a.hash}`)}" target="_blank">
      <span class="act-dir ${a.in ? 'in' : 'out'}">${icon(a.in ? 'arrowDown' : 'arrowUp')}</span>
      <span><b>${a.in ? 'Received' : 'Sent'} ${esc(a.symbol)}</b><small>${a.in ? 'from' : 'to'} ${short(a.other ?? '')} · ${when(a.time)}</small></span>
      <b class="${a.in ? 'up' : ''}">${a.in ? '+' : '−'}${qty(a.amount)}</b>
    </a>`)
    .join('')
}

// Fine vertical stripes in blocks of varying height (the sign-in panel's motif), drawn once per SVG.
function drawStripes(svg, opacity) {
  const W = 600, H = 400
  let seed = 11
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  let h = 0
  const rects = []
  for (let x = 0; x < W; x += 4.2) {
    if (Math.floor(x / 46) !== Math.floor((x - 4.2) / 46)) h = 90 + rnd() * 250
    rects.push(`<rect x="${x.toFixed(1)}" y="${(H - h).toFixed(1)}" width="1.1" height="${h.toFixed(1)}"/>`)
  }
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
  svg.setAttribute('preserveAspectRatio', 'xMidYMax slice')
  svg.innerHTML = `<g fill="#ffffff" fill-opacity="${opacity}">${rects.join('')}</g>`
}

// Rebuild P&L over time: replay each bot's fills against historical closes, and compare with
// holding the same assets (equal weights) from the bot's start. P&L rather than equity, so a
// newly deployed bot doesn't show up as a jump.
async function equityHistory(bots, tf, limit) {
  const assets = [...new Set(bots.flatMap((b) => b.assets))]
  const [sets, fills] = await Promise.all([
    Promise.all(assets.map((a) => api(`/assets/${a}/candles?timeframe=${tf}&limit=${limit}`).catch(() => ({ candles: [] })))),
    Promise.all(bots.map((b) => api(`/api/bots/${b.id}/trades`).catch(() => []))),
  ])
  const axis = [...new Set(sets.flatMap((d) => (d.candles ?? []).map((c) => c.time)))].sort((a, b) => a - b)
  // Close at each axis time, carried forward over gaps. Reference (market) candles are scaled to
  // the HashKey pool price, which bots actually trade at, so the chart ends near real equity.
  const close = new Map(
    assets.map((a, i) => {
      const candles = sets[i].candles ?? []
      const pool = prices.get(a)
      const k = sets[i].source?.startsWith('yahoo') && pool?.priceUsd && !pool.source?.startsWith('yahoo') && candles.length ? pool.priceUsd / candles.at(-1).close : 1
      const byTime = new Map(candles.map((c) => [c.time, c.close * k]))
      let last = candles[0] ? candles[0].close * k : null
      return [a, axis.map((t) => (last = byTime.get(t) ?? last))]
    }),
  )
  const eq = [], hold = []
  axis.forEach((t, k) => {
    let e = 0, h = 0, live = false
    bots.forEach((b, bi) => {
      const start = Date.parse(b.createdAt) / 1000
      if (t + 1 < start - (axis[1] - axis[0] || 0)) return
      live = true
      let cash = b.startUsdt
      const held = {}
      for (const f of fills[bi]) {
        if (Date.parse(f.time) / 1000 > t + (axis[1] - axis[0] || 0)) break
        const q = f.side === 'buy' ? f.quantity : -f.quantity
        held[f.asset] = (held[f.asset] ?? 0) + q
        cash += f.side === 'buy' ? -f.usdt : f.usdt
      }
      e += cash + Object.entries(held).reduce((s, [a, q]) => s + q * (close.get(a)?.[k] ?? 0), 0) - b.startUsdt
      const k0 = Math.max(0, axis.findIndex((x) => x >= start - (axis[1] - axis[0] || 0)))
      h += b.startUsdt * (b.assets.reduce((s, a) => s + (close.get(a)?.[k] ?? 0) / (close.get(a)?.[k0] || 1), 0) / b.assets.length - 1)
    })
    if (live) eq.push({ time: t + TZ, value: e }), hold.push({ time: t + TZ, value: h })
  })
  return { eq, hold }
}

// Small sparkline with a glowing dot on the latest value (detail popups).
function drawSpark(svg, vals) {
  if (!svg) return
  if (vals.length < 2) return void (svg.innerHTML = `<path d="M4 40H146" class="ps-base"/>`)
  const W = 150, H = 64
  const step = Math.max(1, Math.ceil(vals.length / 24))
  const ys = vals.filter((_, i) => i % step === 0).concat(vals.at(-1))
  const lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1
  const pts = ys.map((v, i) => [4 + (i / (ys.length - 1)) * (W - 12), H - 8 - ((v - lo) / span) * (H - 18)])
  const [lx, ly] = pts.at(-1)
  const bars = Array.from({ length: 36 }, (_, i) => `<rect x="${(i * 4.2).toFixed(1)}" y="${(H - 12 - ((i * 37) % 23)).toFixed(1)}" width="1" height="${(12 + ((i * 37) % 23)).toFixed(1)}"/>`).join('')
  svg.innerHTML = `<g class="ps-bars">${bars}</g><path class="ps-line" d="${smoothPath(pts)}" pathLength="1"/>
    <path class="ps-drop" d="M${lx.toFixed(1)} ${ly.toFixed(1)}V${H}"/><circle class="ps-glow" cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="7"/><circle class="ps-dot" cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="3"/>`
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
      return `<div class="strat" data-kind="${esc(kind)}" data-name="${esc(s.name)}" role="button" tabindex="0" style="animation-delay:${i * 50}ms">
        <div class="strat-row"><span class="kind">${esc(kind)}</span>${s.llm && s.model ? `<span class="tag">${esc(s.model)}</span>` : ''}</div>
        ${strategyArt(s.name, kind)}
        <h4>${esc(s.name)}</h4>
        <p>${esc(desc)}</p>
        ${params.length ? `<div class="params-line">${params.map(([k, v]) => `${esc(k)}=${esc(v)}`).join('  ')}</div>` : ''}
        <div class="strat-row"><span class="link">Details &amp; backtest →</span></div>
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
  $$('.strat').forEach((card) => {
    card.addEventListener('click', () => openStrategy(card.dataset.name))
    card.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), openStrategy(card.dataset.name)))
  })
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
  if (h.kind === 'strategy') return openStrategy(h.id)
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
      : 'The AI strategy is not replayed (that would take one AI call per candle); the chart shows the indicators it reads: Bollinger Bands and RSI.'))
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
// #board and #mine open as soon as prices are in; #strategies waits for the catalogue it lists.
// #login opens the sign-in screen and #wallet the wallet popup.
const linked = location.hash.slice(1)
const homeData = Promise.all([loadMarkets(), loadStrategies(), loadAssets().catch(() => {}), loadOverview()])
if (linked === 'board' || linked === 'mine') showTab(linked)
if (linked === 'login' && !me) openLogin()
if (linked === 'wallet' && me) openWallet()
await homeData
if (linked === 'strategies') showTab(linked)
// Holdings show 24h changes, which arrive with the market data.
if ($('#wallet-dialog').open) renderWalletView()
// Follow later #view changes too (back/forward, a pasted link). showTab itself uses replaceState,
// which doesn't fire hashchange.
addEventListener('hashchange', () => {
  const tab = location.hash.slice(1)
  if (tab === 'login') return void (!me && openLogin())
  if (tab === 'wallet') return void (me ? openWallet() : openLogin())
  showTab(TABS.includes(tab) ? tab : 'leaderboard')
})
syncInks()
setInterval(loadPrices, 15_000)
setInterval(refreshMarket, 30_000)
setInterval(() => !$('#leaderboard').hidden && loadOverview(), 60_000)
setInterval(() => !$('#board-view').hidden && loadBoard(), 60_000)
