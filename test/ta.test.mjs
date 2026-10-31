import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fillGaps } from '../src/candles.mjs'
import bbands from '../src/ta/indicators/bbands.mjs'
import macd from '../src/ta/indicators/macd.mjs'
import rsi from '../src/ta/indicators/rsi.mjs'
import { ema, sma } from '../src/ta/math.mjs'

const candles = (closes) => closes.map((close, i) => ({ time: i * 60, open: close, high: close, low: close, close, volume: 0 }))
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`)

test('sma', () => {
  assert.deepEqual(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4])
})

test('ema is seeded with the sma', () => {
  const out = ema([1, 2, 3, 4, 5], 3)
  assert.deepEqual(out.slice(0, 2), [null, null])
  close(out[2], 2)
  close(out[3], 3) // 4*0.5 + 2*0.5
  close(out[4], 4)
})

test('rsi: only gains is 100, only losses is 0, flat is 50', () => {
  const p = rsi.defaults
  assert.equal(rsi.compute(candles([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]), p).value, 100)
  assert.equal(rsi.compute(candles([16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]), p).value, 0)
  assert.equal(rsi.compute(candles(new Array(16).fill(5)), p).value, 50)
})

test('rsi matches the Wilder reference values', () => {
  // StockCharts' RSI(14) example. They publish 70.53 using averages rounded to
  // 0.24 / 0.10; the unrounded averages (3.34/14, 1.40/14) give 70.46.
  const data = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28]
  close(rsi.compute(candles(data), rsi.defaults).value, 70.464, 0.001)
})

test('macd is positive in an uptrend', () => {
  const up = candles(Array.from({ length: 60 }, (_, i) => 100 + i))
  const r = macd.compute(up, macd.defaults)
  assert.ok(r.value > 0)
  assert.ok(Number.isFinite(r.histogram))
})

test('bbands collapse on a flat series', () => {
  const r = bbands.compute(candles(new Array(20).fill(7)), bbands.defaults)
  assert.equal(r.upper, 7)
  assert.equal(r.lower, 7)
  assert.equal(r.signal, 'inside')
})

test('fillGaps carries the last close forward', () => {
  const out = fillGaps(
    [
      { time: 0, open: 1, high: 2, low: 1, close: 2, volume: 5 },
      { time: 180, open: 3, high: 3, low: 3, close: 3, volume: 1 },
    ],
    60,
  )
  assert.deepEqual(out.map((c) => c.time), [0, 60, 120, 180])
  assert.equal(out[1].close, 2)
  assert.equal(out[1].volume, 0)
})

test('fillGaps extends flat candles up to the current bucket', () => {
  const out = fillGaps([{ time: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 }], 60, 200)
  assert.deepEqual(out.map((c) => c.time), [0, 60, 120, 180])
  assert.equal(out.at(-1).close, 1)
})
