// Spot prices. For each asset we look for pools against WHSK and USDT on
// HyperIndex V2, DODO (DVM/DSP/DPP) and the V3 deployment, price off the
// deepest one, and convert to USD through HSK/USDT. USDT is treated as $1.
// Assets with a `reference` that fills off-chain (stocks) are priced from it.

import { formatUnits } from 'viem'
import {
  client,
  DODO_FACTORIES,
  dodoFactoryAbi,
  dodoPoolAbi,
  erc20BalanceAbi,
  HYPERINDEX_V2_FACTORY,
  NATIVE,
  USDT,
  V3_FACTORY,
  V3_FEES,
  v2FactoryAbi,
  v2PairAbi,
  v3FactoryAbi,
  v3PoolAbi,
  WHSK,
  ZERO,
} from './chain.mjs'
import { config } from './config.mjs'
import { referenceQuote } from './reference.mjs'

const DECIMALS = { [WHSK.toLowerCase()]: 18, [USDT.toLowerCase()]: 6 }
const same = (a, b) => a.toLowerCase() === b.toLowerCase()
const toNum = (raw, decimals) => Number(formatUnits(raw, decimals))

const poolCache = new Map() // token -> { at, pools }
const POOL_CACHE_MS = 10 * 60_000

export async function discoverPools(token) {
  const hit = poolCache.get(token.toLowerCase())
  if (hit && Date.now() - hit.at < POOL_CACHE_MS) return hit.pools

  const quotes = [WHSK, USDT].filter((q) => !same(q, token))
  const pools = []

  const v2 = await Promise.all(
    quotes.map((q) => client.readContract({ address: HYPERINDEX_V2_FACTORY, abi: v2FactoryAbi, functionName: 'getPair', args: [token, q] })),
  )
  v2.forEach((pair, i) => pair !== ZERO && pools.push({ dex: 'hyperindex-v2', address: pair, quote: quotes[i] }))

  const dodoCalls = []
  for (const [kind, factory] of Object.entries(DODO_FACTORIES)) {
    for (const q of quotes) {
      for (const args of [[token, q], [q, token]]) {
        dodoCalls.push(
          client
            .readContract({ address: factory, abi: dodoFactoryAbi, functionName: 'getDODOPool', args })
            .then((list) => list.map((address) => ({ dex: `dodo-${kind.toLowerCase()}`, address, quote: q }))),
        )
      }
    }
  }
  for (const list of await Promise.all(dodoCalls)) pools.push(...list)

  const v3Calls = quotes.flatMap((q) =>
    V3_FEES.map((fee) =>
      client
        .readContract({ address: V3_FACTORY, abi: v3FactoryAbi, functionName: 'getPool', args: [token, q, fee] })
        .then((address) => (address === ZERO ? null : { dex: 'v3', address, quote: q, fee })),
    ),
  )
  for (const p of await Promise.all(v3Calls)) if (p) pools.push(p)

  poolCache.set(token.toLowerCase(), { at: Date.now(), pools })
  return pools
}

// Price of `token` in units of pool.quote, plus the pool's quote-side depth.
async function readPool(pool, token, tokenDecimals) {
  const quoteDecimals = DECIMALS[pool.quote.toLowerCase()]

  if (pool.dex === 'hyperindex-v2') {
    const [token0, [r0, r1]] = await Promise.all([
      client.readContract({ address: pool.address, abi: v2PairAbi, functionName: 'token0' }),
      client.readContract({ address: pool.address, abi: v2PairAbi, functionName: 'getReserves' }),
    ])
    const [rToken, rQuote] = same(token0, token) ? [r0, r1] : [r1, r0]
    if (rToken === 0n || rQuote === 0n) return null
    const quoteReserve = toNum(rQuote, quoteDecimals)
    return { price: quoteReserve / toNum(rToken, tokenDecimals), quoteReserve, depthInQuote: quoteReserve * 2 }
  }

  if (pool.dex === 'v3') {
    const [token0, liquidity, [sqrtPriceX96], tokenBal, quoteBal] = await Promise.all([
      client.readContract({ address: pool.address, abi: v3PoolAbi, functionName: 'token0' }),
      client.readContract({ address: pool.address, abi: v3PoolAbi, functionName: 'liquidity' }),
      client.readContract({ address: pool.address, abi: v3PoolAbi, functionName: 'slot0' }),
      client.readContract({ address: token, abi: erc20BalanceAbi, functionName: 'balanceOf', args: [pool.address] }),
      client.readContract({ address: pool.quote, abi: erc20BalanceAbi, functionName: 'balanceOf', args: [pool.address] }),
    ])
    // No in-range liquidity means the slot0 price can't be traded against.
    if (liquidity === 0n || quoteBal === 0n) return null
    const tokenIs0 = same(token0, token)
    const [d0, d1] = tokenIs0 ? [tokenDecimals, quoteDecimals] : [quoteDecimals, tokenDecimals]
    const p1per0 = (Number(sqrtPriceX96) / 2 ** 96) ** 2 * 10 ** (d0 - d1)
    const price = tokenIs0 ? p1per0 : 1 / p1per0
    const quoteReserve = toNum(quoteBal, quoteDecimals)
    return { price, quoteReserve, depthInQuote: quoteReserve + toNum(tokenBal, tokenDecimals) * price }
  }

  const [base, mid, [baseRes, quoteRes]] = await Promise.all([
    client.readContract({ address: pool.address, abi: dodoPoolAbi, functionName: '_BASE_TOKEN_' }),
    client.readContract({ address: pool.address, abi: dodoPoolAbi, functionName: 'getMidPrice' }),
    client.readContract({ address: pool.address, abi: dodoPoolAbi, functionName: 'getVaultReserve' }),
  ])
  if (mid === 0n || baseRes === 0n || quoteRes === 0n) return null
  const tokenIsBase = same(base, token)
  const [baseDec, poolQuoteDec] = tokenIsBase ? [tokenDecimals, quoteDecimals] : [quoteDecimals, tokenDecimals]
  // getMidPrice: raw quote units per 1e18 raw base units.
  const basePriceInQuote = (Number(mid) / 1e18) * 10 ** (baseDec - poolQuoteDec)
  const price = tokenIsBase ? basePriceInQuote : 1 / basePriceInQuote
  const quoteReserve = toNum(tokenIsBase ? quoteRes : baseRes, quoteDecimals)
  const tokenReserve = toNum(tokenIsBase ? baseRes : quoteRes, tokenDecimals)
  return { price, quoteReserve, depthInQuote: quoteReserve + tokenReserve * price }
}

async function bestQuote(token, tokenDecimals, quoteUsd) {
  const pools = await discoverPools(token)
  const reads = await Promise.all(
    pools.map(async (p) => {
      const r = await readPool(p, token, tokenDecimals).catch(() => null)
      if (!r) return null
      const qUsd = quoteUsd(p.quote)
      return { ...p, priceUsd: r.price * qUsd, priceInQuote: r.price, liquidityUsd: r.depthInQuote * qUsd }
    }),
  )
  return reads.filter(Boolean).sort((a, b) => b.liquidityUsd - a.liquidityUsd)
}

let hskCache = null
async function hskUsd() {
  if (hskCache && Date.now() - hskCache.at < config.priceCacheMs) return hskCache.value
  const [best] = await bestQuote(WHSK, 18, () => 1)
  if (!best) throw new Error('No HSK/USDT pool with liquidity')
  hskCache = { at: Date.now(), value: best }
  return best
}

const priceCache = new Map()

export async function getPrice(asset) {
  const cached = priceCache.get(asset.id)
  if (cached && Date.now() - cached.at < config.priceCacheMs) return cached.value

  const value = await computePrice(asset)
  priceCache.set(asset.id, { at: Date.now(), value })
  return value
}

async function computePrice(asset) {
  const base = { id: asset.id, symbol: asset.symbol, address: asset.address, timestamp: new Date().toISOString() }

  if (asset.reference?.fills) {
    const q = await referenceQuote(asset.reference.symbol)
    return {
      ...base,
      priceUsd: q.price,
      priceHsk: null,
      source: `${asset.reference.provider}:${asset.reference.symbol}`,
      marketOpen: q.marketOpen,
      marketTime: q.marketTime,
      note: 'Off-chain reference price; no on-chain liquidity for this token',
    }
  }

  if (same(asset.address, USDT)) {
    const hsk = await hskUsd()
    return { ...base, priceUsd: 1, priceHsk: 1 / hsk.priceUsd, source: 'peg', note: 'USDT is the USD quote asset' }
  }

  const hsk = await hskUsd()
  if (same(asset.address, NATIVE) || same(asset.address, WHSK)) {
    return { ...base, priceUsd: hsk.priceUsd, priceHsk: 1, source: hsk.dex, pool: hsk.address, liquidityUsd: hsk.liquidityUsd }
  }

  const quoteUsd = (q) => (same(q, USDT) ? 1 : hsk.priceUsd)
  const quotes = await bestQuote(asset.address, asset.decimals, quoteUsd)
  const best = quotes[0]
  if (!best) return { ...base, priceUsd: null, priceHsk: null, source: null, note: 'No DEX pool with liquidity on HyperIndex or DODO' }

  return {
    ...base,
    priceUsd: best.priceUsd,
    priceHsk: best.priceUsd / hsk.priceUsd,
    source: best.dex,
    pool: best.address,
    liquidityUsd: best.liquidityUsd,
    ...(best.liquidityUsd < config.minLiquidityUsd && { warning: `Pool liquidity below $${config.minLiquidityUsd}; price is unreliable` }),
  }
}
