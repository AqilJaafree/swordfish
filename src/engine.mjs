// Multi-user bot engine. Every running bot ticks on its own interval: it reads
// candles + TA per asset, applies its exit rules (stop loss, take profit,
// trailing stop), asks its strategy, and fills the order either on paper (live
// pool quotes) or live (a real SwapRouter02 swap from the user's custodial
// wallet). Emits 'trade' and 'halt' events for notifications.

import { EventEmitter } from 'node:events'
import { createWalletClient, erc20Abi, formatUnits, http, parseUnits } from 'viem'
import { findAsset } from './assets.mjs'
import { getCandles, TIMEFRAMES } from './candles.mjs'
import { client, hashkey, NATIVE } from './chain.mjs'
import { config } from './config.mjs'
import * as db from './db.mjs'
import { quoteOrder } from './execution.mjs'
import { getPrice } from './pricing.mjs'
import { analyze, enabledPlugins } from './ta/index.mjs'
import { balanceOf, executeSwap, same } from './v3.mjs'
import { unlock } from './vault.mjs'

export const events = new EventEmitter()
const httpError = (status, message) => Object.assign(new Error(message), { status })

// --- strategies ----------------------------------------------------------------

const BUILTIN = ['sma-cross', 'macd-trend', 'bollinger-reversion', 'breakout', 'rsi-reversion', 'claude']
const strategies = new Map()

export async function loadStrategies() {
  for (const name of BUILTIN) {
    const mod = (await import(`./strategies/${name}.mjs`)).default
    strategies.set(mod.name, { defaults: {}, requires: [], ...mod })
  }
}

// Exit rules and sizing every bot gets; 0 disables a rule.
export const RISK_DEFAULTS = {
  tradeUsd: 20,
  maxPositionUsd: 100,
  maxImpactPct: 5,
  slippagePct: 0.5,
  stopLossPct: 0,
  takeProfitPct: 0,
  trailingStopPct: 0,
  maxDrawdownPct: 0,
}

export const catalog = () =>
  [...strategies.values()].map((s) => ({
    name: s.name,
    description: s.description ?? '',
    params: { ...s.defaults },
    requires: s.requires,
    llm: s.name === 'claude',
  }))

const paramsFor = (bot) => {
  const p = { ...RISK_DEFAULTS, ...strategies.get(bot.strategy)?.defaults, ...bot.params }
  if (bot.mode === 'live') {
    p.tradeUsd = Math.min(p.tradeUsd, config.bots.liveMaxTradeUsd)
    p.maxImpactPct = Math.min(p.maxImpactPct, config.bots.liveMaxImpactPct)
  }
  return p
}

// --- bot lifecycle ---------------------------------------------------------------

export function createBotFor(user, { name, strategy, assets, timeframe = '1h', intervalSec = 300, params = {} }) {
  const s = strategies.get(strategy)
  if (!s) throw httpError(400, `Unknown strategy ${strategy}; options: ${[...strategies.keys()].join(', ')}`)
  if (!TIMEFRAMES[timeframe]) throw httpError(400, `timeframe must be one of ${Object.keys(TIMEFRAMES).join(', ')}`)
  const list = (Array.isArray(assets) ? assets : String(assets ?? '').split(',')).map((a) => a.trim()).filter(Boolean)
  if (!list.length || list.length > 5) throw httpError(400, 'Pick 1 to 5 assets, e.g. btc,eth')
  const ids = list.map((a) => {
    const asset = findAsset(a)
    if (!asset || asset.id === 'usdt') throw httpError(400, `Unknown or untradable asset ${a}`)
    return asset.id
  })
  const mine = db.userBots(user.id)
  if (mine.length >= config.bots.maxPerUser) throw httpError(400, `Bot limit reached (${config.bots.maxPerUser})`)
  if (strategy === 'claude' && mine.filter((b) => b.strategy === 'claude').length >= config.bots.maxClaudePerUser) {
    throw httpError(400, `Claude bot limit reached (${config.bots.maxClaudePerUser})`)
  }
  const clean = {}
  for (const [k, v] of Object.entries(params ?? {})) {
    if (!(k in RISK_DEFAULTS) && !(k in s.defaults)) throw httpError(400, `Unknown param ${k}`)
    clean[k] = typeof s.defaults[k] === 'string' ? String(v) : Number(v)
    if (typeof clean[k] === 'number' && !Number.isFinite(clean[k])) throw httpError(400, `Param ${k} must be a number`)
  }
  return db.createBot({
    userId: user.id,
    name: String(name || `${strategy} ${ids.join('/')}`).slice(0, 60),
    strategy,
    params: clean,
    assets: [...new Set(ids)],
    timeframe,
    intervalSec: Math.max(config.bots.minIntervalSec, Number(intervalSec) || 300),
    startUsdt: config.bots.paperStartUsdt,
  })
}

export function ownedBot(user, id) {
  const bot = db.getBot(Number(id))
  if (!bot || bot.user_id !== user.id) throw httpError(404, `No bot #${id}`)
  return bot
}

export const setStatus = (bot, status) => db.updateBot(bot.id, { status, halted_reason: null })

const ONCHAIN_DECIMALS = (asset) => (same(asset.address, NATIVE) ? 18 : asset.decimals)

export async function walletBalances(address) {
  const ids = ['hsk', 'usdt', 'weth', 'wbtc']
  const values = await Promise.all(ids.map((id) => balanceOf(findAsset(id).address, address)))
  return Object.fromEntries(ids.map((id, i) => [id, Number(formatUnits(values[i], ONCHAIN_DECIMALS(findAsset(id))))]))
}

/** Switch a bot to real trading with a USDT budget from the user's wallet. Resets its book. */
export async function goLive(user, bot, budgetUsdt) {
  const wallet = db.getWallet(user.id)
  if (!wallet) throw httpError(400, 'No wallet; use /start in Telegram')
  const budget = Number(budgetUsdt)
  if (!(budget >= 1 && budget <= config.bots.liveMaxBudgetUsd)) throw httpError(400, `Budget must be 1-${config.bots.liveMaxBudgetUsd} USDT`)
  const offchain = bot.assets.map(findAsset).filter((a) => a.reference?.fills)
  if (offchain.length) throw httpError(400, `${offchain.map((a) => a.symbol).join(', ')} has no on-chain liquidity; live bots need pool assets`)
  const bal = await walletBalances(wallet.address)
  const committed = db.userBots(user.id).filter((b) => b.mode === 'live' && b.id !== bot.id && b.status === 'running').reduce((s, b) => s + b.cash, 0)
  if (bal.usdt < budget + committed) throw httpError(400, `Wallet has ${bal.usdt} USDT; needs ${budget + committed} (incl. ${committed} for other live bots)`)
  if (bal.hsk < config.bots.minGasHsk) throw httpError(400, `Wallet needs at least ${config.bots.minGasHsk} HSK for gas (has ${bal.hsk})`)
  db.db.prepare('DELETE FROM trades WHERE bot_id = ?').run(bot.id)
  db.db.prepare('DELETE FROM decisions WHERE bot_id = ?').run(bot.id)
  return db.updateBot(bot.id, {
    mode: 'live', status: 'running', halted_reason: null, start_usdt: budget, cash: budget, positions: {}, cost_basis: {}, highs: {},
    gas_usd: 0, peak_equity: budget, equity_usd: budget, pnl_pct: 0, trades: 0, day: null, day_start_equity: null,
  })
}

/** Sell every position of a bot and stop it. */
export async function closeBot(bot) {
  db.updateBot(bot.id, { status: 'stopped' })
  const results = []
  for (const [id, qty] of Object.entries(bot.positions)) {
    try {
      results.push(await fill(db.getBot(bot.id), findAsset(id), 'sell', qty, { ...paramsFor(bot), maxImpactPct: 100 }, 'close'))
    } catch (err) {
      results.push({ asset: id, error: err.message })
    }
  }
  await markBot(db.getBot(bot.id))
  return results
}

/** Send HSK or a token from the user's custodial wallet to `to`. */
export async function withdraw(user, assetId, amount, to) {
  const wallet = db.getWallet(user.id)
  if (!wallet) throw httpError(400, 'No wallet')
  if (!/^0x[0-9a-fA-F]{40}$/.test(to)) throw httpError(400, 'Invalid destination address')
  const asset = findAsset(assetId)
  if (!asset) throw httpError(400, `Unknown asset ${assetId}`)
  const account = unlock(wallet)
  const walletClient = createWalletClient({ account, chain: hashkey, transport: http() })
  const raw = parseUnits(String(amount), ONCHAIN_DECIMALS(asset))
  const hash = same(asset.address, NATIVE)
    ? await walletClient.sendTransaction({ to, value: raw })
    : await walletClient.writeContract({ address: asset.address, abi: erc20Abi, functionName: 'transfer', args: [to, raw] })
  const receipt = await client.waitForTransactionReceipt({ hash })
  return { hash, status: receipt.status }
}

// --- fills ---------------------------------------------------------------------

async function hskUsd() {
  return (await getPrice(findAsset('hsk'))).priceUsd ?? 0
}

async function fill(bot, asset, side, amountIn, params, reason) {
  const usdt = findAsset('usdt')
  const [quote, price] = await Promise.all([quoteOrder(asset, usdt, side, amountIn), getPrice(asset)])
  if (!quote || !(quote.amountOut > 0)) throw new Error(`No route with liquidity for ${asset.symbol}`)
  const quotedExec = side === 'buy' ? quote.amountIn / quote.amountOut : quote.amountOut / quote.amountIn
  const impactPct = (side === 'buy' ? quotedExec / price.priceUsd - 1 : 1 - quotedExec / price.priceUsd) * 100
  if (impactPct > params.maxImpactPct) throw new Error(`Price impact ${impactPct.toFixed(2)}% exceeds ${params.maxImpactPct}%`)

  let spent = quote.amountIn
  let received = quote.amountOut
  let gasUsd = 0
  let txHash = null
  if (bot.mode === 'live') {
    if (asset.reference?.fills) throw new Error(`${asset.symbol} cannot be traded live`)
    const wallet = db.getWallet(bot.user_id)
    const [from, to] = side === 'buy' ? [usdt, asset] : [asset, usdt]
    const bal = await walletBalances(wallet.address)
    if (bal.hsk < config.bots.minGasHsk) throw new Error(`Wallet HSK ${bal.hsk} is below the gas minimum ${config.bots.minGasHsk}`)
    const have = Number(formatUnits(await balanceOf(from.address, wallet.address), ONCHAIN_DECIMALS(from)))
    // Keep gas money when selling native HSK.
    const usable = same(from.address, NATIVE) ? have - config.bots.minGasHsk : have
    const amount = Math.min(amountIn, usable)
    if (!(amount > 0)) throw new Error(`Wallet has no ${from.symbol} to sell`)
    const result = await executeSwap({
      account: unlock(wallet),
      from: from.address,
      to: to.address,
      amountIn: parseUnits(amount.toFixed(ONCHAIN_DECIMALS(from)), ONCHAIN_DECIMALS(from)),
      slippageBps: BigInt(Math.round(params.slippagePct * 100)),
    })
    spent = Number(formatUnits(result.amountIn, ONCHAIN_DECIMALS(from)))
    received = Number(formatUnits(result.amountOut, ONCHAIN_DECIMALS(to)))
    gasUsd = Number(formatUnits(result.gasWei, 18)) * (await hskUsd())
    txHash = result.hash
  }

  bot = db.getBot(bot.id)
  const positions = { ...bot.positions }
  const costBasis = { ...bot.cost_basis }
  const highs = { ...bot.highs }
  let cash = bot.cash
  let realizedPnlUsd
  if (side === 'buy') {
    cash -= spent
    positions[asset.id] = (positions[asset.id] ?? 0) + received
    costBasis[asset.id] = (costBasis[asset.id] ?? 0) + spent
    highs[asset.id] = Math.max(highs[asset.id] ?? 0, price.priceUsd)
  } else {
    const held = positions[asset.id]
    const costSold = (costBasis[asset.id] ?? 0) * Math.min(1, spent / held)
    realizedPnlUsd = received - costSold
    cash += received
    positions[asset.id] = held - spent
    costBasis[asset.id] = (costBasis[asset.id] ?? 0) - costSold
    if (positions[asset.id] <= held * 1e-9) {
      delete positions[asset.id]
      delete costBasis[asset.id]
      delete highs[asset.id]
    }
  }
  db.updateBot(bot.id, { cash, positions, cost_basis: costBasis, highs, gas_usd: bot.gas_usd + gasUsd })

  const trade = {
    time: new Date().toISOString(),
    asset: asset.id,
    side,
    quantity: side === 'buy' ? received : spent,
    usdt: side === 'buy' ? spent : received,
    execPrice: side === 'buy' ? spent / received : received / spent,
    midPrice: price.priceUsd,
    impactPct,
    realizedPnlUsd,
    gasUsd,
    txHash,
    reason,
  }
  db.addTrade(bot.id, trade)
  events.emit('trade', { bot: db.getBot(bot.id), trade })
  return trade
}

// --- marking & risk --------------------------------------------------------------

async function exitValue(asset, quantity) {
  if (asset.reference?.fills) {
    const price = await getPrice(asset)
    return price.priceUsd == null ? 0 : quantity * price.priceUsd * (1 - config.referenceCostPct / 100)
  }
  const quote = await quoteOrder(asset, findAsset('usdt'), 'sell', quantity).catch(() => null)
  return quote?.amountOut ?? 0
}

/** Equity = cash + what positions would sell for now - gas spent. */
export async function markBot(bot) {
  const values = await Promise.all(Object.entries(bot.positions).map(([id, q]) => exitValue(findAsset(id), q)))
  const equity = bot.cash + values.reduce((s, v) => s + v, 0) - bot.gas_usd
  const patch = { equity_usd: equity, pnl_pct: (equity / bot.start_usdt - 1) * 100, peak_equity: Math.max(bot.peak_equity ?? equity, equity) }
  const day = new Date().toISOString().slice(0, 10)
  if (bot.day !== day) Object.assign(patch, { day, day_start_equity: equity })
  const params = paramsFor(bot)
  let halt = null
  if (params.maxDrawdownPct > 0 && equity < patch.peak_equity * (1 - params.maxDrawdownPct / 100)) {
    halt = `drawdown over ${params.maxDrawdownPct}% from peak ${patch.peak_equity.toFixed(2)}`
  }
  const dayStart = patch.day_start_equity ?? bot.day_start_equity
  if (bot.mode === 'live' && dayStart && equity < dayStart * (1 - config.bots.liveDailyLossPct / 100)) {
    halt = `daily loss over ${config.bots.liveDailyLossPct}%`
  }
  if (halt && bot.status === 'running') Object.assign(patch, { status: 'halted', halted_reason: halt })
  const updated = db.updateBot(bot.id, patch)
  if (halt && bot.status === 'running') events.emit('halt', { bot: updated, reason: halt })
  return updated
}

export function riskExit(bot, asset, price, params) {
  const qty = bot.positions[asset.id]
  if (!qty) return null
  const avg = (bot.cost_basis[asset.id] ?? 0) / qty
  const p = price.priceUsd
  const changePct = (p / avg - 1) * 100
  const high = Math.max(bot.highs[asset.id] ?? p, p)
  if (params.stopLossPct > 0 && changePct <= -params.stopLossPct) return { side: 'sell', fraction: 1, reason: `stop loss: ${changePct.toFixed(2)}% from entry` }
  if (params.takeProfitPct > 0 && changePct >= params.takeProfitPct) return { side: 'sell', fraction: 1, reason: `take profit: +${changePct.toFixed(2)}% from entry` }
  if (params.trailingStopPct > 0 && p <= high * (1 - params.trailingStopPct / 100)) {
    return { side: 'sell', fraction: 1, reason: `trailing stop: ${(((p / high) - 1) * 100).toFixed(2)}% from high ${high}` }
  }
  return null
}

// --- scheduler -------------------------------------------------------------------

async function tickBot(bot) {
  const strategy = strategies.get(bot.strategy)
  const params = paramsFor(bot)
  for (const id of bot.assets) {
    bot = db.getBot(bot.id)
    if (bot.status !== 'running') return
    const asset = findAsset(id)
    const decision = { time: new Date().toISOString(), asset: id }
    try {
      const [price, { candles }] = await Promise.all([getPrice(asset), getCandles(asset, bot.timeframe, 200)])
      if (price.priceUsd == null) throw new Error(`No price for ${asset.symbol}`)
      const position = bot.positions[id] ?? 0
      if (position > 0 && price.priceUsd > (bot.highs[id] ?? 0)) db.updateBot(bot.id, { highs: { ...bot.highs, [id]: price.priceUsd } })
      const out =
        riskExit(bot, asset, price, params) ??
        (await strategy.decide({
          asset, price, candles, position, params,
          ta: analyze(candles),
          costBasisUsd: bot.cost_basis[id] ?? 0,
          cashUsdt: bot.cash,
          key: `${bot.id}:${id}`,
          timeframe: bot.timeframe,
        }))
      decision.reason = out?.reason
      if (out?.side === 'buy') {
        const room = params.maxPositionUsd - position * price.priceUsd
        const usdt = Math.min(out.usdt ?? params.tradeUsd, params.tradeUsd, room, bot.cash)
        decision.action = usdt >= 1 ? `buy $${usdt.toFixed(2)}` : 'buy skipped (no room or cash)'
        if (usdt >= 1) await fill(bot, asset, 'buy', usdt, params, out.reason)
      } else if (out?.side === 'sell' && position > 0) {
        const qty = position * Math.min(Math.max(out.fraction ?? 1, 0), 1)
        decision.action = `sell ${qty}`
        await fill(bot, asset, 'sell', qty, params, out.reason)
      }
    } catch (err) {
      decision.error = err.message
    }
    db.addDecision(bot.id, decision)
  }
  await markBot(db.getBot(bot.id))
}

const lastRun = new Map()
const busy = new Set()

async function loop() {
  for (const bot of db.runningBots()) {
    if (busy.has(bot.id) || Date.now() - (lastRun.get(bot.id) ?? 0) < bot.interval_sec * 1000) continue
    busy.add(bot.id)
    lastRun.set(bot.id, Date.now())
    tickBot(bot)
      .catch((err) => console.error(`bot #${bot.id}: ${err.stack ?? err}`))
      .finally(() => busy.delete(bot.id))
  }
}

export async function startEngine() {
  await loadStrategies()
  const missing = [...strategies.values()].flatMap((s) => s.requires).filter((n) => !enabledPlugins().some((p) => p.name === n))
  if (missing.length) throw new Error(`Strategies need TA indicators: ${[...new Set(missing)].join(', ')}`)
  setInterval(loop, 10_000)
  loop()
  console.log(`engine: ${strategies.size} strategies, ${db.runningBots().length} running bots`)
}
