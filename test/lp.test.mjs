import assert from 'node:assert/strict'
import { test } from 'node:test'

const { liquidityFor, planRange, priceToTick, rangeAction, rangeAmounts, tickToPrice } = await import('../src/lp.mjs')

// WBTC (8 decimals) / USDT (6 decimals), 0.3% pool.
const pool = { spacing: 60, dec0: 8, dec1: 6 }
const params = { rangeWidthPct: 1.5, offsetPct: 0.3, recenterPct: 2, cycle: 1 }
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≈ ${b}`)

test('ticks and prices round-trip', () => {
  near(tickToPrice(priceToTick(77_000, pool), pool), 77_000)
})

test('a USDT range sits below the price, aligned to tick spacing', () => {
  const price = 77_000
  const tick = Math.floor(priceToTick(price, pool))
  const r = planRange('usdt', price, tick, params, pool)
  assert.ok(r.tickUpper <= tick, 'USDT-only needs tickUpper <= current tick')
  assert.equal(r.tickUpper % 60, 0)
  assert.equal(r.tickLower % 60, 0)
  assert.ok(r.upper <= price * (1 - params.offsetPct / 100) * 1.0001)
  assert.ok(r.lower < r.upper)
})

test('a coin range sits above max(price, entry)', () => {
  const price = 77_000
  const tick = Math.floor(priceToTick(price, pool))
  const r = planRange('asset', price, tick, params, pool, 78_000)
  assert.ok(r.tickLower > tick, 'coin-only needs tickLower > current tick')
  assert.ok(r.lower >= 78_000 * (1 + params.offsetPct / 100))
})

test('range amounts: all USDT above, all coin below, value conserved at the edges', () => {
  const [lower, upper] = [75_000, 76_000]
  const L = liquidityFor('usdt', 1, lower, upper)
  near(rangeAmounts(L, 77_000, lower, upper).usdt, 1)
  near(rangeAmounts(L, 77_000, lower, upper).asset, 0)
  const below = rangeAmounts(L, 74_000, lower, upper)
  near(below.usdt, 0)
  // Filled at the range's geometric mean price, plus nothing for slippage.
  near(1 / below.asset, Math.sqrt(lower * upper), 1e-9)
  const mid = rangeAmounts(L, 75_500, lower, upper)
  assert.ok(mid.usdt > 0 && mid.asset > 0)
})

test('rangeAction: filled when crossed, recenter when left behind', () => {
  const lp = { side: 'usdt', lower: 75_000, upper: 76_000 }
  assert.equal(rangeAction(lp, 74_900, params), 'filled')
  assert.equal(rangeAction(lp, 75_500, params), null)
  assert.equal(rangeAction(lp, 76_500, params), null)
  assert.equal(rangeAction(lp, 76_000 * 1.024, params), 'recenter')
  assert.equal(rangeAction({ side: 'asset', lower: 78_000, upper: 79_000 }, 79_100, params), 'filled')
})
