// Local price + TA API for HashKey Chain assets.
//
//   GET /health
//   GET /assets[?category=crypto|stock|fund|3887-test]
//   GET /assets/:id                  id = registry id (e.g. hsk, weth, aapls) or token address
//   GET /assets/:id/price
//   GET /prices[?category=...]
//   GET /assets/:id/candles?timeframe=1h&limit=200
//   GET /assets/:id/ta?timeframe=1h&limit=200&rsi.period=21    (TA_ENABLED=true)
//   GET /ta/indicators
//
// Paper trading (PAPER_ENABLED=true):
//   GET  /paper/portfolio
//   GET  /paper/trades?limit=100
//   GET  /paper/decisions?limit=100
//   GET  /paper/quote?asset=hsk&side=buy&usdt=10     (or side=sell&quantity=100)
//   POST /paper/orders   { "asset": "hsk", "side": "buy", "usdt": 10 }
//                        { "asset": "hsk", "side": "sell", "quantity": 100 | "fraction": 0.5 }
//   POST /paper/reset
//
// Multi-user bots (BOTS_ENABLED=true), Telegram login via /web links:
//   GET  /                         landing page; /app after the dashboard has been opened once
//   GET  /app                      dashboard (public/index.html); /landing always shows the landing page
//   GET  /auth/login?token=...     one-time link from the Telegram bot's /web
//   POST /api/auth/request         start a sign-in approved in Telegram; GET /api/auth/poll?code= collects it
//   POST /api/logout
//   GET  /api/strategies
//   GET  /api/leaderboard?mode=paper|live
//   GET  /api/preview?strategy=&asset=&timeframe=[&param=value]  strategy replay for the chart preview
//   GET  /api/bots/:id             public bot view; also /trades, /decisions, /levels?asset=
//   GET  /api/me                   (session) user, wallet, balances
//   GET  /api/me/bots              (session)
//   POST /api/me/bots              (session) { strategy, assets, timeframe, params } -> paper bot
//   POST /api/bots/:id/stop        (session) also /resume, /delete

import { timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { assets, findAsset } from './assets.mjs'
import { getCandles, startSampler, TIMEFRAMES } from './candles.mjs'
import { config } from './config.mjs'
import { telegramAllowed } from './access.mjs'
import { quoteOrder } from './execution.mjs'
import * as paper from './paper.mjs'
import { getPrice } from './pricing.mjs'
import { analyze, enabledPlugins, loadPlugins } from './ta/index.mjs'
import * as db from './db.mjs'
import { botLevels, catalog, committedFunds, createBotFor, deleteBot, previewStrategy, ownedBot, setStatus, startEngine, walletBalances } from './engine.mjs'
import { startTelegram } from './telegram.mjs'
import * as auth from './auth.mjs'
import { landingMedia } from './landing-media.mjs'

const httpError = (status, message) => Object.assign(new Error(message), { status })

function assetOr404(id) {
  const asset = findAsset(id)
  if (!asset) throw httpError(404, `Unknown asset ${id}; see GET /assets`)
  return asset
}

function filterAssets(query) {
  const category = query.get('category')
  return category ? assets.filter((a) => a.category === category) : assets
}

function candleQuery(query) {
  const timeframe = query.get('timeframe') ?? '1h'
  const limit = Math.max(1, Math.min(Number(query.get('limit') ?? 200), 1000))
  return [timeframe, limit]
}

// ?rsi.period=21&macd.fast=8 -> { rsi: { period: 21 }, macd: { fast: 8 } }
function taOverrides(query) {
  const out = {}
  for (const [key, value] of query) {
    const [name, param] = key.split('.')
    if (!param) continue
    out[name] ??= {}
    out[name][param] = Number.isNaN(Number(value)) ? value : Number(value)
  }
  return out
}

// A handler can return raw() to control the response itself.
const RAW = Symbol('raw')
const raw = (status, headers, body) => ({ [RAW]: { status, headers, body } })

function botsOnly() {
  if (!config.bots.enabled) throw httpError(404, 'Bots are disabled; set BOTS_ENABLED=true')
}

const cookies = (req) => Object.fromEntries((req.headers.cookie ?? '').split(';').map((c) => c.trim().split('=')).filter(([k]) => k))
function sessionUser(ctx) {
  botsOnly()
  const user = ctx.sid && db.useToken(ctx.sid, 'session')
  if (!user || !telegramAllowed(user.tg_id, user.username)) throw httpError(401, 'Log in with /web in the Telegram bot')
  return user
}

const publicBot = (b) => ({
  id: b.id, name: b.name, strategy: b.strategy, params: b.params, assets: b.assets, timeframe: b.timeframe, intervalSec: b.interval_sec,
  mode: b.mode, status: b.status, haltedReason: b.halted_reason, startUsdt: b.start_usdt, cashUsdt: b.cash, positions: b.positions,
  equityUsd: b.equity_usd, pnlPct: b.pnl_pct, gasUsd: b.gas_usd, trades: b.trades, createdAt: b.created_at, updatedAt: b.updated_at,
  lp: b.lp && { feesUsd: b.lp.feesUsd, fills: b.lp.fills, range: b.lp.range && (({ L, lastUsdt, ...r }) => r)(b.lp.range) },
  owner: db.getUser(b.user_id)?.username ?? null,
  wallet: db.getWallet(b.user_id)?.address ?? null,
})
const publicBotById = (id) => {
  botsOnly()
  const b = db.getBot(Number(id))
  if (!b) throw httpError(404, `No bot #${id}`)
  return b
}

// `/` is the landing page until someone opens the dashboard at /app; from then on `/` takes
// them straight to /app (a cookie remembers it). The landing page stays at /landing.
const STATIC = {
  '/landing': ['landing.html', 'text/html'],
  '/landing.html': ['landing.html', 'text/html'],
  '/landing.css': ['landing.css', 'text/css'],
  '/landing.js': ['landing.js', 'text/javascript'],
  '/app.js': ['app.js', 'text/javascript'],
  '/style.css': ['style.css', 'text/css'],
  '/art.js': ['art.js', 'text/javascript'],
  '/charts.js': ['charts.js', 'text/javascript'],
}
const staticFile = (name, type) => async () =>
  raw(200, { 'content-type': `${type}; charset=utf-8` }, await readFile(new URL(`../public/${name}`, import.meta.url)))

function paperOnly() {
  if (!config.paper.enabled) throw httpError(404, 'Paper trading is disabled; set PAPER_ENABLED=true')
}

const HOME_COOKIE = 'sf_home=app; Path=/; Max-Age=31536000; SameSite=Lax'

// Invite page: the unguessable ADMIN_TOKEN in the URL is the only credential.
function adminOnly(token) {
  const want = Buffer.from(config.adminToken), got = Buffer.from(String(token))
  if (!config.adminToken || want.length !== got.length || !timingSafeEqual(want, got)) throw httpError(404, 'Not found')
}
const PRIVATE = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' }
function parseInvite({ kind, value, note }) {
  const v = String(value ?? '').trim()
  if (kind === 'username') {
    const name = v.replace(/^@/, '').replace(/^https?:\/\/t\.me\//, '').toLowerCase()
    if (!/^[a-z0-9_]{4,32}$/.test(name)) throw httpError(400, 'Telegram usernames are 4-32 letters, numbers or underscores')
    return { kind, value: name, note: String(note ?? '').trim().slice(0, 80) }
  }
  if (kind === 'phone') {
    const digits = v.replace(/\D/g, '')
    if (digits.replace(/^0+/, '').length < 8 || digits.length > 15) throw httpError(400, 'Enter the full phone number, ideally with the country code')
    return { kind, value: digits, note: String(note ?? '').trim().slice(0, 80) }
  }
  throw httpError(400, 'Choose username or phone')
}
const inviteList = () => ({
  bot: config.telegramUsername ?? null,
  operators: config.telegramAllowed.length,
  invites: db.listInvites().map((i) => ({ id: i.id, kind: i.kind, value: i.value, note: i.note, createdAt: i.created_at, joinedAt: i.joined_at, joinedAs: i.joined_as })),
})
const page = (name) => readFile(new URL(`../public/${name}`, import.meta.url))

const routes = [
  ['/', async (_, __, ___, ctx) =>
    ctx.cookies.sf_home === 'app'
      ? raw(302, { location: '/app' }, '')
      : raw(200, { 'content-type': 'text/html; charset=utf-8' }, await page('landing.html'))],
  ['/invite/:token', async ({ token }) => {
    adminOnly(token)
    return raw(200, { 'content-type': 'text/html; charset=utf-8', ...PRIVATE }, await page('invite.html'))
  }],
  ['/api/invite/:token', async ({ token }) => (adminOnly(token), inviteList())],
  ['/api/invite/:token', async ({ token }, _, body) => {
    adminOnly(token)
    const invite = parseInvite(body ?? {})
    db.addInvite(invite.kind, invite.value, invite.note)
    return inviteList()
  }, 'POST'],
  ['/api/invite/:token/remove', async ({ token }, _, body) => {
    adminOnly(token)
    db.removeInvite(Number(body?.id))
    return inviteList()
  }, 'POST'],
  ['/app', async () => raw(200, { 'content-type': 'text/html; charset=utf-8', 'set-cookie': HOME_COOKIE }, await page('index.html'))],
  ...Object.entries(STATIC).map(([path, [name, type]]) => [path, staticFile(name, type)]),
  ['/landing-media/:asset', async ({ asset }, _, __, ctx) => {
    const result = await landingMedia(asset, ctx.range)
    return raw(result.status, result.headers, result.body)
  }],
  ['/auth/login', async (_, q) => {
    botsOnly()
    const user = db.useToken(q.get('token') ?? '', 'login', { consume: true })
    if (!user) return raw(401, { 'content-type': 'text/plain' }, 'Link expired or already used. Send /web to the Telegram bot for a new one.')
    const sid = db.issueToken(user.id, 'session', 30 * 86_400)
    return raw(302, { location: '/app', 'set-cookie': `sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86_400}` }, '')
  }],
  ['/api/auth/request', async () => {
    botsOnly()
    const { code, secret } = auth.requestLogin()
    return raw(200, { 'content-type': 'application/json', 'set-cookie': `lr=${secret}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=${auth.LOGIN_TTL_SEC}` },
      JSON.stringify({ code, bot: config.telegramUsername ?? null, ttlSec: auth.LOGIN_TTL_SEC }))
  }, 'POST'],
  ['/api/auth/poll', async (_, q, __, ctx) => {
    botsOnly()
    const r = auth.collectLogin(q.get('code') ?? '', ctx.cookies.lr ?? '')
    const user = r.status === 'approved' && db.getUser(r.userId)
    if (!user) return { status: r.status === 'approved' ? 'expired' : r.status }
    const sid = db.issueToken(user.id, 'session', 30 * 86_400)
    return raw(200, { 'content-type': 'application/json', 'set-cookie': [`sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86_400}`, 'lr=; Path=/api/auth; Max-Age=0'] },
      JSON.stringify({ status: 'approved', username: user.username }))
  }],
  ['/api/logout', async (_, __, ___, ctx) => {
    if (ctx.sid) db.revokeToken(ctx.sid)
    return raw(200, { 'content-type': 'application/json', 'set-cookie': 'sid=; Path=/; Max-Age=0' }, '{"ok":true}')
  }, 'POST'],
  ['/api/info', async () => (botsOnly(), { telegramBot: config.telegramUsername ?? null, paperStartUsdt: config.bots.paperStartUsdt })],
  ['/api/strategies', async () => (botsOnly(), catalog())],
  ['/api/leaderboard', async (_, q) => (botsOnly(), db.leaderboard(q.get('mode') === 'live' ? 'live' : 'paper', 100))],
  ['/api/me', async (_, __, ___, ctx) => {
    const user = sessionUser(ctx)
    const wallet = db.getWallet(user.id)
    // `live`: what running live bots have reserved, and the limits /live checks, for the wallet's readiness list.
    const { bots: b } = config
    return {
      id: user.id, username: user.username, wallet: wallet?.address ?? null, balances: wallet ? await walletBalances(wallet.address) : null,
      live: { reserved: committedFunds(user.id), minGasHsk: b.minGasHsk, maxBudgetUsd: b.liveMaxBudgetUsd, maxTradeUsd: b.liveMaxTradeUsd, dailyLossPct: b.liveDailyLossPct },
    }
  }],
  ['/api/me/bots', async (_, __, ___, ctx) => db.userBots(sessionUser(ctx).id).map(publicBot)],
  ['/api/me/bots', async (_, __, body, ctx) => publicBot(createBotFor(sessionUser(ctx), body)), 'POST'],
  ['/api/bots/:id', async ({ id }) => publicBot(publicBotById(id))],
  ['/api/bots/:id/trades', async ({ id }) => db.botTrades(publicBotById(id).id, 200)],
  ['/api/preview', async (_, q) => {
    botsOnly()
    const { strategy, asset, timeframe, ...params } = Object.fromEntries(q)
    return previewStrategy({ strategy, asset, timeframe, params })
  }],
  ['/api/bots/:id/levels', async ({ id }, q) => {
    const bot = publicBotById(id)
    return botLevels(bot, q.get('asset') ?? bot.assets[0])
  }],
  ['/api/bots/:id/decisions', async ({ id }) => db.botDecisions(publicBotById(id).id, 100)],
  ['/api/bots/:id/delete', async ({ id }, __, ___, ctx) => {
    await deleteBot(ownedBot(sessionUser(ctx), id))
    return { ok: true }
  }, 'POST'],
  ['/api/bots/:id/stop', async ({ id }, __, ___, ctx) => publicBot(setStatus(ownedBot(sessionUser(ctx), id), 'stopped')), 'POST'],
  ['/api/bots/:id/resume', async ({ id }, __, ___, ctx) => publicBot(setStatus(ownedBot(sessionUser(ctx), id), 'running')), 'POST'],
  ['/health', async () => ({
    ok: true,
    chainId: 177,
    candleSource: config.candleSource,
    ta: { enabled: config.ta.enabled, indicators: enabledPlugins().map((p) => p.name) },
    paper: { enabled: config.paper.enabled, strategy: config.paper.strategy || null },
  })],
  ['/paper/portfolio', async () => (paperOnly(), paper.portfolio())],
  ['/paper/trades', async (_, q) => (paperOnly(), paper.trades(Number(q.get('limit') ?? 100)))],
  ['/paper/decisions', async (_, q) => (paperOnly(), paper.decisions(Number(q.get('limit') ?? 100)))],
  ['/paper/quote', async (_, q) => {
    paperOnly()
    const asset = assetOr404(q.get('asset') ?? '')
    const usdt = findAsset('usdt')
    const side = q.get('side') ?? 'buy'
    const amount = Number(side === 'buy' ? q.get('usdt') : q.get('quantity'))
    if (!(amount > 0)) throw httpError(400, side === 'buy' ? 'pass ?usdt=' : 'pass ?quantity=')
    const [quote, price] = await Promise.all([
      quoteOrder(asset, usdt, side, amount),
      getPrice(asset),
    ])
    if (!quote) throw httpError(422, `No route with liquidity for ${asset.symbol}`)
    const execPrice = side === 'buy' ? quote.amountIn / quote.amountOut : quote.amountOut / quote.amountIn
    const impactPct = (side === 'buy' ? execPrice / price.priceUsd - 1 : 1 - execPrice / price.priceUsd) * 100
    return { asset: asset.id, side, ...quote, execPrice, midPrice: price.priceUsd, impactPct }
  }],
  ['/paper/orders', async (_, __, body) => (paperOnly(), paper.placeOrder(body)), 'POST'],
  ['/paper/reset', async () => (paperOnly(), paper.reset()), 'POST'],
  ['/assets', async (_, q) => filterAssets(q)],
  ['/prices', async (_, q) => {
    const results = await Promise.allSettled(filterAssets(q).map(getPrice))
    return results.map((r, i) => (r.status === 'fulfilled' ? r.value : { id: filterAssets(q)[i].id, error: r.reason.message }))
  }],
  ['/ta/indicators', async () => {
    if (!config.ta.enabled) throw httpError(404, 'TA is disabled; set TA_ENABLED=true')
    return enabledPlugins().map((p) => ({ name: p.name, params: { ...p.defaults, ...p.envParams } }))
  }],
  ['/assets/:id', async ({ id }) => assetOr404(id)],
  ['/assets/:id/price', async ({ id }) => getPrice(assetOr404(id))],
  ['/assets/:id/candles', async ({ id }, q) => {
    const asset = assetOr404(id)
    const [timeframe, limit] = candleQuery(q)
    return { id: asset.id, symbol: asset.symbol, timeframe, ...(await getCandles(asset, timeframe, limit)) }
  }],
  ['/assets/:id/ta', async ({ id }, q) => {
    if (!config.ta.enabled) throw httpError(404, 'TA is disabled; set TA_ENABLED=true')
    const asset = assetOr404(id)
    const [timeframe, limit] = candleQuery(q)
    const [price, { candles, ...meta }] = await Promise.all([getPrice(asset), getCandles(asset, timeframe, limit)])
    // Gap-filled candles are flat; flag when most of the window has no trades.
    // (Sampler candles carry no volume, so this only applies to GeckoTerminal.)
    const flatTail = candles.length - 1 - candles.findLastIndex((c) => c.volume > 0)
    const warning =
      meta.source === 'geckoterminal' && flatTail > candles.length / 2
        ? `${flatTail} of ${candles.length} candles have no trades (gap-filled); indicators reflect stale prices`
        : undefined
    return {
      ...(warning && { warning }),
      id: asset.id,
      symbol: asset.symbol,
      priceUsd: price.priceUsd,
      timeframe,
      candleSource: meta.source,
      ...(meta.pool && { candlePool: meta.pool }),
      ...(meta.lastTradeAt !== undefined && { lastTradeAt: meta.lastTradeAt }),
      candles: candles.length,
      lastCandle: candles.at(-1) ?? null,
      indicators: analyze(candles, taOverrides(q)),
    }
  }],
].map(([pattern, handler, method = 'GET']) => {
  const names = []
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, n) => (names.push(n), '([^/]+)'))}/?$`)
  return { re, names, handler, method }
})

async function readJson(req) {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > 64 * 1024) throw httpError(413, 'Body too large')
  }
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    throw httpError(400, 'Body must be JSON')
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
    res.end(JSON.stringify(body, null, 2))
  }
  const matches = routes.filter((r) => r.re.test(url.pathname))
  if (matches.length) {
    const route = matches.find((r) => r.method === req.method)
    if (!route) return send(405, { error: `Use ${matches.map((r) => r.method).join(' or ')} for ${url.pathname}` })
    const m = url.pathname.match(route.re)
    const params = Object.fromEntries(route.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]))
    try {
      const body = route.method === 'POST' ? await readJson(req) : undefined
      const jar = cookies(req)
      const out = await route.handler(params, url.searchParams, body, { sid: jar.sid, cookies: jar, range: req.headers.range })
      if (out?.[RAW]) {
        res.writeHead(out[RAW].status, out[RAW].headers)
        return res.end(out[RAW].body)
      }
      return send(200, out)
    } catch (err) {
      const status = err.status ?? 500
      if (status >= 500) console.error(`${req.url}: ${err.stack ?? err}`)
      return send(status, { error: err.message })
    }
  }
  send(404, { error: 'Not found', routes: routes.map((r) => `${r.method} ${r.re.source}`) })
})

// Bots need the indicators their strategies read.
if (config.bots.enabled) {
  config.ta.enabled = true
  config.ta.indicators = [...new Set([...config.ta.indicators, 'rsi', 'macd', 'bbands'])]
}
const plugins = await loadPlugins()
if (config.candleSource === 'sampler') await startSampler()
const paperInfo = await paper.startPaper()
if (config.bots.enabled) {
  await startEngine()
  startTelegram()
}

server.listen(config.port, () => {
  console.log(`swordfish API on http://localhost:${config.port}`)
  console.log(`assets: ${assets.length}, candles: ${config.candleSource}, timeframes: ${Object.keys(TIMEFRAMES).join(',')}`)
  console.log(`TA: ${config.ta.enabled ? plugins.map((p) => p.name).join(', ') : 'disabled (TA_ENABLED=true to enable)'}`)
  console.log(
    `Paper: ${!paperInfo ? 'disabled (PAPER_ENABLED=true to enable)' : `${config.paper.stateFile}, strategy ${paperInfo.strategy ?? 'none (manual orders only)'}`}`,
  )
  console.log(`Bots: ${config.bots.enabled ? `on, dashboard ${config.webUrl}, Telegram ${config.telegramToken ? 'on' : 'off (no TELEGRAM_BOT_TOKEN)'}` : 'disabled (BOTS_ENABLED=true to enable)'}`)
})
