// Realistic swap quotes against live pools, used to fill paper orders.
// Each route is USDT <-> asset, either direct or through WHSK; every hop is
// quoted on every pool we know for that pair and the best output wins. The
// quotes come from the pools themselves, so they include fees and price impact.

import { formatUnits, parseUnits } from 'viem'
import { client, NATIVE, USDT, V3_QUOTER, v3QuoterAbi, WHSK } from './chain.mjs'
import { config } from './config.mjs'
import { discoverPools, getPrice } from './pricing.mjs'

export const HYPERINDEX_V2_ROUTER = '0x865E195B184fBf98c69752a280f2b3950AbD7756'
const QUOTER = '0x0000000000000000000000000000000000000001'

const routerAbi = [
  { type: 'function', name: 'getAmountsOut', stateMutability: 'view', inputs: [{ type: 'uint256' }, { type: 'address[]' }], outputs: [{ type: 'uint256[]' }] },
]
const dodoQuoteAbi = [
  { type: 'function', name: '_BASE_TOKEN_', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'querySellBase', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'uint256' }, { type: 'uint256' }] },
  { type: 'function', name: 'querySellQuote', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'uint256' }, { type: 'uint256' }] },
]

const same = (a, b) => a.toLowerCase() === b.toLowerCase()
const onchain = (address) => (same(address, NATIVE) ? WHSK : address)

async function quotePool(pool, tokenIn, tokenOut, amountIn) {
  if (pool.dex === 'v3') {
    const [out] = await client.readContract({
      address: V3_QUOTER,
      abi: v3QuoterAbi,
      functionName: 'quoteExactInputSingle',
      args: [{ tokenIn, tokenOut, amountIn, fee: pool.fee, sqrtPriceLimitX96: 0n }],
    })
    return out
  }
  if (pool.dex === 'hyperindex-v2') {
    const amounts = await client.readContract({
      address: HYPERINDEX_V2_ROUTER,
      abi: routerAbi,
      functionName: 'getAmountsOut',
      args: [amountIn, [tokenIn, tokenOut]],
    })
    return amounts[1]
  }
  const base = await client.readContract({ address: pool.address, abi: dodoQuoteAbi, functionName: '_BASE_TOKEN_' })
  const [out] = await client.readContract({
    address: pool.address,
    abi: dodoQuoteAbi,
    functionName: same(base, tokenIn) ? 'querySellBase' : 'querySellQuote',
    args: [QUOTER, amountIn],
  })
  return out
}

// Best single hop between `token` and a core quote (WHSK or USDT), either direction.
async function bestHop(tokenIn, tokenOut, amountIn) {
  const [token, quote] = same(tokenIn, WHSK) && same(tokenOut, USDT) ? [WHSK, USDT]
    : same(tokenIn, USDT) && same(tokenOut, WHSK) ? [WHSK, USDT]
    : same(tokenIn, USDT) || same(tokenIn, WHSK) ? [tokenOut, tokenIn]
    : [tokenIn, tokenOut]
  const pools = (await discoverPools(token)).filter((p) => same(p.quote, quote))
  const quotes = await Promise.all(
    pools.map((p) =>
      quotePool(p, tokenIn, tokenOut, amountIn)
        .then((out) => ({ pool: p, out }))
        .catch(() => null),
    ),
  )
  return quotes.filter((q) => q && q.out > 0n).sort((a, b) => (b.out > a.out ? 1 : b.out < a.out ? -1 : 0))[0] ?? null
}

async function quotePath(path, amountIn) {
  const hops = []
  let amount = amountIn
  for (let i = 0; i < path.length - 1; i++) {
    const hop = await bestHop(path[i], path[i + 1], amount)
    if (!hop) return null
    hops.push({ dex: hop.pool.dex, pool: hop.pool.address, tokenIn: path[i], tokenOut: path[i + 1], amountIn: amount, amountOut: hop.out })
    amount = hop.out
  }
  return { amountOut: amount, hops }
}

/**
 * Quote swapping `amountIn` (human units) of `from` into `to`.
 * Assets are registry entries ({ address, decimals, symbol }).
 * Returns { amountIn, amountOut, route } in human units, or null if no route.
 */
export async function quoteSwap(from, to, amountIn) {
  const a = onchain(from.address)
  const b = onchain(to.address)
  // toFixed avoids exponent notation (1e-7) that parseUnits rejects.
  const raw = parseUnits(Number(amountIn).toFixed(from.decimals), from.decimals)
  if (raw === 0n) return null

  const paths = [[a, b]]
  if (!same(a, WHSK) && !same(b, WHSK)) paths.push([a, WHSK, b])
  const results = (await Promise.all(paths.map((p) => quotePath(p, raw)))).filter(Boolean)
  const best = results.sort((x, y) => (y.amountOut > x.amountOut ? 1 : y.amountOut < x.amountOut ? -1 : 0))[0]
  if (!best) return null

  return {
    amountIn: Number(amountIn),
    amountOut: Number(formatUnits(best.amountOut, to.decimals)),
    route: best.hops.map((h) => ({ dex: h.dex, pool: h.pool, tokenIn: h.tokenIn, tokenOut: h.tokenOut })),
  }
}

/**
 * Quote a paper order against USDT.
 *   side 'buy':  amountIn is USDT, amountOut is asset units
 *   side 'sell': amountIn is asset units, amountOut is USDT
 * Reference-priced assets (stocks) are filled at the live quote minus
 * REFERENCE_COST_PCT, and only while their market is open.
 */
export async function quoteOrder(asset, usdtAsset, side, amountIn) {
  if (asset.reference?.fills) {
    const price = await getPrice(asset)
    if (!price.marketOpen) {
      throw Object.assign(new Error(`${asset.reference.symbol} market is closed (last trade ${price.marketTime})`), { status: 422 })
    }
    const cost = config.referenceCostPct / 100
    const amountOut = side === 'buy' ? (amountIn * (1 - cost)) / price.priceUsd : amountIn * price.priceUsd * (1 - cost)
    return { amountIn, amountOut, route: [{ dex: `${price.source} (simulated, ${config.referenceCostPct}% cost)` }] }
  }
  return side === 'buy' ? quoteSwap(usdtAsset, asset, amountIn) : quoteSwap(asset, usdtAsset, amountIn)
}
