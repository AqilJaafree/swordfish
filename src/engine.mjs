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
import { closes, sma } from './ta/math.mjs'
import { analyze, enabledPlugins } from './ta/index.mjs'
import { liquidityFor, lpPool, mintRange, planRange, poolState, priceToTick, rangeAction, rangeAmounts, rangeValue, withdrawRange } from './lp.mjs'
import { balanceOf, executeSwap, same } from './v3.mjs'
import { importWallet as walletFromKey, unlock } from './vault.mjs'

export const events = new EventEmitter()
const httpError = (status, message) => Object.assign(new Error(message), { status })

// One operation per bot at a time: a tick, /close, /live and delete never interleave.
const locks = new Map()
async function withBot(id, fn) {
  while (locks.has(id)) await locks.get(id).catch(() => {})
  const p = fn()
  locks.set(id, p)
  try {
    return await p
  } finally {
    if (locks.get(id) === p) locks.delete(id)
  }
}

// --- strategies ----------------------------------------------------------------

const BUILTIN = ['sma-cross', 'macd-trend', 'bollinger-reversion', 'breakout', 'rsi-reversion', 'claude', 'lp-range']
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
    lp: !!s.lp,
  }))

const paramsFor = (bot) => {
  const p = { ...RISK_DEFAULTS, ...strategies.get(bot.strategy)?.defaults, ...bot.params }
  if (bot.mode === 'live') {
    p.tradeUsd = Math.min(p.tradeUsd, config.bots.liveMaxTradeUsd)
    p.maxImpactPct = Math.min(p.maxImpactPct, config.bots.liveMaxImpactPct)
  }
  return p
}

function cleanParams(s, params) {
  const clean = {}
  for (const [k, v] of Object.entries(params ?? {})) {
    if (!(k in RISK_DEFAULTS) && !(k in s.defaults)) throw httpError(400, `Unknown param ${k}`)
    clean[k] = typeof s.defaults[k] === 'string' ? String(v) : Number(v)
    if (typeof clean[k] === 'number' && !Number.isFinite(clean[k])) throw httpError(400, `Param ${k} must be a number`)
  }
  return clean
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
  if (s.lp) {
    if (ids.length !== 1) throw httpError(400, `${strategy} runs on exactly one asset, e.g. btc`)
    const asset = findAsset(ids[0])
    if (asset.category !== 'crypto' || same(asset.address, NATIVE)) throw httpError(400, `${strategy} needs an ERC-20 coin with a USDT pool, e.g. btc or eth (for HSK use whsk)`)
  }
  const mine = db.userBots(user.id)
  if (mine.length >= config.bots.maxPerUser) throw httpError(400, `Bot limit reached (${config.bots.maxPerUser})`)
  if (strategy === 'claude' && mine.filter((b) => b.strategy === 'claude').length >= config.bots.maxClaudePerUser) {
    throw httpError(400, `Claude bot limit reached (${config.bots.maxClaudePerUser})`)
  }
  const clean = cleanParams(s, params)
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
export const goLive = (user, bot, budgetUsdt) => withBot(bot.id, () => goLiveNow(user, db.getBot(bot.id), budgetUsdt))

async function goLiveNow(user, bot, budgetUsdt) {
  if (bot.mode === 'live' && holdsAssets(bot)) throw httpError(400, `Bot #${bot.id} is live and holds positions or liquidity; /close ${bot.id} first`)
  const wallet = db.getWallet(user.id)
  if (!wallet) throw httpError(400, 'No wallet; use /start in Telegram')
  const budget = Number(budgetUsdt)
  if (!(budget >= 1 && budget <= config.bots.liveMaxBudgetUsd)) throw httpError(400, `Budget must be 1-${config.bots.liveMaxBudgetUsd} USDT`)
  const offchain = bot.assets.map(findAsset).filter((a) => a.reference?.fills)
  if (offchain.length) throw httpError(400, `${offchain.map((a) => a.symbol).join(', ')} has no on-chain liquidity; live bots need pool assets`)
  const bal = await walletBalances(wallet.address)
  const committed = committedFunds(user.id, bot.id).usdt ?? 0
  if (bal.usdt < budget + committed) throw httpError(400, `Wallet has ${bal.usdt} USDT; needs ${budget + committed} (incl. ${committed} for other live bots)`)
  if (bal.hsk < config.bots.minGasHsk) throw httpError(400, `Wallet needs at least ${config.bots.minGasHsk} HSK for gas (has ${bal.hsk})`)
  db.db.prepare('DELETE FROM trades WHERE bot_id = ?').run(bot.id)
  db.db.prepare('DELETE FROM decisions WHERE bot_id = ?').run(bot.id)
  return db.updateBot(bot.id, {
    mode: 'live', status: 'running', halted_reason: null, start_usdt: budget, cash: budget, positions: {}, cost_basis: {}, highs: {}, lp: null,
    gas_usd: 0, peak_equity: budget, equity_usd: budget, pnl_pct: 0, trades: 0, day: null, day_start_equity: null,
  })
}

/** Sell every position of a bot (withdrawing any liquidity first) and stop it. */
export const closeBot = (bot) => withBot(bot.id, () => closeBotNow(db.getBot(bot.id)))

async function closeBotNow(bot) {
  db.updateBot(bot.id, { status: 'stopped' })
  const results = []
  if (bot.lp?.range) {
    try {
      const asset = findAsset(bot.assets[0])
      const pool = await lpPool(asset)
      const trade = await exitRange(bot, asset, pool, (await poolState(pool)).price, 'close')
      if (trade) results.push(trade)
    } catch (err) {
      results.push({ asset: bot.assets[0], error: `LP withdraw: ${err.message}` })
    }
    bot = db.getBot(bot.id)
  }
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

const WALLET_ASSETS = ['usdt', 'wbtc', 'weth', 'hsk'] // tokens first: HSK pays their gas
const isLive = (b) => b.mode === 'live'
const holdsAssets = (b) => Object.keys(b.positions).length > 0 || !!b.lp?.range

/**
 * Amounts per asset that running or halted live bots are trading with (except
 * bot `exceptId`), plus the HSK they need for gas.
 */
function committedFunds(userId, exceptId = null) {
  const out = {}
  for (const b of db.userBots(userId).filter((b) => isLive(b) && b.status !== 'stopped' && b.id !== exceptId)) {
    out.usdt = (out.usdt ?? 0) + b.cash
    for (const [id, q] of Object.entries(b.positions)) out[id] = (out[id] ?? 0) + q
    out.hsk = Math.max(out.hsk ?? 0, config.bots.minGasHsk)
  }
  return out
}

/**
 * Send HSK or a token from the user's custodial wallet to `to`. amount 'max'
 * sends what is not committed to running live bots (minus gas for HSK).
 */
export async function withdraw(user, assetId, amount, to) {
  const wallet = db.getWallet(user.id)
  if (!wallet) throw httpError(400, 'No wallet')
  if (!/^0x[0-9a-fA-F]{40}$/.test(to)) throw httpError(400, 'Invalid destination address')
  if (same(to, wallet.address)) throw httpError(400, 'That is the bot wallet itself')
  const asset = findAsset(assetId)
  if (!asset || !WALLET_ASSETS.includes(asset.id)) throw httpError(400, `Withdraw one of: ${WALLET_ASSETS.join(', ')}`)
  const decimals = ONCHAIN_DECIMALS(asset)
  const native = same(asset.address, NATIVE)
  const balanceRaw = await balanceOf(asset.address, wallet.address)
  const committed = committedFunds(user.id)[asset.id] ?? 0
  const account = unlock(wallet)
  const walletClient = createWalletClient({ account, chain: hashkey, transport: http() })
  // Native transfers need gas from the same balance: reserve twice a 21k-gas transfer.
  const gasReserve = native ? 2n * 21_000n * (await client.getGasPrice()) : 0n
  const freeRaw = balanceRaw - gasReserve - parseUnits(committed.toFixed(decimals), decimals)
  const reason = native && committed ? `${committed} kept for live bots' gas` : `${committed} is used by running live bots; /close them first`
  const raw = String(amount).toLowerCase() === 'max' ? freeRaw : parseUnits(String(amount), decimals)
  if (!(raw > 0n)) throw httpError(400, `Nothing to withdraw: ${formatUnits(balanceRaw, decimals)} ${asset.symbol} in the wallet${committed ? ` (${reason})` : ''}`)
  if (raw > freeRaw) {
    throw httpError(400, `Only ${formatUnits(freeRaw > 0n ? freeRaw : 0n, decimals)} ${asset.symbol} is free${committed ? ` (${reason})` : ''}`)
  }
  const hash = native
    ? await walletClient.sendTransaction({ to, value: raw })
    : await walletClient.writeContract({ address: asset.address, abi: erc20Abi, functionName: 'transfer', args: [to, raw] })
  const receipt = await client.waitForTransactionReceipt({ hash })
  return { hash, status: receipt.status, asset: asset.id, amount: Number(formatUnits(raw, decimals)) }
}

/** Withdraw every free balance (tokens, then HSK) to `to`. */
export async function withdrawAll(user, to) {
  const wallet = db.getWallet(user.id)
  if (!wallet) throw httpError(400, 'No wallet')
  const bal = await walletBalances(wallet.address)
  const results = []
  for (const id of WALLET_ASSETS) {
    if (!(bal[id] > 0)) continue
    try {
      results.push(await withdraw(user, id, 'max', to))
    } catch (err) {
      results.push({ asset: id, error: err.message })
    }
  }
  return results
}

/**
 * Replace the user's custodial wallet with one from their own private key. The
 * current wallet must be safe to drop (same rules as deleteWallet).
 */
export async function importWallet(user, privateKey) {
  const imported = walletFromKey(privateKey)
  const owner = db.walletOwner(imported.address)
  if (owner === user.id) throw httpError(400, `${imported.address} is already your bot wallet`)
  if (owner != null) throw httpError(400, 'That wallet is already linked to another account')
  if (db.getWallet(user.id)) await deleteWallet(user)
  db.saveWallet(user.id, imported)
  return { address: imported.address, balances: await walletBalances(imported.address) }
}

/** Delete a bot and its history. Live bots must not hold positions or liquidity. */
export const deleteBot = (bot) =>
  withBot(bot.id, async () => {
    const fresh = db.getBot(bot.id)
    if (!fresh) return
    if (isLive(fresh) && holdsAssets(fresh)) throw httpError(400, `Live bot #${bot.id} still holds positions or liquidity; /close ${bot.id} first`)
    db.deleteBot(bot.id)
  })

/**
 * Forget the user's custodial wallet. Refused while live bots exist or while it
 * holds funds, unless `abandonFunds` (funds then stay reachable only with an
 * exported key).
 */
export async function deleteWallet(user, { abandonFunds = false } = {}) {
  const wallet = db.getWallet(user.id)
  if (!wallet) throw httpError(400, 'No wallet')
  const live = db.userBots(user.id).filter(isLive)
  if (live.length) throw httpError(400, `Delete your live bots first: ${live.map((b) => (holdsAssets(b) ? `/close ${b.id} then /deletebot ${b.id}` : `/deletebot ${b.id}`)).join('; ')}`)
  const bal = await walletBalances(wallet.address)
  // Dust left after a full withdrawal (HSK gas change) does not count.
  const left = Object.entries(bal).filter(([id, v]) => v > (id === 'hsk' ? 0.001 : id === 'usdt' ? 0.01 : 0.000001))
  if (left.length && !abandonFunds) {
    const err = httpError(400, `Wallet still holds ${left.map(([id, v]) => `${v} ${id.toUpperCase()}`).join(', ')}`)
    err.balances = bal
    throw err
  }
  db.deleteWallet(user.id)
  return { address: wallet.address, abandoned: left }
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

// --- one-sided liquidity (lp-range) -------------------------------------------------
//
// bot.lp = { feesUsd, fills, range } where range is the open position:
// { side: 'usdt' | 'asset', tickLower, tickUpper, lower, upper, depositUsdt,
//   depositAsset, costBasis, placedAt, L, lastUsdt, accruedUsd (paper),
//   tokenId, liquidity, markUsd (live) }.

const LP_FEE_PCT = 0.3
const LP_MIN_USD = 0.1 // smallest deposit worth a range; less is left as cash or dust
const fmt = (n) => Number(n).toPrecision(6)
const lpOf = (bot) => bot.lp ?? { feesUsd: 0, fills: 0, range: null }
const rawUnits = (n, decimals) => parseUnits(Math.max(0, n).toFixed(decimals), decimals)

/** Value of the open range now (USDT), including uncollected fees. */
async function lpMark(bot) {
  const r = bot.lp.range
  const asset = findAsset(bot.assets[0])
  const pool = await lpPool(asset)
  let coin
  let usdt
  if (bot.mode === 'live') {
    const v = await rangeValue({ owner: db.getWallet(bot.user_id).address, tokenId: BigInt(r.tokenId), liquidity: BigInt(r.liquidity) })
    coin = Number(formatUnits(v.amount0, pool.dec0))
    usdt = Number(formatUnits(v.amount1, pool.dec1))
  } else {
    const { price } = await poolState(pool)
    ;({ asset: coin, usdt } = rangeAmounts(r.L, price, r.lower, r.upper))
    usdt += r.accruedUsd
  }
  const markUsd = usdt + (coin > 0 ? await exitValue(asset, coin) : 0)
  // Only cache the mark if this range is still the open one.
  const fresh = db.getBot(bot.id)
  if (fresh.lp?.range?.placedAt === r.placedAt) db.updateBot(bot.id, { lp: { ...fresh.lp, range: { ...fresh.lp.range, markUsd } } })
  return markUsd
}

async function tickLp(bot, params) {
  const asset = findAsset(bot.assets[0])
  const pool = await lpPool(asset)
  const { price, tick } = await poolState(pool)
  let r = lpOf(bot).range

  if (r && bot.mode === 'paper') {
    // Paper fees: the pool fee on the USDT value that moved through our range since the last check.
    const now = rangeAmounts(r.L, price, r.lower, r.upper).usdt
    r = { ...r, accruedUsd: r.accruedUsd + Math.abs(now - r.lastUsdt) * (LP_FEE_PCT / 100), lastUsdt: now }
    db.updateBot(bot.id, { lp: { ...lpOf(bot), range: r } })
    bot = db.getBot(bot.id)
  }

  if (r) {
    const entry = r.side === 'asset' && r.depositAsset > 0 ? r.costBasis / r.depositAsset : null
    const stop = entry && params.stopLossPct > 0 && price <= entry * (1 - params.stopLossPct / 100)
    const action = stop ? 'stop' : rangeAction(r, price, params)
    if (!action) {
      const { asset: coin, usdt } = rangeAmounts(r.L ?? 1, price, r.lower, r.upper)
      const filled = r.side === 'usdt' ? coin * price / (coin * price + usdt) : usdt / (coin * price + usdt)
      return { reason: `${r.side === 'usdt' ? 'buy' : 'sell'} range ${fmt(r.lower)}-${fmt(r.upper)}, pool ${fmt(price)}: ${(filled * 100 || 0).toFixed(0)}% filled` }
    }
    const trade = await exitRange(bot, asset, pool, price, action === 'filled' ? 'LP range filled' : action === 'stop' ? `stop loss ${params.stopLossPct}% below entry ${fmt(entry)}` : 'recenter: price moved away')
    bot = db.getBot(bot.id)
    if (action === 'stop' && bot.positions[asset.id] > 0) {
      await fill(bot, asset, 'sell', bot.positions[asset.id], { ...params, maxImpactPct: 100 }, 'stop loss: sell coin left after LP withdraw')
      return { action: 'stop loss', reason: `withdrew range and sold at ${fmt(price)}` }
    }
    if (action === 'filled' && r.side === 'usdt' && !params.cycle) {
      return { action: 'filled, holding', reason: `bought ${fmt(trade?.quantity ?? 0)} ${asset.symbol}; cycle=0 so holding the coin` }
    }
    bot = db.getBot(bot.id)
    const next = await placeRange(bot, asset, pool, price, tick, params)
    return { action: `${action}${next ? ', re-placed' : ''}`, reason: next ?? `withdrew range at pool ${fmt(price)}` }
  }

  const placed = await placeRange(bot, asset, pool, price, tick, params)
  return placed ? { action: 'placed', reason: placed } : { reason: 'nothing to deposit' }
}

/** Deposit the bot's USDT below the price, or its coin above entry. Returns a description or null. */
async function placeRange(bot, asset, pool, price, tick, params) {
  const coin = bot.positions[asset.id] ?? 0
  const side = coin * price >= LP_MIN_USD && params.cycle ? 'asset' : bot.cash >= LP_MIN_USD ? 'usdt' : null
  if (!side) return null
  const costBasis = side === 'asset' ? bot.cost_basis[asset.id] ?? 0 : 0
  const plan = planRange(side, price, tick, params, pool, side === 'asset' ? costBasis / coin : 0)
  let depositUsdt = side === 'usdt' ? bot.cash : 0
  let depositAsset = side === 'asset' ? coin : 0
  const range = { side, ...plan, costBasis, placedAt: new Date().toISOString() }
  let gasUsd = 0
  let txHash = null

  if (bot.mode === 'live') {
    const wallet = db.getWallet(bot.user_id)
    const account = unlock(wallet)
    const bal = await walletBalances(wallet.address)
    if (bal.hsk < config.bots.minGasHsk) throw new Error(`Wallet HSK ${bal.hsk} is below the gas minimum ${config.bots.minGasHsk}`)
    const have = Number(formatUnits(await balanceOf(side === 'usdt' ? pool.token1 : pool.token0, wallet.address), side === 'usdt' ? pool.dec1 : pool.dec0))
    const amount = Math.min(side === 'usdt' ? depositUsdt : depositAsset, have)
    if (!(amount > 0)) throw new Error(`Wallet has no ${side === 'usdt' ? 'USDT' : asset.symbol} to deposit`)
    const m = await mintRange({
      account, pool, tickLower: plan.tickLower, tickUpper: plan.tickUpper,
      ...(side === 'usdt' ? { amount1: rawUnits(amount, pool.dec1) } : { amount0: rawUnits(amount, pool.dec0) }),
    })
    depositUsdt = Number(formatUnits(m.amount1, pool.dec1))
    depositAsset = Number(formatUnits(m.amount0, pool.dec0))
    Object.assign(range, { tokenId: String(m.tokenId), liquidity: String(m.liquidity), markUsd: depositUsdt + depositAsset * price })
    gasUsd = Number(formatUnits(m.gasWei, 18)) * (await hskUsd())
    txHash = m.hash
  } else {
    const L = liquidityFor(side, side === 'usdt' ? depositUsdt : depositAsset, plan.lower, plan.upper)
    Object.assign(range, { L, accruedUsd: 0, lastUsdt: rangeAmounts(L, price, plan.lower, plan.upper).usdt, markUsd: depositUsdt + depositAsset * price })
  }
  Object.assign(range, { depositUsdt, depositAsset, costBasis: side === 'asset' ? costBasis * (depositAsset / coin) : 0, txHash })

  const positions = { ...bot.positions }
  const costs = { ...bot.cost_basis }
  if (side === 'asset') {
    positions[asset.id] = coin - depositAsset
    costs[asset.id] = costBasis - range.costBasis
    if (positions[asset.id] <= coin * 1e-9) {
      delete positions[asset.id]
      delete costs[asset.id]
    }
  }
  db.updateBot(bot.id, {
    cash: bot.cash - depositUsdt, positions, cost_basis: costs, gas_usd: bot.gas_usd + gasUsd,
    lp: { ...lpOf(bot), range },
  })
  return side === 'usdt'
    ? `deposited ${depositUsdt.toFixed(2)} USDT in buy range ${fmt(plan.lower)}-${fmt(plan.upper)} (pool ${fmt(price)})`
    : `deposited ${fmt(depositAsset)} ${asset.symbol} in sell range ${fmt(plan.lower)}-${fmt(plan.upper)} (entry ${fmt(range.costBasis / depositAsset)})`
}

/** Withdraw the open range into the bot's book; records a trade for whatever converted. */
async function exitRange(bot, asset, pool, price, reason) {
  const r = bot.lp.range
  // Principal (what the range converted to) and fees, each in coin and USDT.
  let coin
  let usdt
  let feeCoin = 0
  let feeUsdt
  let gasUsd = 0
  let txHash = null
  if (bot.mode === 'live') {
    const w = await withdrawRange({ account: unlock(db.getWallet(bot.user_id)), tokenId: BigInt(r.tokenId), liquidity: BigInt(r.liquidity) })
    feeCoin = Number(formatUnits(w.fee0, pool.dec0))
    feeUsdt = Number(formatUnits(w.fee1, pool.dec1))
    coin = Number(formatUnits(w.amount0, pool.dec0)) - feeCoin
    usdt = Number(formatUnits(w.amount1, pool.dec1)) - feeUsdt
    gasUsd = Number(formatUnits(w.gasWei, 18)) * (await hskUsd())
    txHash = w.hash
  } else {
    ;({ asset: coin, usdt } = rangeAmounts(r.L, price, r.lower, r.upper))
    feeUsdt = r.accruedUsd
  }
  const feesUsd = feeUsdt + feeCoin * price

  // Converted part: coin bought with USDT (buy range) or USDT received for coin (sell range).
  const bought = r.side === 'usdt' ? coin : 0
  const spent = r.side === 'usdt' ? Math.max(0, r.depositUsdt - usdt) : 0
  const sold = r.side === 'asset' ? Math.max(0, r.depositAsset - coin) : 0
  const costSold = r.side === 'asset' && r.depositAsset > 0 ? r.costBasis * (sold / r.depositAsset) : 0
  const proceeds = r.side === 'asset' ? usdt : 0

  // Fees paid in coin join the position at zero cost.
  const positions = { ...bot.positions }
  const costs = { ...bot.cost_basis }
  if (coin + feeCoin > 0) {
    positions[asset.id] = (positions[asset.id] ?? 0) + coin + feeCoin
    costs[asset.id] = (costs[asset.id] ?? 0) + (r.side === 'usdt' ? spent : r.costBasis - costSold)
  }
  const lp = lpOf(bot)
  const converted = r.side === 'usdt' ? bought > 0 && spent > 0.0001 : sold > 0 && proceeds > 0.0001
  db.updateBot(bot.id, {
    cash: bot.cash + usdt + feeUsdt, positions, cost_basis: costs, gas_usd: bot.gas_usd + gasUsd,
    lp: { feesUsd: lp.feesUsd + feesUsd, fills: lp.fills + (converted ? 1 : 0), range: null },
  })
  if (!converted) return null

  const trade = {
    time: new Date().toISOString(),
    asset: asset.id,
    side: r.side === 'usdt' ? 'buy' : 'sell',
    quantity: r.side === 'usdt' ? bought : sold,
    usdt: r.side === 'usdt' ? spent : proceeds,
    execPrice: r.side === 'usdt' ? spent / bought : proceeds / sold,
    midPrice: price,
    impactPct: 0,
    realizedPnlUsd: r.side === 'asset' ? proceeds - costSold + feesUsd : undefined,
    gasUsd,
    txHash,
    reason: `${reason}: LP ${r.side === 'usdt' ? 'buy' : 'sell'} range ${fmt(r.lower)}-${fmt(r.upper)}, fees earned ${feesUsd.toFixed(4)} USDT`,
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
  const lpUsd = bot.lp?.range ? await lpMark(bot).catch(() => bot.lp.range.markUsd ?? 0) : 0
  const equity = bot.cash + values.reduce((s, v) => s + v, 0) + lpUsd - bot.gas_usd
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

/**
 * Price levels for a bot's chart: average entry and risk exits for an open
 * position, plus the strategy's next buy/sell triggers when it has fixed ones.
 */
export async function botLevels(bot, assetId) {
  const asset = findAsset(assetId)
  if (!asset || !bot.assets.includes(asset.id)) throw httpError(400, `Bot #${bot.id} does not trade ${assetId}`)
  const params = paramsFor(bot)
  const [price, { candles }] = await Promise.all([getPrice(asset), getCandles(asset, bot.timeframe, 200)])
  const qty = bot.positions[asset.id] ?? 0
  const levels = []
  const r = bot.lp?.range
  if (r) {
    const kind = r.side === 'usdt' ? 'buy' : 'sell'
    levels.push({ kind, label: `LP ${kind} range top`, price: r.upper }, { kind, label: `LP ${kind} range bottom`, price: r.lower })
    if (r.side === 'asset' && r.depositAsset > 0) levels.push({ kind: 'entry', label: 'Avg entry', price: r.costBasis / r.depositAsset })
  }
  if (qty > 0) {
    const entry = (bot.cost_basis[asset.id] ?? 0) / qty
    const high = Math.max(bot.highs[asset.id] ?? 0, price.priceUsd ?? 0)
    levels.push({ kind: 'entry', label: 'Avg entry', price: entry })
    if (params.stopLossPct > 0) levels.push({ kind: 'stop', label: `Stop loss -${params.stopLossPct}%`, price: entry * (1 - params.stopLossPct / 100) })
    if (params.takeProfitPct > 0) levels.push({ kind: 'target', label: `Take profit +${params.takeProfitPct}%`, price: entry * (1 + params.takeProfitPct / 100) })
    if (params.trailingStopPct > 0 && high) levels.push({ kind: 'trail', label: `Trailing stop -${params.trailingStopPct}%`, price: high * (1 - params.trailingStopPct / 100) })
  }
  const triggers = strategies.get(bot.strategy)?.levels?.({ candles, params, ta: analyze(candles) }) ?? []
  for (const t of triggers) if ((t.side === 'buy') === !qty && Number.isFinite(t.price)) levels.push({ kind: t.side, label: t.label, price: t.price })
  return { asset: asset.id, poolPrice: price.priceUsd, position: qty + (r?.depositAsset ?? 0), levels }
}

// --- strategy preview -----------------------------------------------------------

// What each strategy looks at: lines over the price and an optional lower pane.
const VIEWS = {
  'sma-cross': { lines: (w, ta, p) => ({ [`SMA ${p.fast}`]: sma(closes(w), p.fast).at(-1), [`SMA ${p.slow}`]: sma(closes(w), p.slow).at(-1) }) },
  'bollinger-reversion': { lines: (w, ta) => ({ Upper: ta.bbands?.upper, Middle: ta.bbands?.value, Lower: ta.bbands?.lower }) },
  breakout: {
    lines: (w, ta, p) => {
      const [buy, sell] = strategies.get('breakout').levels({ candles: w, params: p })
      return { [`${p.entry}-high`]: buy?.price, [`${p.exit}-low`]: sell?.price }
    },
  },
  'macd-trend': { pane: 'MACD', paneLines: (w, ta) => ({ MACD: ta.macd?.value, Signal: ta.macd?.signalLine }), histogram: (w, ta) => ta.macd?.histogram },
  'rsi-reversion': { pane: 'RSI', paneLines: (w, ta) => ({ RSI: ta.rsi?.value }), hlines: (p) => [{ label: `Buy ≤ ${p.buyBelow}`, price: p.buyBelow }, { label: `Sell ≥ ${p.sellAbove}`, price: p.sellAbove }] },
  claude: {
    lines: (w, ta) => ({ Upper: ta.bbands?.upper, Middle: ta.bbands?.value, Lower: ta.bbands?.lower }),
    pane: 'RSI', paneLines: (w, ta) => ({ RSI: ta.rsi?.value }), hlines: () => [{ label: '70', price: 70 }, { label: '30', price: 30 }],
  },
}
const PREVIEW_FEE_PCT = 0.3 // per swap; HashKey V3 pools charge 0.3%

/**
 * Replay a strategy over recent market candles: its indicator lines and the
 * buy/sell signals it would have produced, one position at a time, with exit
 * rules and pool fees applied. Claude is not replayed (one LLM call per candle).
 */
const previewCache = new Map() // key -> { at, promise }; replays are pure for a given candle set
const PREVIEW_TTL_MS = 60_000

export function previewStrategy(query) {
  const key = JSON.stringify(query)
  const hit = previewCache.get(key)
  if (hit && Date.now() - hit.at < PREVIEW_TTL_MS) return hit.promise
  for (const [k, v] of previewCache) if (Date.now() - v.at >= PREVIEW_TTL_MS) previewCache.delete(k)
  const promise = replayStrategy(query)
  promise.catch(() => previewCache.delete(key))
  previewCache.set(key, { at: Date.now(), promise })
  return promise
}

async function replayStrategy({ strategy, asset: assetId, timeframe = '1h', params = {} }) {
  const s = strategies.get(strategy)
  if (!s) throw httpError(400, `Unknown strategy ${strategy}`)
  if (!TIMEFRAMES[timeframe]) throw httpError(400, `timeframe must be one of ${Object.keys(TIMEFRAMES).join(', ')}`)
  const asset = findAsset(assetId)
  if (!asset || asset.id === 'usdt') throw httpError(400, `Unknown or untradable asset ${assetId}`)
  const p = { ...RISK_DEFAULTS, ...s.defaults, ...cleanParams(s, params) }
  const { candles, source } = await getCandles(asset, timeframe, 300)
  if (s.lp) return { strategy, asset: asset.id, symbol: asset.symbol, timeframe, source, params: p, candles, ...(await previewLp(asset, candles, p)) }
  const view = VIEWS[strategy] ?? {}
  const lines = {}
  const paneLines = {}
  const histogram = []
  const markers = []
  const replay = strategy !== 'claude'
  let qty = 0
  let entry = 0
  let high = 0
  let equity = 1 // per $1 of position, compounded across round trips
  const wins = []

  const push = (into, values, time) => {
    for (const [name, value] of Object.entries(values)) if (Number.isFinite(value)) (into[name] ??= []).push({ time, value })
  }
  for (let i = 1; i < candles.length; i++) {
    const w = candles.slice(0, i + 1)
    const bar = w.at(-1)
    const ta = analyze(w)
    if (view.lines) push(lines, view.lines(w, ta, p), bar.time)
    if (view.paneLines) push(paneLines, view.paneLines(w, ta, p), bar.time)
    const h = view.histogram?.(w, ta, p)
    if (Number.isFinite(h)) histogram.push({ time: bar.time, value: h })
    if (!replay) continue

    const price = { priceUsd: bar.close }
    high = qty ? Math.max(high, bar.close) : 0
    const sim = { positions: { [asset.id]: qty }, cost_basis: { [asset.id]: qty * entry }, highs: { [asset.id]: high } }
    const out = riskExit(sim, asset, price, p) ?? (await s.decide({ asset, price, candles: w, position: qty, params: p, ta, costBasisUsd: qty * entry, cashUsdt: p.tradeUsd }))
    if (out?.side === 'buy' && !qty) {
      qty = p.tradeUsd / bar.close
      entry = bar.close
      high = bar.close
      markers.push({ time: bar.time, side: 'buy', price: bar.close, reason: out.reason })
    } else if (out?.side === 'sell' && qty) {
      const ret = (bar.close / entry) * (1 - PREVIEW_FEE_PCT / 100) ** 2 - 1
      equity *= 1 + ret
      wins.push(ret > 0)
      markers.push({ time: bar.time, side: 'sell', price: bar.close, reason: out.reason, returnPct: ret * 100 })
      qty = 0
    }
  }

  const last = candles.at(-1)?.close
  const openPct = qty ? ((last / entry) * (1 - PREVIEW_FEE_PCT / 100) ** 2 - 1) * 100 : null
  const series = (obj) => Object.entries(obj).map(([name, data]) => ({ name, data }))
  const traded = candles.filter((c) => c.volume > 0).length
  const warnings = []
  if (asset.category === 'stock') warnings.push(`${asset.symbol} pools on HashKey hold almost no liquidity, so a bot cannot trade it on-chain yet.`)
  if (source === 'geckoterminal' && traded < candles.length * 0.2) {
    warnings.push(`Only ${traded} of ${candles.length} candles had pool trades; the rest repeat the last price, so the strategy has little to act on. Try a longer timeframe.`)
  }
  return {
    strategy, asset: asset.id, symbol: asset.symbol, timeframe, source, params: p, warnings,
    candles,
    lines: series(lines),
    pane: view.pane ? { title: view.pane, lines: series(paneLines), histogram, hlines: view.hlines?.(p) ?? [] } : null,
    markers,
    stats: replay
      ? {
          roundTrips: wins.length,
          winRatePct: wins.length ? (wins.filter(Boolean).length / wins.length) * 100 : null,
          returnPct: ((equity * (1 + (openPct ?? 0) / 100)) - 1) * 100,
          openPct,
          buyHoldPct: candles.length ? (last / candles[0].close - 1) * 100 : null,
          feePct: PREVIEW_FEE_PCT,
        }
      : null,
  }
}

/** lp-range replay on candle closes, with the same range rules as live bots. */
async function previewLp(asset, candles, p) {
  const pool = await lpPool(asset)
  const fee = LP_FEE_PCT / 100
  const tiny = 1e-6
  let cash = 1 // per $1 deposited
  let coin = 0
  let cost = 0
  let fees = 0
  let range = null
  const top = []
  const bottom = []
  const markers = []
  const wins = []

  const place = (price) => {
    const side = coin * price > tiny && p.cycle ? 'asset' : cash > tiny ? 'usdt' : null
    if (!side) return
    const plan = planRange(side, price, priceToTick(price, pool), p, pool, side === 'asset' ? cost / coin : 0)
    const amount = side === 'usdt' ? cash : coin
    const L = liquidityFor(side, amount, plan.lower, plan.upper)
    range = { side, ...plan, L, deposit: amount, cost: side === 'asset' ? cost : 0, last: rangeAmounts(L, price, plan.lower, plan.upper).usdt }
    if (side === 'usdt') {
      cash = 0
    } else {
      coin = 0
      cost = 0
    }
  }
  const withdraw = (price, time) => {
    const a = rangeAmounts(range.L, price, range.lower, range.upper)
    if (range.side === 'usdt') {
      const spent = range.deposit - a.usdt
      if (a.asset > tiny) markers.push({ time, side: 'buy', price: spent / a.asset, reason: 'LP buy range filled' })
      coin += a.asset
      cost += spent
      cash += a.usdt
    } else {
      const sold = range.deposit - a.asset
      const costSold = range.cost * (sold / range.deposit)
      if (sold > tiny) {
        const ret = (a.usdt + range.fees) / costSold - 1
        wins.push(ret > 0)
        markers.push({ time, side: 'sell', price: a.usdt / sold, reason: 'LP sell range filled', returnPct: ret * 100 })
      }
      cash += a.usdt
      coin += a.asset
      cost += range.cost - costSold
    }
    cash += range.fees ?? 0
    range = null
  }

  for (const bar of candles) {
    const price = bar.close
    if (range) {
      const now = rangeAmounts(range.L, price, range.lower, range.upper).usdt
      const earned = Math.abs(now - range.last) * fee
      range.fees = (range.fees ?? 0) + earned
      fees += earned
      range.last = now
      const entry = range.side === 'asset' ? range.cost / range.deposit : null
      const stop = entry && p.stopLossPct > 0 && price <= entry * (1 - p.stopLossPct / 100)
      const action = stop ? 'stop' : rangeAction(range, price, p)
      if (action) {
        const wasUsdt = range.side === 'usdt'
        withdraw(price, bar.time)
        if (stop && coin > 0) {
          const got = coin * price * (1 - fee)
          wins.push(got > cost)
          markers.push({ time: bar.time, side: 'sell', price, reason: 'stop loss', returnPct: (got / cost - 1) * 100 })
          cash += got
          coin = 0
          cost = 0
        }
        if (action === 'filled' && wasUsdt && !p.cycle) continue
      }
    }
    if (!range) place(price)
    if (range) {
      top.push({ time: bar.time, value: range.upper })
      bottom.push({ time: bar.time, value: range.lower })
    }
  }

  const last = candles.at(-1)?.close
  const open = range ? rangeAmounts(range.L, last, range.lower, range.upper) : { asset: 0, usdt: 0 }
  const equity = cash + (coin + open.asset) * last + open.usdt + (range?.fees ?? 0)
  return {
    lines: [{ name: 'LP range top', data: top }, { name: 'LP range bottom', data: bottom }],
    pane: null,
    markers,
    stats: {
      roundTrips: wins.length,
      winRatePct: wins.length ? (wins.filter(Boolean).length / wins.length) * 100 : null,
      returnPct: (equity - 1) * 100,
      openPct: null,
      buyHoldPct: candles.length ? (last / candles[0].close - 1) * 100 : null,
      feePct: LP_FEE_PCT,
      feesEarnedPct: fees * 100,
      lp: true,
    },
    warnings: [],
  }
}

// --- scheduler -------------------------------------------------------------------

async function tickBot(bot) {
  bot = db.getBot(bot.id)
  if (bot?.status !== 'running') return
  const strategy = strategies.get(bot.strategy)
  const params = paramsFor(bot)
  if (strategy.lp) {
    const decision = { time: new Date().toISOString(), asset: bot.assets[0] }
    try {
      Object.assign(decision, await tickLp(bot, params))
    } catch (err) {
      decision.error = err.message
    }
    db.addDecision(bot.id, decision)
    return void (await markBot(db.getBot(bot.id)))
  }
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

async function loop() {
  for (const bot of db.runningBots()) {
    if (locks.has(bot.id) || Date.now() - (lastRun.get(bot.id) ?? 0) < bot.interval_sec * 1000) continue
    lastRun.set(bot.id, Date.now())
    withBot(bot.id, () => tickBot(bot)).catch((err) => console.error(`bot #${bot.id}: ${err.stack ?? err}`))
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
