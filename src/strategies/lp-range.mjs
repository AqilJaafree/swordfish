// One-sided liquidity on the coin/USDT V3 pool (see src/lp.mjs). The engine
// runs it instead of decide(): deposit USDT in a range just below the price
// (a limit buy that earns the 0.3% pool fee as it fills); once filled, put the
// coin in a range above the entry to sell it back (cycle=1) or hold it (cycle=0).

export default {
  name: 'lp-range',
  description: 'Liquidity: USDT-only range just below the price earns pool fees and buys as price dips; then sells back from a range above entry.',
  lp: true,
  defaults: { rangeWidthPct: 1.5, offsetPct: 0.3, recenterPct: 2, cycle: 1 },
  decide() {
    return { reason: 'lp-range is run by the LP engine' }
  },
}
