import assert from 'node:assert/strict'
import { test } from 'node:test'

process.env.MASTER_KEY = 'a'.repeat(64)
process.env.DB_FILE = ':memory:'
const { createWallet, decrypt, importWallet, unlock } = await import('../src/vault.mjs')
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

test('importWallet accepts a key with or without 0x and never echoes it', () => {
  const key = 'ab'.repeat(32)
  const w = importWallet(key)
  assert.equal(importWallet(`0x${key}`).address, w.address)
  assert.equal(decrypt(w.encryptedKey, w.address), `0x${key}`)
  assert.equal(unlock(w).address, w.address)
  for (const bad of ['0x1234', `${key}00`, 'zz'.repeat(32), '']) {
    assert.throws(() => importWallet(bad), (err) => !err.message.includes(bad || '\u0000') && err.status === 400)
  }
  // secp256k1 rejects zero; the error must not contain the key either.
  assert.throws(() => importWallet('0'.repeat(64)), (err) => err.message === 'Invalid private key')
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

test('breakout levels match the prices its decide() trades at', () => {
  const params = { entry: 3, exit: 2 }
  const c = candles([4, 6, 5, 7, 5])
  const [buy, sell] = breakout.levels({ candles: c, params })
  assert.deepEqual([buy.side, buy.price, sell.side, sell.price], ['buy', 7, 'sell', 5])
  assert.deepEqual(breakout.levels({ candles: candles([5, 5]), params }), [])
  // exit longer than entry: the sell low must look back `exit` candles, like decide().
  const long = { entry: 2, exit: 4 }
  const [, wide] = breakout.levels({ candles: candles([3, 6, 7, 8, 9]), params: long })
  assert.equal(wide.price, 3)
  assert.equal(breakout.decide({ candles: candles([3, 6, 7, 8, 2.5]), position: 1, params: long }).side, 'sell')
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
