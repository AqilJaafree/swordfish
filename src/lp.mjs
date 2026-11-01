// One-sided Uniswap V3 liquidity ("range orders") on HashKey's V3 pools.
//
// A USDT-only range sits just below the price and works like a limit buy that
// earns the pool fee as it fills; a coin-only range above the price works like
// a limit sell. Prices here are the asset in USDT (human units). On HashKey's
// USDT pools USDT is token1, so the asset price rises with the pool tick.

import { createWalletClient, decodeEventLog, decodeFunctionResult, encodeFunctionData, erc20Abi, http, maxUint128, maxUint256, parseAbi } from 'viem'
import { client, hashkey, NATIVE, USDT, V3_FACTORY, v3FactoryAbi } from './chain.mjs'
import { same } from './v3.mjs'

// NonfungiblePositionManager from the same deployer as V3_FACTORY (factory() and WETH9() checked on-chain).
export const V3_POSITION_MANAGER = '0xDF0A9b833Db0E4CeEa103A4408f3B68e7FC0cad5'
export const LP_FEE = 3000

const npmAbi = parseAbi([
  'struct MintParams { address token0; address token1; uint24 fee; int24 tickLower; int24 tickUpper; uint256 amount0Desired; uint256 amount1Desired; uint256 amount0Min; uint256 amount1Min; address recipient; uint256 deadline; }',
  'struct DecreaseLiquidityParams { uint256 tokenId; uint128 liquidity; uint256 amount0Min; uint256 amount1Min; uint256 deadline; }',
  'struct CollectParams { uint256 tokenId; address recipient; uint128 amount0Max; uint128 amount1Max; }',
  'function mint(MintParams params) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
  'function decreaseLiquidity(DecreaseLiquidityParams params) payable returns (uint256 amount0, uint256 amount1)',
  'function collect(CollectParams params) payable returns (uint256 amount0, uint256 amount1)',
  'function multicall(bytes[] data) payable returns (bytes[] results)',
  'event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
  'event DecreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
  'event Collect(uint256 indexed tokenId, address recipient, uint256 amount0, uint256 amount1)',
])
const poolAbi = parseAbi([
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function tickSpacing() view returns (int24)',
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
])
const decimalsAbi = parseAbi(['function decimals() view returns (uint8)'])

// --- pool -----------------------------------------------------------------------

const pools = new Map()

/** The asset/USDT 0.3% pool: addresses, decimals and tick spacing (cached). */
export async function lpPool(asset) {
  if (!asset?.address || same(asset.address, NATIVE)) throw new Error(`${asset?.symbol ?? 'asset'}: LP needs an ERC-20 token (native HSK is not supported)`)
  if (pools.has(asset.id)) return pools.get(asset.id)
  const address = await client.readContract({ address: V3_FACTORY, abi: v3FactoryAbi, functionName: 'getPool', args: [asset.address, USDT, LP_FEE] })
  if (/^0x0{40}$/.test(address)) throw new Error(`No ${asset.symbol}/USDT 0.3% V3 pool`)
  const read = (functionName) => client.readContract({ address, abi: poolAbi, functionName })
  const [token0, token1, spacing] = await Promise.all([read('token0'), read('token1'), read('tickSpacing')])
  if (!same(token1, USDT)) throw new Error(`${asset.symbol}/USDT pool has USDT as token0; only USDT-as-token1 pools are supported`)
  const dec0 = await client.readContract({ address: token0, abi: decimalsAbi, functionName: 'decimals' })
  const pool = { address, token0, token1, spacing: Number(spacing), dec0: Number(dec0), dec1: 6 }
  pools.set(asset.id, pool)
  return pool
}

/** Current pool price (asset in USDT) and tick. */
export async function poolState(pool) {
  const [sqrtPriceX96, tick] = await client.readContract({ address: pool.address, abi: poolAbi, functionName: 'slot0' })
  const sqrt = Number(sqrtPriceX96) / 2 ** 96
  return { tick: Number(tick), price: sqrt * sqrt * 10 ** (pool.dec0 - pool.dec1) }
}

// --- range math (human units) ----------------------------------------------------

export const tickToPrice = (tick, pool) => 1.0001 ** tick * 10 ** (pool.dec0 - pool.dec1)
export const priceToTick = (price, pool) => Math.log(price / 10 ** (pool.dec0 - pool.dec1)) / Math.log(1.0001)

/**
 * Ticks for a one-sided range. side 'usdt': the top sits `offsetPct` below the
 * price (all USDT until the price falls into it). side 'asset': the bottom sits
 * `offsetPct` above max(price, minPrice) (all coin until the price rises into it).
 */
export function planRange(side, price, tick, params, pool, minPrice = 0) {
  const s = pool.spacing
  const widthTicks = Math.max(s, Math.round(Math.log(1 + params.rangeWidthPct / 100) / Math.log(1.0001) / s) * s)
  if (side === 'usdt') {
    // USDT-only needs tickUpper <= current tick.
    const tickUpper = Math.min(Math.floor(priceToTick(price * (1 - params.offsetPct / 100), pool) / s) * s, Math.floor(tick / s) * s)
    return range(tickUpper - widthTicks, tickUpper, pool)
  }
  // Coin-only needs tickLower > current tick.
  let tickLower = Math.ceil(priceToTick(Math.max(price, minPrice) * (1 + params.offsetPct / 100), pool) / s) * s
  if (tickLower <= tick) tickLower = (Math.floor(tick / s) + 1) * s
  return range(tickLower, tickLower + widthTicks, pool)
}
const range = (tickLower, tickUpper, pool) => ({ tickLower, tickUpper, lower: tickToPrice(tickLower, pool), upper: tickToPrice(tickUpper, pool) })

/** Liquidity (human units) for depositing `amount` of one side into [lower, upper]. */
export const liquidityFor = (side, amount, lower, upper) =>
  side === 'usdt' ? amount / (Math.sqrt(upper) - Math.sqrt(lower)) : amount / (1 / Math.sqrt(lower) - 1 / Math.sqrt(upper))

/** Coin and USDT held by liquidity L at `price`. */
export function rangeAmounts(L, price, lower, upper) {
  const sp = Math.sqrt(Math.min(Math.max(price, lower), upper))
  return { asset: L * (1 / sp - 1 / Math.sqrt(upper)), usdt: L * (sp - Math.sqrt(lower)) }
}

/**
 * What to do with an open range at `price`: 'filled' once the price has fully
 * crossed it, 'recenter' when a USDT range is left far below a rising price.
 */
export function rangeAction(lp, price, params) {
  if (lp.side === 'usdt' && price <= lp.lower) return 'filled'
  if (lp.side === 'asset' && price >= lp.upper) return 'filled'
  if (lp.side === 'usdt' && params.recenterPct > 0 && price > lp.upper * (1 + (params.offsetPct + params.recenterPct) / 100)) return 'recenter'
  return null
}

// --- on-chain -----------------------------------------------------------------------

const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 1200)
const gasOf = (r) => r.gasUsed * r.effectiveGasPrice

async function approve(wallet, account, token, amount) {
  const allowance = await client.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [account.address, V3_POSITION_MANAGER] })
  if (allowance >= amount) return 0n
  const hash = await wallet.writeContract({ address: token, abi: erc20Abi, functionName: 'approve', args: [V3_POSITION_MANAGER, maxUint256] })
  const r = await client.waitForTransactionReceipt({ hash })
  if (r.status !== 'success') throw new Error(`Approval failed: ${hash}`)
  return gasOf(r)
}

/** Mint a one-sided position: amount0 (coin) or amount1 (USDT), raw units. */
export async function mintRange({ account, pool, tickLower, tickUpper, amount0 = 0n, amount1 = 0n }) {
  const wallet = createWalletClient({ account, chain: hashkey, transport: http() })
  let gasWei = 0n
  if (amount0 > 0n) gasWei += await approve(wallet, account, pool.token0, amount0)
  if (amount1 > 0n) gasWei += await approve(wallet, account, pool.token1, amount1)
  const { request } = await client.simulateContract({
    account, address: V3_POSITION_MANAGER, abi: npmAbi, functionName: 'mint',
    args: [{ token0: pool.token0, token1: pool.token1, fee: LP_FEE, tickLower, tickUpper, amount0Desired: amount0, amount1Desired: amount1, amount0Min: 0n, amount1Min: 0n, recipient: account.address, deadline: deadline() }],
  })
  const hash = await wallet.writeContract(request)
  const r = await client.waitForTransactionReceipt({ hash })
  if (r.status !== 'success') throw new Error(`Mint failed: ${hash}`)
  const ev = events(r, 'IncreaseLiquidity')[0]
  return { hash, tokenId: ev.tokenId, liquidity: ev.liquidity, amount0: ev.amount0, amount1: ev.amount1, gasWei: gasWei + gasOf(r) }
}

const exitCalls = (tokenId, liquidity, recipient) => [
  { functionName: 'decreaseLiquidity', args: [{ tokenId, liquidity, amount0Min: 0n, amount1Min: 0n, deadline: deadline() }] },
  { functionName: 'collect', args: [{ tokenId, recipient, amount0Max: maxUint128, amount1Max: maxUint128 }] },
]
const encodeCalls = (calls) => calls.map((c) => encodeFunctionData({ abi: npmAbi, ...c }))

/** What withdrawing now would return (principal + fees), raw units, without sending anything. */
export async function rangeValue({ owner, tokenId, liquidity }) {
  const { result } = await client.simulateContract({
    account: owner, address: V3_POSITION_MANAGER, abi: npmAbi, functionName: 'multicall', args: [encodeCalls(exitCalls(tokenId, liquidity, owner))],
  })
  const [p0, p1] = decodeFunctionResult({ abi: npmAbi, functionName: 'decreaseLiquidity', data: result[0] })
  const [c0, c1] = decodeFunctionResult({ abi: npmAbi, functionName: 'collect', data: result[1] })
  return { amount0: c0, amount1: c1, fee0: c0 - p0, fee1: c1 - p1 }
}

/** Remove all liquidity and collect principal plus fees to the owner. */
export async function withdrawRange({ account, tokenId, liquidity }) {
  const wallet = createWalletClient({ account, chain: hashkey, transport: http() })
  const { request } = await client.simulateContract({
    account, address: V3_POSITION_MANAGER, abi: npmAbi, functionName: 'multicall', args: [encodeCalls(exitCalls(tokenId, liquidity, account.address))],
  })
  const hash = await wallet.writeContract(request)
  const r = await client.waitForTransactionReceipt({ hash })
  if (r.status !== 'success') throw new Error(`Withdraw failed: ${hash}`)
  const dec = events(r, 'DecreaseLiquidity')[0]
  const col = events(r, 'Collect')[0]
  return { hash, amount0: col.amount0, amount1: col.amount1, fee0: col.amount0 - dec.amount0, fee1: col.amount1 - dec.amount1, gasWei: gasOf(r) }
}

function events(receipt, eventName) {
  const out = []
  for (const log of receipt.logs) {
    if (!same(log.address, V3_POSITION_MANAGER)) continue
    try {
      const ev = decodeEventLog({ abi: npmAbi, data: log.data, topics: log.topics })
      if (ev.eventName === eventName) out.push(ev.args)
    } catch {}
  }
  if (!out.length) throw new Error(`No ${eventName} event in ${receipt.transactionHash}`)
  return out
}
