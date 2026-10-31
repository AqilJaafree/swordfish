// Telegram front end (grammY, long polling). Each Telegram user gets a
// custodial HashKey wallet and can run paper or live bots.

import { Bot, GrammyError, HttpError } from 'grammy'
import { config } from './config.mjs'
import * as db from './db.mjs'
import { catalog, closeBot, createBotFor, events, goLive, ownedBot, RISK_DEFAULTS, setStatus, walletBalances, withdraw } from './engine.mjs'
import { createWallet, exportKey } from './vault.mjs'

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
const usd = (n) => (n == null ? '-' : `$${Number(n).toFixed(2)}`)
const pct = (n) => (n == null ? '-' : `${n >= 0 ? '+' : ''}${Number(n).toFixed(2)}%`)
const explorer = (path) => `https://hsk.blockscout.com/${path}`

const HELP = `<b>Swordfish</b>: strategy bots on HashKey Chain.

/wallet: your bot wallet and balances
/strategies: available strategies
/newbot &lt;strategy&gt; &lt;assets&gt; [timeframe] [param=value ...]
   e.g. <code>/newbot sma-cross btc,eth 1h stopLossPct=5</code>
/bots: your bots
/bot &lt;id&gt;: details and recent trades
/stop &lt;id&gt; · /resume &lt;id&gt; · /close &lt;id&gt; (sell all and stop)
/live &lt;id&gt; &lt;budgetUSDT&gt;: switch a bot to real money
/leaderboard: top bots
/web: log in to the dashboard
/withdraw &lt;asset&gt; &lt;amount&gt; &lt;address&gt;
/export: reveal your wallet private key

New bots paper-trade with $${config.bots.paperStartUsdt}. Live bots trade real funds from your wallet.`

function userOf(ctx) {
  const user = db.upsertUser(ctx.from.id, ctx.from.username ?? ctx.from.first_name)
  if (!db.getWallet(user.id)) db.saveWallet(user.id, createWallet())
  return user
}

const args = (ctx) => (ctx.match ?? '').toString().trim().split(/\s+/).filter(Boolean)

function botLine(b) {
  const status = b.status === 'halted' ? `halted (${esc(b.halted_reason)})` : b.status
  return `#${b.id} <b>${esc(b.name)}</b>\n   ${b.strategy} · ${b.assets.join(',')} · ${b.timeframe} · ${b.mode.toUpperCase()} · ${status}\n   equity ${usd(b.equity_usd)} (${pct(b.pnl_pct)}) · ${b.trades} trades`
}

export function startTelegram() {
  if (!config.telegramToken) return null
  const bot = new Bot(config.telegramToken)
  const reply = (ctx, text, extra = {}) => ctx.reply(text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra })

  // Wallet and bot commands only work in a private chat with the bot.
  bot.use(async (ctx, next) => {
    const cmd = ctx.message?.text?.split(/[\s@]/)[0]
    if (ctx.chat?.type !== 'private' && cmd && !['/leaderboard', '/strategies', '/help'].includes(cmd)) {
      return reply(ctx, 'Message me privately for wallet and bot commands.')
    }
    return next()
  })

  bot.command(['start', 'help'], async (ctx) => {
    const user = userOf(ctx)
    const w = db.getWallet(user.id)
    await reply(ctx, `${HELP}\n\nYour wallet: <code>${w.address}</code>`)
  })

  bot.command('wallet', async (ctx) => {
    const w = db.getWallet(userOf(ctx).id)
    const bal = await walletBalances(w.address)
    await reply(
      ctx,
      `<b>Wallet</b> <code>${w.address}</code>\n` +
        Object.entries(bal).map(([k, v]) => `${k.toUpperCase()}: ${v}`).join('\n') +
        `\n\nDeposit USDT (and ≥${config.bots.minGasHsk} HSK for gas) on HashKey Chain to trade live.\n<a href="${explorer(`address/${w.address}`)}">View on Blockscout</a>`,
    )
  })

  bot.command('strategies', async (ctx) => {
    const lines = catalog().map((s) => `<b>${s.name}</b>${s.llm ? ' (Claude Haiku)' : ''}: ${esc(s.description)}${Object.keys(s.params).length ? `\n   params: ${esc(JSON.stringify(s.params))}` : ''}`)
    await reply(ctx, `${lines.join('\n\n')}\n\n<b>Exit rules for any bot</b> (0 = off): ${esc(JSON.stringify(RISK_DEFAULTS))}`)
  })

  bot.command('newbot', async (ctx) => {
    const user = userOf(ctx)
    const [strategy, assets, ...rest] = args(ctx)
    if (!strategy || !assets) return reply(ctx, 'Usage: <code>/newbot sma-cross btc,eth 1h stopLossPct=5</code>')
    const timeframe = rest[0] && !rest[0].includes('=') ? rest.shift() : '1h'
    const params = Object.fromEntries(rest.map((kv) => kv.split('=')))
    const b = createBotFor(user, { strategy, assets, timeframe, params })
    await reply(ctx, `Created paper bot:\n${botLine(b)}\n\nIt checks every ${b.interval_sec / 60} min. Go live with <code>/live ${b.id} 50</code>.`)
  })

  bot.command('bots', async (ctx) => {
    const bots = db.userBots(userOf(ctx).id)
    await reply(ctx, bots.length ? bots.map(botLine).join('\n\n') : 'No bots yet. Try <code>/newbot sma-cross btc,eth 1h</code>')
  })

  bot.command('bot', async (ctx) => {
    const b = ownedBot(userOf(ctx), args(ctx)[0])
    const trades = db.botTrades(b.id, 5)
    const last = db.botDecisions(b.id, 2)
    const positions = Object.entries(b.positions).map(([a, q]) => `${a}: ${q}`).join(', ') || 'none'
    await reply(
      ctx,
      `${botLine(b)}\n   cash ${usd(b.cash)} · positions ${esc(positions)}\n   params ${esc(JSON.stringify(b.params))}\n\n<b>Recent trades</b>\n` +
        (trades.map((t) => `${t.time.slice(5, 16)} ${t.side} ${t.asset} ${usd(t.usdt)} @ ${t.exec_price.toPrecision(6)}${t.tx_hash ? ` <a href="${explorer(`tx/${t.tx_hash}`)}">tx</a>` : ''}`).join('\n') || 'none') +
        `\n\n<b>Last decisions</b>\n` +
        (last.map((d) => `${d.asset}: ${esc(d.error ?? d.reason ?? '').slice(0, 300)}`).join('\n') || 'none'),
    )
  })

  for (const [cmd, status] of [['stop', 'stopped'], ['resume', 'running']]) {
    bot.command(cmd, async (ctx) => {
      const b = setStatus(ownedBot(userOf(ctx), args(ctx)[0]), status)
      await reply(ctx, `Bot #${b.id} is now ${b.status}.`)
    })
  }

  bot.command('close', async (ctx) => {
    const b = ownedBot(userOf(ctx), args(ctx)[0])
    await reply(ctx, `Closing bot #${b.id}: selling all positions...`)
    const results = await closeBot(b)
    await reply(ctx, results.map((r) => (r.error ? `${r.asset}: failed, ${esc(r.error)}` : `sold ${r.asset} for ${usd(r.usdt)}`)).join('\n') || 'No positions. Bot stopped.')
  })

  bot.command('live', async (ctx) => {
    const user = userOf(ctx)
    const [id, budget, confirm] = args(ctx)
    const b = ownedBot(user, id)
    if (!budget) return reply(ctx, `Usage: <code>/live ${b.id} 50</code> (USDT budget, max ${config.bots.liveMaxBudgetUsd})`)
    if (confirm !== 'confirm') {
      return reply(
        ctx,
        `⚠️ Bot #${b.id} will trade <b>real funds</b> from your wallet: ${budget} USDT budget, up to ${usd(Math.min(b.params.tradeUsd ?? RISK_DEFAULTS.tradeUsd, config.bots.liveMaxTradeUsd))} per trade, max ${config.bots.liveMaxImpactPct}% price impact, halts after a ${config.bots.liveDailyLossPct}% daily loss. Its paper history is reset.\n\nSend <code>/live ${b.id} ${budget} confirm</code> to proceed.`,
      )
    }
    const live = await goLive(user, b, budget)
    await reply(ctx, `Bot #${live.id} is LIVE with ${usd(live.start_usdt)}.\n${botLine(live)}`)
  })

  bot.command('leaderboard', async (ctx) => {
    const mode = args(ctx)[0] === 'live' ? 'live' : 'paper'
    const rows = db.leaderboard(mode, 10)
    await reply(
      ctx,
      `<b>Leaderboard (${mode})</b>, P&amp;L after costs\n\n` +
        (rows.map((r, i) => `${i + 1}. ${pct(r.pnl_pct)} · #${r.id} ${esc(r.name)} by @${esc(r.username)} · ${r.strategy} · ${r.trades} trades`).join('\n') || 'No bots yet.') +
        `\n\n${mode === 'paper' ? '/leaderboard live' : '/leaderboard'} · <a href="${config.webUrl}">dashboard</a>`,
    )
  })

  bot.command('web', async (ctx) => {
    const token = db.issueToken(userOf(ctx).id, 'login', 10 * 60)
    await reply(ctx, `One-time login link (10 min):\n${config.webUrl}/auth/login?token=${token}`)
  })

  bot.command('withdraw', async (ctx) => {
    const user = userOf(ctx)
    const [asset, amount, to, confirm] = args(ctx)
    if (!to) return reply(ctx, 'Usage: <code>/withdraw usdt 25 0xYourAddress</code>')
    if (confirm !== 'confirm') return reply(ctx, `Send ${esc(amount)} ${esc(asset)} to <code>${esc(to)}</code>?\nReply <code>/withdraw ${esc(asset)} ${esc(amount)} ${esc(to)} confirm</code>`)
    const r = await withdraw(user, asset, amount, to)
    await reply(ctx, `Withdrawal ${r.status}: <a href="${explorer(`tx/${r.hash}`)}">${r.hash.slice(0, 18)}…</a>`)
  })

  bot.command('export', async (ctx) => {
    const w = db.getWallet(userOf(ctx).id)
    if (args(ctx)[0] !== 'confirm') {
      return reply(ctx, '⚠️ Anyone with the private key controls your funds. It will be shown once and deleted after 60 seconds.\nSend <code>/export confirm</code>.')
    }
    const msg = await reply(ctx, `<tg-spoiler><code>${exportKey(w)}</code></tg-spoiler>\nSave it offline now; this message deletes in 60s.`)
    setTimeout(() => ctx.api.deleteMessage(ctx.chat.id, msg.message_id).catch(() => {}), 60_000)
    setTimeout(() => ctx.api.deleteMessage(ctx.chat.id, ctx.message.message_id).catch(() => {}), 60_000)
  })

  bot.catch(async ({ ctx, error }) => {
    const message = error instanceof GrammyError || error instanceof HttpError ? 'Telegram error' : error.message
    if (!error.status) console.error(`telegram: ${error.stack ?? error}`)
    await ctx.reply(`⚠️ ${message}`).catch(() => {})
  })

  // Trade and halt notifications to the bot's owner.
  const notify = (b, text) => {
    const user = db.getUser(b.user_id)
    if (user) bot.api.sendMessage(user.tg_id, text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }).catch(() => {})
  }
  events.on('trade', ({ bot: b, trade: t }) =>
    notify(
      b,
      `${t.side === 'buy' ? '🟢' : '🔴'} #${b.id} ${b.mode.toUpperCase()} ${t.side} ${t.quantity.toPrecision(6)} ${t.asset} for ${usd(t.usdt)} @ ${t.execPrice.toPrecision(6)}` +
        (t.realizedPnlUsd != null ? ` · P&amp;L ${usd(t.realizedPnlUsd)}` : '') +
        (t.txHash ? ` · <a href="${explorer(`tx/${t.txHash}`)}">tx</a>` : '') +
        `\n${esc(t.reason ?? '').slice(0, 300)}`,
    ),
  )
  events.on('halt', ({ bot: b, reason }) => notify(b, `⛔ Bot #${b.id} halted: ${esc(reason)}. Positions are kept; /close ${b.id} to sell or /resume ${b.id}.`))

  bot.api.setMyCommands([
    { command: 'wallet', description: 'Wallet address and balances' },
    { command: 'strategies', description: 'Available strategies' },
    { command: 'newbot', description: 'Create a paper bot' },
    { command: 'bots', description: 'Your bots' },
    { command: 'leaderboard', description: 'Top bots' },
    { command: 'web', description: 'Dashboard login link' },
    { command: 'help', description: 'All commands' },
  ]).catch(() => {})
  bot.start({ drop_pending_updates: true, onStart: (me) => {
    config.telegramUsername = me.username
    console.log(`telegram: @${me.username} polling`)
  } })
  return bot
}
