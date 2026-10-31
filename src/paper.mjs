// Paper trading against live on-chain quotes.
//
// The account holds USDT cash and asset positions. Orders are filled at the
// amount the real pools would return right now (see execution.mjs), so fees
// and price impact are included. State is saved to PAPER_STATE_FILE.
//
// Optional auto-trading: PAPER_STRATEGY names a strategy plugin. A strategy
// module default-exports:
//   {
//     name: 'rsi-reversion',
//     requires: ['rsi'],                       // TA indicators it reads
//     stats?() -> object merged into GET /paper/portfolio's strategy field
//     decide({ asset, price, ta, candles, position, costBasisUsd, cashUsdt, params }) ->
//       { side: 'buy', usdt } | { side: 'sell', fraction } | null, plus optional `reason`
//   }
// Strategy params come from env as PAPER_STRATEGY_<PARAM>.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { findAsset } from './assets.mjs'
import { getCandles } from './candles.mjs'
import { config, envParamsFor } from './config.mjs'
import { quoteOrder } from './execution.mjs'
import { getPrice } from './pricing.mjs'
import { analyze, enabledPlugins } from './ta/index.mjs'

const httpError = (status, message) => Object.assign(new Error(message), { status })
const USDT = () => findAsset('usdt')
const MAX_LOG = 500

// --- state ----------------------------------------------------------------

const freshState = () => ({
  startedAt: new Date().toISOString(),
  startUsdt: config.paper.startUsdt,
  cashUsdt: config.paper.startUsdt,
  positions: {}, // asset id -> quantity
  costBasis: {}, // asset id -> USDT paid for the quantity still held
  trades: [],
  decisions: [],
})

let state = null

function load() {
  try {
    state = JSON.parse(readFileSync(config.paper.stateFile, 'utf8'))
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`paper: could not read ${config.paper.stateFile}: ${err.message}; starting fresh`)
    state = freshState()
    save()
  }
}

function save() {
  mkdirSync(dirname(config.paper.stateFile), { recursive: true })
  const tmp = `${config.paper.stateFile}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 2))
  renameSync(tmp, config.paper.stateFile)
}

const pushCapped = (list, item) => {
  list.push(item)
  if (list.length > MAX_LOG) list.splice(0, list.length - MAX_LOG)
}

// --- orders ---------------------------------------------------------------

// Serialize fills so concurrent orders can't spend the same cash twice.
let queue = Promise.resolve()
const serial = (fn) => (queue = queue.then(fn, fn))

/**
 * side 'buy':  spend `usdt` USDT on the asset
 * side 'sell': sell `quantity` units, or `fraction` (0-1] of the position
 */
export function placeOrder(order, source = 'manual') {
  return serial(() => fill(order, source))
}

async function fill({ asset: id, side, usdt, quantity, fraction, maxImpactPct = config.paper.maxImpactPct }, source) {
  const asset = findAsset(String(id ?? ''))
  if (!asset) throw httpError(400, `Unknown asset ${id}`)
  if (asset.id === 'usdt') throw httpError(400, 'USDT is the cash asset; trade other assets against it')

  let amountIn
  if (side === 'buy') {
    amountIn = Number(usdt)
    if (!(amountIn > 0)) throw httpError(400, 'buy needs a positive "usdt" amount')
    if (amountIn > state.cashUsdt + 1e-9) throw httpError(400, `Not enough cash: have ${state.cashUsdt} USDT`)
  } else if (side === 'sell') {
    const held = state.positions[asset.id] ?? 0
    amountIn = fraction !== undefined ? held * Number(fraction) : Number(quantity)
    if (!(amountIn > 0)) throw httpError(400, 'sell needs a positive "quantity" or "fraction"')
    if (amountIn > held * (1 + 1e-9)) throw httpError(400, `Not enough ${asset.symbol}: have ${held}`)
    amountIn = Math.min(amountIn, held)
  } else {
    throw httpError(400, 'side must be "buy" or "sell"')
  }

  const [quote, price] = await Promise.all([quoteOrder(asset, USDT(), side, amountIn), getPrice(asset)])
  if (!quote || !(quote.amountOut > 0)) throw httpError(422, `No route with liquidity for ${asset.symbol}`)
  if (price.priceUsd == null) throw httpError(422, `No mid price for ${asset.symbol}`)

  // Execution price in USD per unit, vs the pool mid price.
  const execPrice = side === 'buy' ? quote.amountIn / quote.amountOut : quote.amountOut / quote.amountIn
  const impactPct = (side === 'buy' ? execPrice / price.priceUsd - 1 : 1 - execPrice / price.priceUsd) * 100
  if (impactPct > maxImpactPct) {
    throw httpError(422, `Price impact ${impactPct.toFixed(2)}% exceeds limit ${maxImpactPct}% (try a smaller size)`)
  }

  let realizedPnlUsd
  if (side === 'buy') {
    state.cashUsdt -= quote.amountIn
    state.positions[asset.id] = (state.positions[asset.id] ?? 0) + quote.amountOut
    state.costBasis[asset.id] = (state.costBasis[asset.id] ?? 0) + quote.amountIn
  } else {
    const held = state.positions[asset.id]
    const costSold = (state.costBasis[asset.id] ?? 0) * (quote.amountIn / held)
    realizedPnlUsd = quote.amountOut - costSold
    state.cashUsdt += quote.amountOut
    state.positions[asset.id] = held - quote.amountIn
    state.costBasis[asset.id] -= costSold
    if (state.positions[asset.id] <= held * 1e-12) {
      delete state.positions[asset.id]
      delete state.costBasis[asset.id]
    }
  }

  const trade = {
    id: state.trades.length ? state.trades.at(-1).id + 1 : 1,
    time: new Date().toISOString(),
    source,
    asset: asset.id,
    side,
    quantity: side === 'buy' ? quote.amountOut : quote.amountIn,
    usdt: side === 'buy' ? quote.amountIn : quote.amountOut,
    execPrice,
    midPrice: price.priceUsd,
    impactPct,
    ...(realizedPnlUsd !== undefined && { realizedPnlUsd }),
    route: quote.route.map((r) => r.dex).join(' > '),
  }
  pushCapped(state.trades, trade)
  save()
  return trade
}

// --- portfolio --------------------------------------------------------------

export async function portfolio() {
  const positions = await Promise.all(
    Object.entries(state.positions).map(async ([id, quantity]) => {
      const asset = findAsset(id)
      const price = await getPrice(asset).catch(() => null)
      // Stocks can't be quoted while their market is closed; value at the last price less costs.
      const exit = asset.reference?.fills
        ? price?.priceUsd != null
          ? { amountOut: quantity * price.priceUsd * (1 - config.referenceCostPct / 100) }
          : null
        : await quoteOrder(asset, USDT(), 'sell', quantity).catch(() => null)
      const cost = state.costBasis?.[id] ?? 0
      return {
        asset: id,
        quantity,
        costBasisUsd: cost,
        avgCost: cost / quantity,
        priceUsd: price?.priceUsd ?? null,
        markValueUsd: price?.priceUsd != null ? quantity * price.priceUsd : null,
        // What selling the whole position into the pools would return now.
        exitValueUsd: exit?.amountOut ?? null,
      }
    }),
  )
  const mark = positions.reduce((s, p) => s + (p.markValueUsd ?? 0), 0)
  const exit = positions.reduce((s, p) => s + (p.exitValueUsd ?? 0), 0)
  const equityMark = state.cashUsdt + mark
  const equityExit = state.cashUsdt + exit
  return {
    startedAt: state.startedAt,
    startUsdt: state.startUsdt,
    cashUsdt: state.cashUsdt,
    positions,
    equityUsd: { mark: equityMark, exit: equityExit },
    pnlUsd: { mark: equityMark - state.startUsdt, exit: equityExit - state.startUsdt },
    pnlPct: { mark: ((equityMark / state.startUsdt) - 1) * 100, exit: ((equityExit / state.startUsdt) - 1) * 100 },
    trades: state.trades.length,
    strategy: strategy
      ? { name: strategy.name, assets: config.paper.assets, intervalSec: config.paper.intervalSec, ...strategy.stats?.() }
      : null,
  }
}

export const trades = (limit = 100) => state.trades.slice(-limit).reverse()
export const decisions = (limit = 100) => state.decisions.slice(-limit).reverse()

export function reset() {
  state = freshState()
  save()
  return state
}

// --- auto-trading -------------------------------------------------------------

let strategy = null

async function loadStrategy(spec) {
  const url = /^[a-z0-9_-]+$/i.test(spec)
    ? new URL(`./strategies/${spec}.mjs`, import.meta.url)
    : pathToFileURL(resolve(process.cwd(), spec))
  const mod = (await import(url.href)).default
  if (!mod?.name || typeof mod.decide !== 'function') throw new Error(`Strategy ${spec} must default-export { name, decide }`)
  const missing = (mod.requires ?? []).filter((n) => !enabledPlugins().some((p) => p.name === n))
  if (missing.length) {
    throw new Error(`Strategy ${mod.name} needs TA indicators: ${missing.join(', ')} (set TA_ENABLED=true and add them to TA_INDICATORS)`)
  }
  return { defaults: {}, ...mod, params: { ...mod.defaults, ...envParamsFor('strategy', 'PAPER') } }
}

async function tick() {
  for (const id of config.paper.assets) {
    const asset = findAsset(id)
    if (!asset) continue
    const decision = { time: new Date().toISOString(), asset: asset.id, action: null }
    try {
      const [price, { candles }] = await Promise.all([getPrice(asset), getCandles(asset, config.paper.timeframe, 200)])
      const ta = analyze(candles)
      const out = await strategy.decide({
        asset,
        price,
        ta,
        candles,
        position: state.positions[asset.id] ?? 0,
        costBasisUsd: state.costBasis[asset.id] ?? 0,
        cashUsdt: state.cashUsdt,
        params: strategy.params,
      })
      decision.reason = out?.reason
      if (out?.side === 'buy') {
        const usdt = Math.min(out.usdt ?? config.paper.tradeUsd, state.cashUsdt)
        decision.action = usdt > 0 ? await placeOrder({ asset: asset.id, side: 'buy', usdt }, strategy.name) : null
      } else if (out?.side === 'sell' && (state.positions[asset.id] ?? 0) > 0) {
        decision.action = await placeOrder({ asset: asset.id, side: 'sell', fraction: out.fraction ?? 1 }, strategy.name)
      }
    } catch (err) {
      decision.error = err.message
    }
    pushCapped(state.decisions, decision)
    save()
    const what = decision.action ? `${decision.action.side} ${decision.action.quantity} @ ${decision.action.execPrice}` : decision.error ?? 'hold'
    console.log(`paper[${strategy.name}] ${asset.id}: ${what}${decision.reason ? ` (${decision.reason})` : ''}`)
  }
}

export async function startPaper() {
  if (!config.paper.enabled) return null
  load()
  if (config.paper.strategy) {
    strategy = await loadStrategy(config.paper.strategy)
    const timer = setInterval(tick, config.paper.intervalSec * 1000)
    timer.unref()
    tick()
  }
  return { strategy: strategy?.name ?? null }
}
