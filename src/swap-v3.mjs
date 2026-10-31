// Swap on HashKey Chain (177) through the Uniswap V3 deployment (SwapRouter02).
// No API key needed: routes are quoted on-chain with QuoterV2.
//
//   npm run quote:v3 -- --from HSK --to USDT --amount 100
//   npm run swap:v3  -- --from USDT --to ETH --amount 5 --slippage 0.5
//
// Tokens: registry ids or aliases (hsk, whsk, usdt, btc/wbtc, eth/weth, ...) or addresses.
// Routes direct or through WHSK or USDT, picking the best fee tier per hop.
// Native HSK is wrapped/unwrapped by the router. Without --send it quotes and
// simulates only; without PRIVATE_KEY it only quotes, or simulates as --account <address>.

import { parseArgs } from 'node:util'
import { createWalletClient, erc20Abi, formatUnits, getAddress, http, parseUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { findAsset } from './assets.mjs'
import { client, hashkey, NATIVE, V3_SWAP_ROUTER, WHSK } from './chain.mjs'
import { buildSwapTx, findRoute, onchain, same } from './v3.mjs'

function resolve(idOrAddress) {
  const asset = findAsset(idOrAddress)
  if (!asset) throw new Error(`Unknown token ${idOrAddress}; use a registry id (GET /assets) or an address`)
  return asset
}

async function main() {
  const { values: args } = parseArgs({
    options: {
      from: { type: 'string', default: 'HSK' },
      to: { type: 'string', default: 'USDT' },
      amount: { type: 'string' },
      slippage: { type: 'string', default: '0.5' }, // percent
      send: { type: 'boolean', default: false },
      account: { type: 'string' }, // simulate as this address when PRIVATE_KEY is unset
    },
  })
  if (!args.amount) throw new Error('--amount is required')
  const slippageBps = BigInt(Math.round(Number(args.slippage) * 100))
  if (!(slippageBps >= 0n && slippageBps < 5000n)) throw new Error('--slippage must be a percent between 0 and 50')

  const from = resolve(args.from)
  const to = resolve(args.to)
  const fromNative = same(from.address, NATIVE)
  if (same(onchain(from.address), onchain(to.address))) throw new Error('Use WHSK deposit/withdraw to wrap or unwrap HSK')
  const amountIn = parseUnits(args.amount, from.decimals)

  const route = await findRoute(onchain(from.address), onchain(to.address), amountIn)
  if (!route) throw new Error(`No V3 pool route with liquidity for ${from.symbol} -> ${to.symbol}`)
  const minOut = (route.amountOut * (10_000n - slippageBps)) / 10_000n

  const label = (t) => (same(t, onchain(from.address)) ? from.symbol : same(t, onchain(to.address)) ? to.symbol : same(t, WHSK) ? 'WHSK' : 'USDT')
  const symbols = route.tokens.map(label)
  const hops = route.fees.map((fee, i) => `${symbols[i]} -(${fee / 10_000}%)-> ${symbols[i + 1]}`).join(', ')
  const out = Number(formatUnits(route.amountOut, to.decimals))
  console.log(`Swap:      ${args.amount} ${from.symbol} -> ~${out} ${to.symbol}`)
  console.log(`Price:     ${out / Number(args.amount)} ${to.symbol} per ${from.symbol}`)
  console.log(`Min out:   ${formatUnits(minOut, to.decimals)} ${to.symbol} (${args.slippage}% slippage)`)
  console.log(`Route:     ${hops}`)
  console.log(`Router:    ${V3_SWAP_ROUTER} (SwapRouter02)`)

  const hasKey = process.env.PRIVATE_KEY && !/^0x?$/.test(process.env.PRIVATE_KEY)
  if (!hasKey && (args.send || !args.account)) {
    if (args.send) throw new Error('PRIVATE_KEY is not set')
    console.log('Quote only (set PRIVATE_KEY, or pass --account <address>, to check balance and simulate).')
    return
  }
  const account = hasKey ? privateKeyToAccount(process.env.PRIVATE_KEY) : { address: getAddress(args.account), type: 'json-rpc' }
  const wallet = hasKey && createWalletClient({ account, chain: hashkey, transport: http() })
  console.log(`Wallet:    ${account.address}${hasKey ? '' : ' (simulation only)'}`)

  const balance = fromNative
    ? await client.getBalance({ address: account.address })
    : await client.readContract({ address: from.address, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] })
  if (balance < amountIn) {
    throw new Error(`Insufficient ${from.symbol}: have ${formatUnits(balance, from.decimals)}, need ${args.amount}`)
  }

  if (!fromNative) {
    const allowance = await client.readContract({
      address: from.address,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [account.address, V3_SWAP_ROUTER],
    })
    if (allowance < amountIn) {
      if (!args.send) {
        console.log(`Needs approval of ${args.amount} ${from.symbol} to the router; skipping simulation (dry run)`)
        return
      }
      console.log(`Approving ${args.amount} ${from.symbol}...`)
      const hash = await wallet.writeContract({ address: from.address, abi: erc20Abi, functionName: 'approve', args: [V3_SWAP_ROUTER, amountIn] })
      await client.waitForTransactionReceipt({ hash })
    }
  }

  const tx = { account, ...buildSwapTx({ route, from: from.address, to: to.address, amountIn, minOut, recipient: account.address }) }

  const gas = await client.estimateGas(tx)
  console.log(`Simulated OK, gas ~${gas}`)
  if (!args.send) {
    console.log('Dry run. Re-run with npm run swap:v3 to broadcast.')
    return
  }

  const hash = await wallet.sendTransaction({ ...tx, gas: (gas * 12n) / 10n })
  console.log(`Sent: ${hashkey.blockExplorers.default.url}/tx/${hash}`)
  const receipt = await client.waitForTransactionReceipt({ hash })
  console.log(`Status: ${receipt.status}`)
  if (receipt.status !== 'success') process.exitCode = 1
}

main().catch((err) => {
  console.error(err.shortMessage ?? err.message ?? err)
  process.exit(1)
})
