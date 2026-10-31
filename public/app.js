// Swordfish dashboard: leaderboard, your bots and wallet, strategy catalog.

const $ = (sel) => document.querySelector(sel)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const usd = (n) => (n == null ? '–' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }))
const pct = (n) => (n == null ? '–' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`)
const pnlClass = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : '')
const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '')
const qty = (n) => (n >= 1 ? n.toFixed(4) : n.toPrecision(4))
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
    <h3>Trades</h3>
    ${trades.length ? `<div class="table-wrap"><table><thead><tr><th>Time</th><th>Side</th><th>Asset</th><th class="num">USDT</th><th class="num">Price</th><th class="num">P&amp;L</th><th></th></tr></thead><tbody>${trades
      .map((t) => `<tr title="${esc(t.reason)}"><td>${t.time.slice(5, 16).replace('T', ' ')}</td><td class="${t.side === 'buy' ? 'up' : 'down'}">${t.side}</td><td>${esc(t.asset)}</td>
        <td class="num">${usd(t.usdt)}</td><td class="num">${t.exec_price.toPrecision(6)}</td><td class="num ${pnlClass(t.realized_pnl)}">${t.realized_pnl == null ? '' : usd(t.realized_pnl)}</td>
        <td>${t.tx_hash ? `<a href="${explorer(`tx/${t.tx_hash}`)}" target="_blank">tx</a>` : ''}</td></tr>`)
      .join('')}</tbody></table></div>` : '<p class="muted">No trades yet.</p>'}
    <h3>Recent decisions</h3>
    <ul class="decisions">${decisions.slice(0, 20).map((d) => `<li><span class="muted">${d.time.slice(5, 16).replace('T', ' ')} ${esc(d.asset)}</span> ${d.action ? `<b>${esc(d.action)}</b> ` : ''}${esc(d.error ?? d.reason ?? '')}</li>`).join('') || '<li class="muted">None yet.</li>'}</ul>`
  $('#detail').showModal()
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
          ${b.status === 'running' ? `<button data-act="stop" data-id="${b.id}">Stop</button>` : `<button data-act="resume" data-id="${b.id}">Resume</button>`}</div>
        </div>`,
      )
      .join('') || '<p class="muted">No bots yet.</p>'
  document.querySelectorAll('[data-open]').forEach((x) => x.addEventListener('click', () => openBot(x.dataset.open)))
  document.querySelectorAll('[data-act]').forEach((x) =>
    x.addEventListener('click', async () => {
      await api(`/api/bots/${x.dataset.id}/${x.dataset.act}`, { method: 'POST' })
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
        <p>${esc(s.description)}</p>${Object.keys(s.params).length ? `<p class="muted small">Defaults <code>${esc(JSON.stringify(s.params))}</code></p>` : ''}</div>`,
    )
    .join('')
  $('#new-bot select[name=strategy]').innerHTML = list.map((s) => `<option value="${esc(s.name)}">${esc(s.name)}</option>`).join('')
}

// --- boot ----------------------------------------------------------------------------

info = await api('/api/info').catch(() => ({}))
me = await api('/api/me').catch(() => null)
renderAccount()
await loadStrategies()
loadBoard()
setInterval(() => !$('#leaderboard').hidden && loadBoard(), 60_000)
