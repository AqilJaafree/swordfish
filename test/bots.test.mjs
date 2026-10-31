import assert from 'node:assert/strict'
import { test } from 'node:test'

process.env.MASTER_KEY = 'a'.repeat(64)
process.env.DB_FILE = ':memory:'
const { createWallet, decrypt, unlock } = await import('../src/vault.mjs')
const { riskExit } = await import('../src/engine.mjs')
const smaCross = (await import('../src/strategies/sma-cross.mjs')).default
const breakout = (await import('../src/strategies/breakout.mjs')).default

const candles = (closes) => closes.map((close, i) => ({ time: i * 3600, open: close, high: close, low: close, close, volume: 1 }))

test('vault round-trips a key and binds it to the address', () => {
  const w = createWallet()
  assert.equal(unlock(w).address, w.address)
  assert.ok(!w.encryptedKey.includes(w.address.slice(2)))
  assert.throws(() => decrypt(w.encryptedKey, '0x0000000000000000000000000000000000000001'))
})

test('sma-cross buys in an uptrend and sells in a downtrend', () => {
  const params = { fast: 3, slow: 5 }
  const up = candles([1, 2, 3, 4, 5, 6, 7])
  assert.equal(smaCross.decide({ candles: up, position: 0, params }).side, 'buy')
  assert.equal(smaCross.decide({ candles: up, position: 1, params }).side, undefined)
  const down = candles([7, 6, 5, 4, 3, 2, 1])
  assert.equal(smaCross.decide({ candles: down, position: 1, params }).side, 'sell')
})

test('breakout buys a new high and exits on a new low', () => {
  const params = { entry: 3, exit: 2 }
  assert.equal(breakout.decide({ candles: candles([5, 5, 5, 6]), position: 0, params }).side, 'buy')
  assert.equal(breakout.decide({ candles: candles([5, 5, 5, 4]), position: 1, params }).side, 'sell')
  assert.equal(breakout.decide({ candles: candles([5, 5, 5, 5]), position: 0, params }).side, undefined)
})

test('riskExit applies stop loss, take profit and trailing stop', () => {
  const bot = { positions: { weth: 1 }, cost_basis: { weth: 100 }, highs: { weth: 120 } }
  const asset = { id: 'weth' }
  const off = { stopLossPct: 0, takeProfitPct: 0, trailingStopPct: 0 }
  assert.equal(riskExit(bot, asset, { priceUsd: 94 }, { ...off, stopLossPct: 5 })?.side, 'sell')
  assert.equal(riskExit(bot, asset, { priceUsd: 96 }, { ...off, stopLossPct: 5 }), null)
  assert.equal(riskExit(bot, asset, { priceUsd: 111 }, { ...off, takeProfitPct: 10 })?.side, 'sell')
  assert.equal(riskExit(bot, asset, { priceUsd: 115 }, { ...off, trailingStopPct: 3 })?.side, 'sell')
  assert.equal(riskExit(bot, asset, { priceUsd: 119 }, { ...off, trailingStopPct: 3 }), null)
  assert.equal(riskExit({ ...bot, positions: {} }, asset, { priceUsd: 50 }, { ...off, stopLossPct: 5 }), null)
})
