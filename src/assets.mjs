// Asset registry: crypto tokens found on HashKey Chain plus data/hsk-stocks.csv.
// Addresses verified on hsk.blockscout.com (Oct 2026).

import { readFileSync } from 'node:fs'
import { NATIVE, USDT, WHSK } from './chain.mjs'
import { config } from './config.mjs'

const TOKENS = [
  // symbol, name, address, decimals
  ['HSK', 'HashKey Platform Token (native)', NATIVE, 18],
  ['WHSK', 'Wrapped HSK', WHSK, 18],
  ['USDT', 'Tether USD', USDT, 6],
  ['USDC.e', 'Bridged USDC', '0x054ed45810DbBAb8B27668922D110669c9D88D0a', 6],
  ['oUSDT', 'OpenUSDT', '0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189', 6],
  ['WETH', 'Wrapped Ether', '0xefd4bC9afD210517803f293ABABd701CaeeCdfd0', 18],
  ['WBTC', 'Wrapped BTC', '0x6119CA49a79f5825C8B345F8d7aC36B272565b14', 8],
  ['CELA', 'Cellula Token', '0xC7DcECe84EC314F08014dA2036632afb7fb1e05C', 18],
  ['RWAC', 'RealWorldAssetCoin', '0x6c5D2f3054b121a97366a7Eb9388d6888995C333', 18],
  ['HAPE', 'Hashkey Pepe', '0xD54c2f476da8960Fe25Eac65df596b76007131AB', 18],
  ['DOGS', 'Dogs Coin', '0xF9fB2302DA48d5715b10921CEC3b82c99ACb39AC', 18],
  ['Megrez', 'Megrez', '0xB82744E309db4d24a2615CC799ED7C20E11327aB', 18],
  ['PEPE', 'PEPE Coin', '0xB988Ed3DE9254273d1F3Ccc5604F82C5FFE4D234', 18],
  ['stHSK', 'Staked HashKeyChain', '0xD2fdDFf28A534300ae961c5435E16f9465253b76', 18],
  ['veHSK', 'Voting Escrow HashKey', '0xe1045155ee02e0997E6bB4509D854a306c50D914', 18],
  ['BRAVO', 'BRAVO', '0x6485e0EF23bf930fa8F232715Ae4d915750cF3F8', 18],
  ['HDOG', 'Hdog', '0x92c6022edcFAceb370289a887E233E029D357423', 18],
  ['HASHED', 'HASHED', '0xC22F6e7974B543aD2612c590202A5366D2610785', 18],
  ['HASHOO', 'Hashoo', '0x7c1871da13810241c2B9A7f0BE396dFF7CbE6DB0', 18],
]

// Off-chain reference data (Yahoo symbols). `fills: true` means the token has
// no on-chain liquidity, so prices and paper fills come from the reference;
// otherwise only TA candles do (BTC and ETH trade on-chain in V3 pools vs USDT).
// ONCHAIN_ONLY=true drops them all: prices, candles and fills come from HashKey pools.
const REFERENCES = {
  nvdas: { provider: 'yahoo', symbol: 'NVDA', fills: true },
  aapls: { provider: 'yahoo', symbol: 'AAPL', fills: true },
  wbtc: { provider: 'yahoo', symbol: 'BTC-USD', fills: false },
  weth: { provider: 'yahoo', symbol: 'ETH-USD', fills: false },
}
const ALIASES = { nvda: 'nvdas', aapl: 'aapls', btc: 'wbtc', eth: 'weth' }

function parseCsv(text) {
  const rows = []
  for (const line of text.trim().split('\n')) {
    const cells = []
    let cur = ''
    let quoted = false
    for (const ch of line) {
      if (ch === '"') quoted = !quoted
      else if (ch === ',' && !quoted) {
        cells.push(cur)
        cur = ''
      } else cur += ch
    }
    cells.push(cur)
    rows.push(cells)
  }
  const [header, ...body] = rows
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])))
}

function loadStocks() {
  const csv = readFileSync(new URL('../data/hsk-stocks.csv', import.meta.url), 'utf8')
  return parseCsv(csv).map((r) => ({
    symbol: r.symbol,
    name: r.name,
    address: r.address,
    decimals: Number(r.decimals),
    category: r.category,
  }))
}

function buildRegistry() {
  const raw = [
    ...TOKENS.map(([symbol, name, address, decimals]) => ({ symbol, name, address, decimals, category: 'crypto' })),
    ...loadStocks(),
  ]
  const counts = {}
  for (const a of raw) counts[a.symbol.toLowerCase()] = (counts[a.symbol.toLowerCase()] ?? 0) + 1
  return raw.map((a) => {
    const base = a.symbol.toLowerCase()
    // Duplicate symbols (e.g. the 3887 test tokens) get an address suffix.
    const id = counts[base] > 1 ? `${base}-${a.address.slice(2, 6).toLowerCase()}` : base
    return { id, ...a, ...(!config.onchainOnly && REFERENCES[id] && { reference: REFERENCES[id] }) }
  })
}

export const assets = buildRegistry()

export function findAsset(idOrAddress) {
  const lower = idOrAddress.toLowerCase()
  const key = ALIASES[lower] ?? lower
  return assets.find((a) => a.id === key || a.address.toLowerCase() === key) ?? null
}
