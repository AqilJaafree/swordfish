// Uniswap V3 (SwapRouter02) swaps on HashKey Chain, shared by the CLI
// (swap-v3.mjs) and live bots (engine.mjs).

import { createWalletClient, encodeFunctionData, encodePacked, erc20Abi, http, maxUint256 } from 'viem'
import { client, hashkey, NATIVE, USDT, V3_FEES, V3_QUOTER, V3_SWAP_ROUTER, v3QuoterAbi, v3SwapRouterAbi, WHSK } from './chain.mjs'

const ROUTER_SELF = '0x0000000000000000000000000000000000000002' // SwapRouter02 ADDRESS_THIS
export const same = (a, b) => a.toLowerCase() === b.toLowerCase()
export const onchain = (address) => (same(address, NATIVE) ? WHSK : address)

async function bestFee(tokenIn, tokenOut, amountIn) {
  const quotes = await Promise.all(
    V3_FEES.map((fee) =>
      client
        .readContract({
          address: V3_QUOTER,
          abi: v3QuoterAbi,
          functionName: 'quoteExactInputSingle',
          args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }],
        })
        .then(([out]) => ({ fee, out }))
        .catch(() => null),
    ),
  )
  return quotes.filter((q) => q && q.out > 0n).sort((a, b) => (b.out > a.out ? 1 : -1))[0] ?? null
}

/** Best V3 route for token addresses a -> b (raw amountIn): direct, or via WHSK or USDT. */
export async function findRoute(a, b, amountIn) {
  a = onchain(a)
  b = onchain(b)
  const candidates = [[a, b]]
  for (const mid of [WHSK, USDT]) if (!same(a, mid) && !same(b, mid)) candidates.push([a, mid, b])
  const routes = await Promise.all(
    candidates.map(async (tokens) => {
      const fees = []
      let amount = amountIn
      for (let i = 0; i < tokens.length - 1; i++) {
        const hop = await bestFee(tokens[i], tokens[i + 1], amount)
        if (!hop) return null
        fees.push(hop.fee)
        amount = hop.out
      }
      const types = tokens.flatMap((_, i) => (i ? ['uint24', 'address'] : ['address']))
      const values = tokens.flatMap((t, i) => (i ? [fees[i - 1], t] : [t]))
      const path = encodePacked(types, values)
      const [out] = await client.readContract({ address: V3_QUOTER, abi: v3QuoterAbi, functionName: 'quoteExactInput', args: [path, amountIn] })
      return { tokens, fees, path, amountOut: out }
    }),
  )
  return routes.filter(Boolean).sort((x, y) => (y.amountOut > x.amountOut ? 1 : -1))[0] ?? null
}

/** Router multicall tx for `route`; native out is unwrapped to `recipient`. */
export function buildSwapTx({ route, from, to, amountIn, minOut, recipient, deadlineSec = 20 * 60 }) {
  const toNative = same(to, NATIVE)
  const calls = [
    encodeFunctionData({
      abi: v3SwapRouterAbi,
      functionName: 'exactInput',
      args: [{ path: route.path, recipient: toNative ? ROUTER_SELF : recipient, amountIn, amountOutMinimum: minOut }],
    }),
  ]
  if (toNative) calls.push(encodeFunctionData({ abi: v3SwapRouterAbi, functionName: 'unwrapWETH9', args: [minOut, recipient] }))
  const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineSec)
  return {
    to: V3_SWAP_ROUTER,
    data: encodeFunctionData({ abi: v3SwapRouterAbi, functionName: 'multicall', args: [deadline, calls] }),
    value: same(from, NATIVE) ? amountIn : 0n,
  }
}

export const balanceOf = (token, owner) =>
  same(token, NATIVE)
    ? client.getBalance({ address: owner })
    : client.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [owner] })

/**
 * Swap `amountIn` (raw) of token `from` into `to` from `account` (a viem
 * account). Approves the router once per token, enforces `slippageBps`, and
 * returns the amounts actually moved (from balance diffs) plus gas paid.
 */
export async function executeSwap({ account, from, to, amountIn, slippageBps = 50n }) {
  const route = await findRoute(from, to, amountIn)
  if (!route) throw new Error('No V3 route with liquidity')
  const minOut = (route.amountOut * (10_000n - slippageBps)) / 10_000n
  const wallet = createWalletClient({ account, chain: hashkey, transport: http() })
  let gasWei = 0n

  if (!same(from, NATIVE)) {
    const allowance = await client.readContract({ address: from, abi: erc20Abi, functionName: 'allowance', args: [account.address, V3_SWAP_ROUTER] })
    if (allowance < amountIn) {
      const hash = await wallet.writeContract({ address: from, abi: erc20Abi, functionName: 'approve', args: [V3_SWAP_ROUTER, maxUint256] })
      const r = await client.waitForTransactionReceipt({ hash })
      if (r.status !== 'success') throw new Error(`Approve failed: ${hash}`)
      gasWei += r.gasUsed * r.effectiveGasPrice
    }
  }

  const tx = { account, ...buildSwapTx({ route, from, to, amountIn, minOut, recipient: account.address }) }
  const [inBefore, outBefore] = await Promise.all([balanceOf(from, account.address), balanceOf(to, account.address)])
  const gas = await client.estimateGas(tx)
  const hash = await wallet.sendTransaction({ ...tx, gas: (gas * 12n) / 10n })
  const receipt = await client.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`Swap reverted: ${hash}`)
  const swapGas = receipt.gasUsed * receipt.effectiveGasPrice
  gasWei += swapGas
  const [inAfter, outAfter] = await Promise.all([balanceOf(from, account.address), balanceOf(to, account.address)])
  // Native balances also move by the swap's gas; take it back out of the diff.
  const spent = inBefore - inAfter - (same(from, NATIVE) ? swapGas : 0n)
  const received = outAfter - outBefore + (same(to, NATIVE) ? swapGas : 0n)
  return { hash, route, amountIn: spent, amountOut: received, gasWei }
}
