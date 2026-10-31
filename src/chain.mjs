import { createPublicClient, defineChain, http } from 'viem'
import { config } from './config.mjs'

export const hashkey = defineChain({
  id: 177,
  name: 'HashKey Chain',
  nativeCurrency: { name: 'HashKey Platform Token', symbol: 'HSK', decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
  blockExplorers: { default: { name: 'Blockscout', url: 'https://hsk.blockscout.com' } },
  contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } },
})

export const client = createPublicClient({
  chain: hashkey,
  transport: http(),
  batch: { multicall: true },
})

export const NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
export const WHSK = '0xB210D2120d57b758EE163cFfb43e73728c471Cf1'
export const USDT = '0xF1B50eD67A9e2CC94Ad3c477779E2d4cBfFf9029'
export const ZERO = '0x0000000000000000000000000000000000000000'

export const HYPERINDEX_V2_FACTORY = '0x09ee9eCc6E2B458508E05Da7f90E324AE54620D2'
export const DODO_FACTORIES = {
  DVM: '0x2235bB894b7600F1a370fc595Ee5477999A30441',
  DSP: '0x297A4885a7da4AaeF340FABEd119e7a6E3f2BCe8',
  DPP: '0x8Ebbfe204E7EdA4be46b9d09c5dfa8b3e1500462',
}

// Uniswap V3-style deployment (holds the WBTC/USDT pool, ~$100k).
export const V3_FACTORY = '0x972cA9D1662F5e029cD18327D29026532E84c742'
export const V3_QUOTER = '0x1095A23A4812185344D9abd5143191D8a3A7E36f'
export const V3_FEES = [100, 500, 3000, 10000]

export const v3FactoryAbi = [
  { type: 'function', name: 'getPool', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }], outputs: [{ type: 'address' }] },
]
export const v3PoolAbi = [
  { type: 'function', name: 'token0', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'liquidity', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint128' }] },
  {
    type: 'function', name: 'slot0', stateMutability: 'view', inputs: [],
    outputs: [{ type: 'uint160' }, { type: 'int24' }, { type: 'uint16' }, { type: 'uint16' }, { type: 'uint16' }, { type: 'uint8' }, { type: 'bool' }],
  },
]
// QuoterV2 is nonpayable (it simulates the swap and reverts), but works via eth_call.
export const v3QuoterAbi = [
  {
    type: 'function', name: 'quoteExactInputSingle', stateMutability: 'view',
    inputs: [{ type: 'tuple', components: [
      { name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' }, { name: 'amountIn', type: 'uint256' },
      { name: 'fee', type: 'uint24' }, { name: 'sqrtPriceLimitX96', type: 'uint160' },
    ] }],
    outputs: [{ type: 'uint256' }, { type: 'uint160' }, { type: 'uint32' }, { type: 'uint256' }],
  },
  {
    type: 'function', name: 'quoteExactInput', stateMutability: 'view',
    inputs: [{ name: 'path', type: 'bytes' }, { name: 'amountIn', type: 'uint256' }],
    outputs: [{ type: 'uint256' }, { type: 'uint160[]' }, { type: 'uint32[]' }, { type: 'uint256' }],
  },
]

// SwapRouter02 from the same deployer as V3_FACTORY (factory() and WETH9() checked on-chain).
export const V3_SWAP_ROUTER = '0x2c16f75b95Cf1390c328aB70e2CEE7f4b80bD8F3'
export const v3SwapRouterAbi = [
  {
    type: 'function', name: 'exactInput', stateMutability: 'payable',
    inputs: [{ type: 'tuple', components: [
      { name: 'path', type: 'bytes' }, { name: 'recipient', type: 'address' },
      { name: 'amountIn', type: 'uint256' }, { name: 'amountOutMinimum', type: 'uint256' },
    ] }],
    outputs: [{ type: 'uint256' }],
  },
  { type: 'function', name: 'unwrapWETH9', stateMutability: 'payable', inputs: [{ type: 'uint256' }, { type: 'address' }], outputs: [] },
  { type: 'function', name: 'multicall', stateMutability: 'payable', inputs: [{ type: 'uint256' }, { type: 'bytes[]' }], outputs: [{ type: 'bytes[]' }] },
]
export const erc20BalanceAbi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
]

export const v2FactoryAbi = [
  { type: 'function', name: 'getPair', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'address' }] },
]
export const v2PairAbi = [
  { type: 'function', name: 'token0', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'getReserves', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint112' }, { type: 'uint112' }, { type: 'uint32' }] },
]
export const dodoFactoryAbi = [
  { type: 'function', name: 'getDODOPool', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'address[]' }] },
]
export const dodoPoolAbi = [
  { type: 'function', name: '_BASE_TOKEN_', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: '_QUOTE_TOKEN_', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'getMidPrice', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'getVaultReserve', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }, { type: 'uint256' }] },
]
