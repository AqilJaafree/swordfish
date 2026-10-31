// Pluggable technical analysis.
//
// A plugin is an ES module whose default export is:
//   {
//     name: 'rsi',
//     defaults: { period: 14 },               // overridable via TA_RSI_PERIOD or ?rsi.period=
//     minCandles: (params) => params.period + 1,
//     compute(candles, params) -> { value, signal?, ...extra }
//   }
// TA_INDICATORS lists built-in names (./indicators/<name>.mjs) or paths to
// plugin files (relative to the working directory).

import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { config, envParamsFor } from '../config.mjs'

const BUILTIN = /^[a-z0-9_-]+$/i

async function load(spec) {
  const url = BUILTIN.test(spec)
    ? new URL(`./indicators/${spec}.mjs`, import.meta.url)
    : pathToFileURL(resolve(process.cwd(), spec))
  const mod = await import(url.href)
  const plugin = mod.default
  if (!plugin?.name || typeof plugin.compute !== 'function') {
    throw new Error(`TA plugin ${spec} must default-export { name, compute }`)
  }
  return { defaults: {}, minCandles: () => 1, ...plugin, envParams: envParamsFor(plugin.name) }
}

let plugins = []

export async function loadPlugins() {
  if (!config.ta.enabled) return []
  plugins = await Promise.all(config.ta.indicators.map(load))
  return plugins
}

export const enabledPlugins = () => plugins

// overrides: { rsi: { period: 21 } } from the query string
export function analyze(candles, overrides = {}) {
  const out = {}
  for (const p of plugins) {
    const params = { ...p.defaults, ...p.envParams, ...overrides[p.name] }
    const need = p.minCandles(params)
    if (candles.length < need) {
      out[p.name] = { params, value: null, note: `needs ${need} candles, have ${candles.length}` }
      continue
    }
    try {
      out[p.name] = { params, ...p.compute(candles, params) }
    } catch (err) {
      out[p.name] = { params, value: null, error: err.message }
    }
  }
  return out
}
