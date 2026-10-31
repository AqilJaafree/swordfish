// Swap on HashKey Chain (177) through the DODO route API.
//
//   npm run quote -- --from HSK --to USDT --amount 1
//   npm run swap  -- --from USDT --to HSK --amount 5 --slippage 1
//
// Without --send it only fetches the route and simulates the tx.

import { parseArgs } from 'node:util'
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  erc20Abi,
  formatUnits,
  getAddress,
  http,
  parseUnits,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

const TOKENS = {
  HSK: { address: NATIVE, decimals: 18 },
  WHSK: { address: '0xB210D2120d57b758EE163cFfb43e73728c471Cf1', decimals: 18 },
  USDT: { address: '0xF1B50eD67A9e2CC94Ad3c477779E2d4cBfFf9029', decimals: 6 },
}

// Verified on hsk.blockscout.com. Refuse to send to anything else.
const DODO_ROUTERS = new Set([
  '0x79A273d00bBF7B73B92d6938b973f0197b734Acc', // DODOFeeRouteProxy
  '0x7386F6F2375a38FBD1F4dA1d3eb39cd8dD8d1b40', // DODOV2Proxy02
])
const DODO_APPROVE = '0x2629E610dB4AC081c108cCDf8b19ED39D702df43'

const DODO_API = 'https://api.dodoex.io/route-service/developer/swap'

const hashkey = defineChain({
  id: 177,
  name: 'HashKey Chain',
  nativeCurrency: { name: 'HashKey Platform Token', symbol: 'HSK', decimals: 18 },
  rpcUrls: { default: { http: [process.env.HSK_RPC_URL ?? 'https://mainnet.hsk.xyz'] } },
  blockExplorers: { default: { name: 'Blockscout', url: 'https://hsk.blockscout.com' } },
})

function resolveToken(symbolOrAddress) {
  const known = TOKENS[symbolOrAddress.toUpperCase()]
  if (known) return known
  return { address: getAddress(symbolOrAddress), decimals: undefined }
}

async function getDecimals(client, token) {
  if (token.decimals !== undefined) return token.decimals
  return client.readContract({ address: token.address, abi: erc20Abi, functionName: 'decimals' })
}

async function fetchRoute({ from, to, amount, slippage, user, apiKey }) {
  const params = new URLSearchParams({
    chainId: String(hashkey.id),
    fromTokenAddress: from,
    toTokenAddress: to,
    fromAmount: amount.toString(),
    slippage: String(slippage),
    userAddr: user,
    apikey: apiKey,
  })
  const res = await fetch(`${DODO_API}?${params}`)
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.status !== 200 || !body.data?.to || !body.data?.data) {
    throw new Error(`DODO route failed (HTTP ${res.status}): ${JSON.stringify(body)}`)
  }
  return body.data
}

async function main() {
  const { values: args } = parseArgs({
    options: {
      from: { type: 'string', default: 'HSK' },
      to: { type: 'string', default: 'USDT' },
      amount: { type: 'string' },
      slippage: { type: 'string', default: '1' },
      send: { type: 'boolean', default: false },
    },
  })
  if (!args.amount) throw new Error('--amount is required')

  const apiKey = process.env.DODO_API_KEY
  if (!apiKey) throw new Error('DODO_API_KEY is not set (get one at https://developer.dodoex.io)')
  if (!process.env.PRIVATE_KEY) throw new Error('PRIVATE_KEY is not set')

  const account = privateKeyToAccount(process.env.PRIVATE_KEY)
  const publicClient = createPublicClient({ chain: hashkey, transport: http() })
  const walletClient = createWalletClient({ account, chain: hashkey, transport: http() })

  const from = resolveToken(args.from)
  const to = resolveToken(args.to)
  const fromIsNative = from.address === NATIVE
  const fromDecimals = await getDecimals(publicClient, from)
  const fromAmount = parseUnits(args.amount, fromDecimals)

  const balance = fromIsNative
    ? await publicClient.getBalance({ address: account.address })
    : await publicClient.readContract({
        address: from.address,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [account.address],
      })
  if (balance < fromAmount) {
    throw new Error(`Insufficient ${args.from}: have ${formatUnits(balance, fromDecimals)}, need ${args.amount}`)
  }

  const route = await fetchRoute({
    from: from.address,
    to: to.address,
    amount: fromAmount,
    slippage: args.slippage,
    user: account.address,
    apiKey,
  })

  const router = getAddress(route.to)
  if (!DODO_ROUTERS.has(router)) throw new Error(`Route targets unknown contract ${router}, refusing`)

  console.log(`Wallet:       ${account.address}`)
  console.log(`Swap:         ${args.amount} ${args.from} -> ~${route.resAmount} ${args.to}`)
  console.log(`Price impact: ${route.priceImpact ?? 'n/a'}`)
  console.log(`Source:       ${route.useSource ?? 'n/a'}`)
  console.log(`Router:       ${router}`)

  if (!fromIsNative) {
    const spender = getAddress(route.targetApproveAddr ?? DODO_APPROVE)
    const allowance = await publicClient.readContract({
      address: from.address,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [account.address, spender],
    })
    if (allowance < fromAmount) {
      if (!args.send) {
        console.log(`Needs approval of ${args.amount} ${args.from} to ${spender}; skipping simulation (dry run)`)
        return
      }
      console.log(`Approving ${spender}...`)
      const hash = await walletClient.writeContract({
        address: from.address,
        abi: erc20Abi,
        functionName: 'approve',
        args: [spender, fromAmount],
      })
      await publicClient.waitForTransactionReceipt({ hash })
    }
  }

  const tx = {
    account,
    to: router,
    data: route.data,
    value: fromIsNative ? fromAmount : BigInt(route.value ?? 0),
  }
  const gas = await publicClient.estimateGas(tx)
  console.log(`Simulated OK, gas ~${gas}`)

  if (!args.send) {
    console.log('Dry run. Re-run with --send (npm run swap) to broadcast.')
    return
  }

  const hash = await walletClient.sendTransaction({ ...tx, gas: (gas * 12n) / 10n })
  console.log(`Sent: ${hashkey.blockExplorers.default.url}/tx/${hash}`)
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  console.log(`Status: ${receipt.status}`)
  if (receipt.status !== 'success') process.exitCode = 1
}

main().catch((err) => {
  console.error(err.message ?? err)
  process.exit(1)
})
