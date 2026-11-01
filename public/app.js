// Swordfish dashboard: leaderboard, your bots and wallet, strategy catalog.

const $ = (sel) => document.querySelector(sel)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const usd = (n) => (n == null ? '–' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }))
const pct = (n) => (n == null ? '–' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`)
const pnlClass = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : '')
const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '')
const qty = (n) => (n >= 1 ? n.toFixed(4) : n.toPrecision(4))
const when = (iso) => new Date(iso).toLocaleString('en-GB', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
const explorer = (path) => `https://hsk.blockscout.com/${path}`

async function api(path, options) {
  const res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...options })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(body.error ?? res.statusText), { status: res.status })
  return body
}

let info = {}
let me = null
let mode = 'paper'

// --- tabs ----------------------------------------------------------------------

function showTab(tab) {
  for (const b of document.querySelectorAll('nav button')) b.classList.toggle('active', b.dataset.tab === tab)
  for (const s of document.querySelectorAll('main section')) s.hidden = s.id !== tab
  if (tab === 'leaderboard') loadBoard()
  if (tab === 'mine') loadMine()
  if (tab === 'strategies' && !previewCharts.length) loadPreview()
}
document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)))
document.querySelectorAll('#mode button').forEach((b) =>
  b.addEventListener('click', () => {
    mode = b.dataset.mode
    document.querySelectorAll('#mode button').forEach((x) => x.classList.toggle('active', x === b))
    loadBoard()
  }),
)

// --- leaderboard -------------------------------------------------------------------

async function loadBoard() {
  const rows = await api(`/api/leaderboard?mode=${mode}`)
  $('#board').innerHTML = rows.length
    ? `<thead><tr><th>#</th><th>Bot</th><th>Owner</th><th>Strategy</th><th>Assets</th><th class="num">P&amp;L</th><th class="num">Equity</th><th class="num">Trades</th></tr></thead><tbody>` +
      rows
        .map(
          (r, i) => `<tr data-bot="${r.id}">
            <td>${i + 1}</td><td><b>${esc(r.name)}</b> <span class="muted">#${r.id}</span>${r.status !== 'running' ? ` <span class="tag">${esc(r.status)}</span>` : ''}</td>
            <td>@${esc(r.username)}${r.wallet ? `<br><a class="muted small" href="${explorer(`address/${r.wallet}`)}" target="_blank">${short(r.wallet)}</a>` : ''}</td>
            <td>${esc(r.strategy)} <span class="muted">${esc(r.timeframe)}</span></td><td>${r.assets.map(esc).join(', ')}</td>
            <td class="num ${pnlClass(r.pnl_pct)}">${pct(r.pnl_pct)}</td><td class="num">${usd(r.equity_usd)}</td><td class="num">${r.trades}</td></tr>`,
        )
        .join('') + '</tbody>'
    : `<tbody><tr><td class="empty">No ${mode} bots yet.${mode === 'paper' ? ' Create one in Telegram or under My bots.' : ''}</td></tr></tbody>`
  document.querySelectorAll('#board tr[data-bot]').forEach((tr) => tr.addEventListener('click', () => openBot(tr.dataset.bot)))
}

// --- bot detail --------------------------------------------------------------------

async function openBot(id) {
  const [b, trades, decisions] = await Promise.all([api(`/api/bots/${id}`), api(`/api/bots/${id}/trades`), api(`/api/bots/${id}/decisions`)])
  const positions = Object.entries(b.positions)
  $('#detail-body').innerHTML = `
    <h2>${esc(b.name)} <span class="muted">#${b.id}</span></h2>
    <p><span class="tag ${b.mode}">${b.mode.toUpperCase()}</span> <span class="tag">${esc(b.status)}</span> ${esc(b.strategy)} · ${b.assets.map(esc).join(', ')} · ${esc(b.timeframe)} · by @${esc(b.owner)}</p>
    ${b.haltedReason ? `<p class="error">Halted: ${esc(b.haltedReason)}</p>` : ''}
    ${b.lp ? `<p>Liquidity: ${b.lp.range ? `${b.lp.range.side === 'usdt' ? `${usd(b.lp.range.depositUsdt)} USDT in buy range` : `${qty(b.lp.range.depositAsset)} ${esc(b.assets[0])} in sell range`} ${b.lp.range.lower.toPrecision(6)}–${b.lp.range.upper.toPrecision(6)}${b.lp.range.tokenId ? ` · <a href="${explorer(`token/0xDF0A9b833Db0E4CeEa103A4408f3B68e7FC0cad5/instance/${b.lp.range.tokenId}`)}" target="_blank">position #${esc(b.lp.range.tokenId)}</a>` : ''}` : 'no open range'} · fees earned ${usd(b.lp.feesUsd)} · ${b.lp.fills} fills</p>` : ''}
    <div class="stats">
      <div><span class="muted">Equity</span><b>${usd(b.equityUsd)}</b></div>
      <div><span class="muted">P&amp;L</span><b class="${pnlClass(b.pnlPct)}">${pct(b.pnlPct)}</b></div>
      <div><span class="muted">Cash</span><b>${usd(b.cashUsdt)}</b></div>
      <div><span class="muted">Start</span><b>${usd(b.startUsdt)}</b></div>
    </div>
    ${b.mode === 'live' && b.wallet ? `<p>Wallet <a href="${explorer(`address/${b.wallet}`)}" target="_blank"><code>${b.wallet}</code></a></p>` : ''}
    <p class="muted small">Params: <code>${esc(JSON.stringify(b.params))}</code></p>
    <h3>Positions</h3>
    <p>${positions.length ? positions.map(([a, q]) => `${esc(a)} ${qty(q)}`).join(' · ') : '<span class="muted">none</span>'}</p>
    <div class="row chart-head"><h3>Chart</h3>${b.assets.length > 1 ? `<div class="toggle" id="chart-assets">${b.assets.map((a, i) => `<button data-asset="${esc(a)}"${i ? '' : ' class="active"'}>${esc(a.toUpperCase())}</button>`).join('')}</div>` : ''}</div>
    <div id="chart" class="chart"></div>
    <p class="muted small" id="chart-note"></p>
    <h3>Trades</h3>
    ${trades.length ? `<div class="table-wrap"><table><thead><tr><th>Time</th><th>Side</th><th>Asset</th><th class="num">USDT</th><th class="num">Price</th><th class="num">P&amp;L</th><th></th></tr></thead><tbody>${trades
      .map((t) => `<tr title="${esc(t.reason)}"><td>${when(t.time)}</td><td class="${t.side === 'buy' ? 'up' : 'down'}">${t.side}</td><td>${esc(t.asset)}</td>
        <td class="num">${usd(t.usdt)}</td><td class="num">${t.exec_price.toPrecision(6)}</td><td class="num ${pnlClass(t.realized_pnl)}">${t.realized_pnl == null ? '' : usd(t.realized_pnl)}</td>
        <td>${t.tx_hash ? `<a href="${explorer(`tx/${t.tx_hash}`)}" target="_blank">tx</a>` : ''}</td></tr>`)
      .join('')}</tbody></table></div>` : '<p class="muted">No trades yet.</p>'}
    <h3>Recent decisions</h3>
    <ul class="decisions">${decisions.slice(0, 20).map((d) => `<li><span class="muted">${when(d.time)} ${esc(d.asset)}</span> ${d.action ? `<b>${esc(d.action)}</b> ` : ''}${esc(d.error ?? d.reason ?? '')}</li>`).join('') || '<li class="muted">None yet.</li>'}</ul>`
  $('#detail').showModal()
  drawChart(b, trades, b.assets[0])
  document.querySelectorAll('#chart-assets button').forEach((x) =>
    x.addEventListener('click', () => {
      document.querySelectorAll('#chart-assets button').forEach((y) => y.classList.toggle('active', y === x))
      drawChart(b, trades, x.dataset.asset)
    }),
  )
}

// --- chart (TradingView Lightweight Charts) ----------------------------------------

// Chart times are shown as-is, so shift UTC to the viewer's local time.
const TZ = -new Date().getTimezoneOffset() * 60
const color = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
const toBars = (candles) => candles.map((c) => ({ time: c.time + TZ, open: c.open, high: c.high, low: c.low, close: c.close }))
const toPoints = (data) => data.map((d) => ({ time: d.time + TZ, value: d.value }))

function newChart(el, extra = {}) {
  return LightweightCharts.createChart(el, {
    autoSize: true,
    layout: { background: { color: color('--panel') }, textColor: color('--muted'), fontSize: 11 },
    grid: { vertLines: { color: color('--line') }, horzLines: { color: color('--line') } },
    rightPriceScale: { borderColor: color('--line') },
    timeScale: { borderColor: color('--line'), timeVisible: true, rightOffset: 6 },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    ...extra,
  })
}
const addCandles = (c) =>
  c.addCandlestickSeries({ upColor: color('--up'), downColor: color('--down'), borderVisible: false, wickUpColor: color('--up'), wickDownColor: color('--down') })

let chart = null
$('#detail').addEventListener('close', () => {
  chart?.remove()
  chart = null
})

async function drawChart(b, trades, asset) {
  chart?.remove()
  chart = null
  const el = $('#chart')
  if (!window.LightweightCharts) return void ($('#chart-note').textContent = 'Chart library failed to load.')
  const [data, lv] = await Promise.all([
    api(`/assets/${asset}/candles?timeframe=${b.timeframe}&limit=200`).catch((err) => ({ error: err.message })),
    api(`/api/bots/${b.id}/levels?asset=${asset}`).catch(() => ({ levels: [] })),
  ])
  if (!data.candles?.length) return void ($('#chart-note').textContent = `No candles for ${asset}${data.error ? `: ${data.error}` : ''}.`)

  const candles = toBars(data.candles)
  chart = newChart(el)
  const series = addCandles(chart)
  series.setData(candles)

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
  series.setMarkers(markers)

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
  chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, from), to: candles.length + 6 })

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

// --- my bots ---------------------------------------------------------------------

function renderAccount() {
  $('#account').innerHTML = me
    ? `@${esc(me.username)} · <a href="${explorer(`address/${me.wallet}`)}" target="_blank"><code>${short(me.wallet)}</code></a> <button id="logout" class="link">Log out</button>`
    : `<span class="muted">Log in: send <code>/web</code> to ${info.telegramBot ? `<a href="https://t.me/${esc(info.telegramBot)}" target="_blank">@${esc(info.telegramBot)}</a>` : 'the Telegram bot'}</span>`
  $('#logout')?.addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' })
    me = null
    renderAccount()
    loadMine()
  })
}

async function loadMine() {
  if (!me) {
    $('#login-note').hidden = false
    $('#login-note').innerHTML = `<h3>Log in with Telegram</h3><p>Open ${info.telegramBot ? `<a href="https://t.me/${esc(info.telegramBot)}" target="_blank">@${esc(info.telegramBot)}</a>` : 'the Swordfish Telegram bot'}, send <code>/start</code> to get your wallet, then <code>/web</code> for a one-time login link.</p>`
    $('#wallet').hidden = true
    $('#new-bot').hidden = true
    $('#my-bots').innerHTML = ''
    return
  }
  $('#login-note').hidden = true
  me = await api('/api/me')
  $('#wallet').hidden = false
  $('#wallet').innerHTML = `<h3>Your bot wallet</h3>
    <p><a href="${explorer(`address/${me.wallet}`)}" target="_blank"><code>${me.wallet}</code></a> <button class="link" id="copy">Copy</button></p>
    <div class="stats">${Object.entries(me.balances).map(([k, v]) => `<div><span class="muted">${k.toUpperCase()}</span><b>${qty(v)}</b></div>`).join('')}</div>
    <p class="muted small">Deposit USDT plus a little HSK for gas on HashKey Chain to run live bots. Withdraw with <code>/withdraw</code> in Telegram.</p>`
  $('#copy').addEventListener('click', () => navigator.clipboard.writeText(me.wallet))
  const bots = await api('/api/me/bots')
  $('#my-bots').innerHTML =
    bots
      .map(
        (b) => `<div class="card bot" data-bot="${b.id}">
          <div class="row"><b>${esc(b.name)}</b><span class="tag ${b.mode}">${b.mode.toUpperCase()}</span></div>
          <p class="muted small">#${b.id} · ${esc(b.strategy)} · ${b.assets.map(esc).join(', ')} · ${esc(b.timeframe)} · ${esc(b.status)}</p>
          <p><b class="${pnlClass(b.pnlPct)}">${pct(b.pnlPct)}</b> · ${usd(b.equityUsd)} · ${b.trades} trades</p>
          <div class="row"><button class="link" data-open="${b.id}">Details</button>
          <span>${b.status === 'running' ? `<button data-act="stop" data-id="${b.id}">Stop</button>` : `<button data-act="resume" data-id="${b.id}">Resume</button>`}
          <button data-act="delete" data-id="${b.id}">Delete</button></span></div>
        </div>`,
      )
      .join('') || '<p class="muted">No bots yet.</p>'
  document.querySelectorAll('[data-open]').forEach((x) => x.addEventListener('click', () => openBot(x.dataset.open)))
  document.querySelectorAll('[data-act]').forEach((x) =>
    x.addEventListener('click', async () => {
      if (x.dataset.act === 'delete' && !confirm(`Delete bot #${x.dataset.id} and its history?`)) return
      try {
        await api(`/api/bots/${x.dataset.id}/${x.dataset.act}`, { method: 'POST' })
      } catch (err) {
        alert(err.message)
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
    await api('/api/me/bots', {
      method: 'POST',
      body: JSON.stringify({ strategy: f.get('strategy'), assets: f.getAll('assets'), timeframe: f.get('timeframe'), params }),
    })
    loadMine()
  } catch (err) {
    $('#form-error').textContent = err.message
  }
})

// --- strategies --------------------------------------------------------------------

async function loadStrategies() {
  const list = await api('/api/strategies')
  $('#strategy-list').innerHTML = list
    .map(
      (s) => `<div class="card"><div class="row"><b>${esc(s.name)}</b>${s.llm ? '<span class="tag">Claude Haiku</span>' : ''}</div>
        <p>${esc(s.description)}</p>${Object.keys(s.params).length ? `<p class="muted small">Defaults <code>${esc(JSON.stringify(s.params))}</code></p>` : ''}
        <button class="link" data-preview="${esc(s.name)}">Preview on chart</button></div>`,
    )
    .join('')
  const options = list.map((s) => `<option value="${esc(s.name)}">${esc(s.name)}</option>`).join('')
  $('#new-bot select[name=strategy]').innerHTML = options
  $('#preview select[name=strategy]').innerHTML = options
  document.querySelectorAll('[data-preview]').forEach((x) =>
    x.addEventListener('click', () => {
      $('#preview select[name=strategy]').value = x.dataset.preview
      $('#preview').scrollIntoView({ behavior: 'smooth' })
      loadPreview()
    }),
  )
}

// --- assets ----------------------------------------------------------------------------

// Tradable assets: everything except stablecoins, wrapped HSK and test listings.
const STABLE = /usd|hkd|^whsk$/i
const PINNED = ['wbtc', 'weth', 'hsk']
const rank = (a) => (PINNED.includes(a.id) ? PINNED.indexOf(a.id) : PINNED.length)

async function loadAssets() {
  const all = await api('/assets')
  const list = all
    .filter((a) => ['crypto', 'stock'].includes(a.category) && !STABLE.test(a.id))
    .sort((a, b) => rank(a) - rank(b) || a.category.localeCompare(b.category) || a.symbol.localeCompare(b.symbol))
  const group = (cat, label) =>
    `<optgroup label="${label}">${list.filter((a) => a.category === cat).map((a) => `<option value="${esc(a.id)}">${esc(a.symbol)} · ${esc(a.name)}</option>`).join('')}</optgroup>`
  $('#preview select[name=asset]').innerHTML = group('crypto', 'Crypto') + group('stock', 'Tokenized stocks')
  $('#asset-picks').innerHTML = list
    .map((a) => `<label class="inline"><input type="checkbox" name="assets" value="${esc(a.id)}"${['wbtc', 'weth'].includes(a.id) ? ' checked' : ''}> ${esc(a.symbol)}</label>`)
    .join('')
}

// --- strategy preview -------------------------------------------------------------------

let previewCharts = []
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
  $('#preview-note').textContent = 'Loading…'
  $('#preview-msg').textContent = ''
  const data = await api(`/api/preview?${q}`).catch((err) => ({ error: err.message }))
  if (seq !== previewSeq) return
  for (const c of previewCharts) c.remove()
  previewCharts = []
  $('#preview-stats').innerHTML = ''
  $('#preview-legend').innerHTML = ''
  if (data.error || !data.candles?.length) return void ($('#preview-note').textContent = data.error ?? 'No candles for this asset.')

  const bars = toBars(data.candles)
  const main = newChart($('#preview-chart'))
  previewCharts.push(main)
  const series = addCandles(main)
  series.setData(bars)

  // Indicator lines: bands share a colour with a muted middle, others get the palette.
  const bands = data.lines.length === 3
  const palette = bands ? [color('--accent'), color('--muted'), color('--accent')] : [color('--accent'), color('--live'), color('--muted')]
  const legend = []
  data.lines.forEach((l, i) => {
    const s = main.addLineSeries({ color: palette[i % palette.length], lineWidth: bands && i === 1 ? 1 : 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
    s.setData(toPoints(l.data))
    legend.push([l.name, palette[i % palette.length]])
  })

  series.setMarkers(
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

  // Oscillator pane (MACD / RSI) on its own chart, kept in step with the price chart.
  const paneEl = $('#preview-pane')
  paneEl.hidden = !data.pane
  if (data.pane) {
    const pane = newChart(paneEl, { timeScale: { visible: false, rightOffset: 6 } })
    previewCharts.push(pane)
    // Whitespace on every candle time so both charts share the same bar indexes.
    pane.addLineSeries({ lastValueVisible: false, priceLineVisible: false }).setData(bars.map((b) => ({ time: b.time })))
    if (data.pane.histogram.length) {
      pane.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false }).setData(
        toPoints(data.pane.histogram).map((d) => ({ ...d, color: d.value >= 0 ? color('--up') : color('--down') })),
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
      const s = pane.addLineSeries({ color: lineColor, lineWidth: 2, priceLineVisible: false, crosshairMarkerVisible: false, autoscaleInfoProvider })
      s.setData(toPoints(l.data))
      if (i === 0) for (const h of data.pane.hlines) s.createPriceLine({ price: h.price, color: color('--muted'), lineStyle: LightweightCharts.LineStyle.Dashed, lineWidth: 1, title: h.label })
      legend.push([l.name, lineColor])
    })
    let syncing = false
    const link = (from, to) =>
      from.timeScale().subscribeVisibleLogicalRangeChange((r) => {
        if (!r || syncing) return
        syncing = true
        to.timeScale().setVisibleLogicalRange(r)
        syncing = false
      })
    link(main, pane)
    link(pane, main)
  }
  main.timeScale().fitContent()

  $('#preview-legend').innerHTML =
    legend.map(([name, c]) => `<span><i style="background:${c}"></i>${esc(name)}</span>`).join('') +
    (data.stats ? `<span><b class="up">▲ B</b> buy</span><span><b class="down">▼ S</b> sell (return after fees)</span>` : '')

  const st = data.stats
  const days = ((data.candles.at(-1).time - data.candles[0].time) / 86_400).toFixed(0)
  if (st) {
    $('#preview-stats').innerHTML = [
      ['Round trips', st.roundTrips + (st.openPct != null ? ' + open' : '')],
      ['Win rate', st.winRatePct == null ? '–' : `${st.winRatePct.toFixed(0)}%`],
      ['Strategy', `<span class="${pnlClass(st.returnPct)}">${pct(st.returnPct)}</span>`],
      ['Buy & hold', `<span class="${pnlClass(st.buyHoldPct)}">${pct(st.buyHoldPct)}</span>`],
      ...(st.lp ? [['LP fees earned', `<span class="up">${pct(st.feesEarnedPct)}</span>`]] : []),
    ]
      .map(([k, v]) => `<div><span class="muted">${k}</span><b>${v}</b></div>`)
      .join('')
  }
  $('#preview-note').innerHTML =
    data.warnings.map((w) => `<span class="error">⚠ ${esc(w)}</span><br>`).join('') +
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
  if (!me) return void ($('#preview-msg').innerHTML = `Log in first: send <code>/web</code> to the Telegram bot.`)
  const q = previewQuery()
  const params = {}
  for (const k of ['stopLossPct', 'takeProfitPct', 'trailingStopPct']) if (q.has(k)) params[k] = Number(q.get(k))
  try {
    const b = await api('/api/me/bots', { method: 'POST', body: JSON.stringify({ strategy: q.get('strategy'), assets: [q.get('asset')], timeframe: q.get('timeframe'), params }) })
    $('#preview-msg').innerHTML = `<span class="up">Created paper bot #${b.id}.</span> See it under My bots.`
  } catch (err) {
    $('#preview-msg').innerHTML = `<span class="error">${esc(err.message)}</span>`
  }
})

// --- boot ----------------------------------------------------------------------------

info = await api('/api/info').catch(() => ({}))
me = await api('/api/me').catch(() => null)
renderAccount()
await Promise.all([loadStrategies(), loadAssets().catch(() => {})])
loadBoard()
setInterval(() => !$('#leaderboard').hidden && loadBoard(), 60_000)
