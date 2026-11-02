// Telegram front end (grammY, long polling). Each Telegram user gets a
// custodial HashKey wallet and can run paper or live bots.

import { Bot, GrammyError, HttpError, InlineKeyboard } from 'grammy'
import { config, telegramAllowed } from './config.mjs'
import * as db from './db.mjs'
import { catalog, closeBot, createBotFor, deleteBot, deleteWallet, events, goLive, importWallet, ownedBot, RISK_DEFAULTS, setStatus, walletBalances, withdraw, withdrawAll } from './engine.mjs'
import { createWallet, exportKey } from './vault.mjs'
import { findAsset } from './assets.mjs'
import { approveLogin, denyLogin, loginPending, markLoginOpened } from './auth.mjs'

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
const usd = (n) => (n == null ? '-' : `$${Number(n).toFixed(2)}`)
const pct = (n) => (n == null ? '-' : `${n >= 0 ? '+' : ''}${Number(n).toFixed(2)}%`)
const explorer = (path) => `https://hsk.blockscout.com/${path}`

const HELP = `<b>Swordfish</b>: strategy bots on HashKey Chain.

/start: menu with buttons
/wallet: your bot wallet and balances
/strategies: available strategies
/newbot &lt;strategy&gt; &lt;assets&gt; [timeframe] [param=value ...]
   e.g. <code>/newbot sma-cross btc,eth 1h stopLossPct=5</code>
/bots: your bots
/bot &lt;id&gt;: details and recent trades
/stop &lt;id&gt; · /resume &lt;id&gt; · /close &lt;id&gt; (sell all and stop)
/deletebot &lt;id&gt;: delete a bot and its history
/live &lt;id&gt; &lt;budgetUSDT&gt;: switch a bot to real money
/leaderboard: top bots
/web: log in to the dashboard
/withdraw &lt;asset&gt; &lt;amount|max&gt; &lt;address&gt;
/withdraw all &lt;address&gt;: send everything out
/export: reveal your wallet private key
/importwallet &lt;privateKey&gt;: use your own wallet instead
/deletewallet: delete your bot wallet

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

// --- screens (shared by commands and buttons) -----------------------------------
// Each returns { text, kb }. Callback data: m:<menu>, b:<id>[:action], n:<strategy>[:assets[:tf]], lb:<mode>, w:<action>.

const balancesLine = (bal) => Object.entries(bal).map(([k, v]) => `${k.toUpperCase()} ${v}`).join(' · ')
const back = (kb, to = 'm:menu', label = '⬅ Menu') => kb.row().text(label, to)

function menuScreen(user) {
  const w = db.getWallet(user.id)
  return {
    text: `<b>Swordfish</b>: strategy bots on HashKey Chain.\nWallet <code>${w.address}</code>\n\nPick an option, or send /help for typed commands.`,
    kb: new InlineKeyboard()
      .text('💼 Wallet', 'm:wallet').text('🤖 My bots', 'm:bots').row()
      .text('➕ New bot', 'm:new').text('📚 Strategies', 'm:strategies').row()
      .text('🏆 Leaderboard', 'lb:paper').text('🌐 Dashboard', 'm:web').row()
      .text('❓ Help', 'm:help'),
  }
}

function loginScreen(code) {
  if (!loginPending(code)) return { text: 'This sign-in request has expired. Click <b>Log in</b> on the dashboard to start again.', kb: new InlineKeyboard().text('📋 Menu', 'm:menu') }
  return {
    text: '🔐 <b>Dashboard sign-in</b>\nA browser asked to sign in to Swordfish as you.\n\nApprove only if you just clicked <b>Log in</b> on your own dashboard. The request expires in 10 minutes.',
    kb: new InlineKeyboard().text('✅ Approve sign-in', `auth:${code}`).text('Cancel', `authx:${code}`),
  }
}

async function walletScreen(user) {
  const w = db.getWallet(user.id)
  const bal = await walletBalances(w.address)
  return {
    text:
      `<b>Wallet</b> <code>${w.address}</code>\n${Object.entries(bal).map(([k, v]) => `${k.toUpperCase()}: ${v}`).join('\n')}` +
      `\n\nDeposit USDT (and ≥${config.bots.minGasHsk} HSK for gas) on HashKey Chain to trade live.\n<a href="${explorer(`address/${w.address}`)}">View on Blockscout</a>`,
    kb: back(new InlineKeyboard().text('🔄 Refresh', 'm:wallet').text('📤 Withdraw', 'w:withdraw').row().text('🔑 Export key', 'w:export').text('🗑 Delete wallet', 'w:delete')),
  }
}

function botsScreen(user) {
  const bots = db.userBots(user.id)
  const kb = new InlineKeyboard()
  for (const b of bots) kb.text(`#${b.id} ${b.strategy} · ${b.mode === 'live' ? 'LIVE' : 'paper'} · ${pct(b.pnl_pct)}${b.status === 'running' ? '' : ` · ${b.status}`}`, `b:${b.id}`).row()
  kb.text('➕ New bot', 'm:new')
  return { text: bots.length ? `<b>Your bots</b>\n\n${bots.map(botLine).join('\n\n')}` : 'No bots yet.', kb: back(kb) }
}

function botScreen(b) {
  const trades = db.botTrades(b.id, 5)
  const last = db.botDecisions(b.id, 2)
  const positions = Object.entries(b.positions).map(([a, q]) => `${a}: ${q}`).join(', ') || 'none'
  const lp = b.lp?.range ? `\n   LP ${b.lp.range.side === 'usdt' ? 'buy' : 'sell'} range ${b.lp.range.lower.toPrecision(6)}–${b.lp.range.upper.toPrecision(6)} · fees ${usd(b.lp.feesUsd)}` : ''
  const kb = new InlineKeyboard()
    .text(b.status === 'running' ? '⏸ Stop' : '▶ Resume', `b:${b.id}:${b.status === 'running' ? 'stop' : 'resume'}`).text('🔄 Refresh', `b:${b.id}`).row()
    .text('💰 Close (sell all)', `b:${b.id}:close`).text('🗑 Delete', `b:${b.id}:del`)
  if (b.mode === 'paper') kb.row().text('🚀 Go live', `b:${b.id}:live`)
  return {
    text:
      `${botLine(b)}\n   cash ${usd(b.cash)} · positions ${esc(positions)}${lp}\n   params ${esc(JSON.stringify(b.params))}\n\n<b>Recent trades</b>\n` +
      (trades.map((t) => `${t.time.slice(5, 16)} ${t.side} ${t.asset} ${usd(t.usdt)} @ ${t.exec_price.toPrecision(6)}${t.tx_hash ? ` <a href="${explorer(`tx/${t.tx_hash}`)}">tx</a>` : ''}`).join('\n') || 'none') +
      `\n\n<b>Last decisions</b>\n` +
      (last.map((d) => `${d.asset}: ${esc(d.error ?? d.reason ?? '').slice(0, 300)}`).join('\n') || 'none'),
    kb: back(kb, 'm:bots', '⬅ My bots'),
  }
}

const confirmKb = (yes, no, label = '✅ Yes') => new InlineKeyboard().text(label, yes).text('✖ Cancel', no)

function liveScreen(b, budget) {
  const perTrade = usd(Math.min(b.params.tradeUsd ?? RISK_DEFAULTS.tradeUsd, config.bots.liveMaxTradeUsd))
  if (!budget) {
    const amounts = [1, 5, 10, 25, 50, 100, 250, 500].filter((a) => a <= config.bots.liveMaxBudgetUsd)
    const kb = new InlineKeyboard()
    for (const [i, a] of amounts.entries()) {
      kb.text(`${a} USDT`, `b:${b.id}:live:${a}`)
      if (i % 4 === 3) kb.row()
    }
    return { text: `🚀 Pick a USDT budget for bot #${b.id} (max ${config.bots.liveMaxBudgetUsd}). The wallet needs that much USDT and ≥${config.bots.minGasHsk} HSK for gas.\nOther amounts: <code>/live ${b.id} 3</code>`, kb: back(kb, `b:${b.id}`, '✖ Cancel') }
  }
  return {
    text: `⚠️ Bot #${b.id} will trade <b>real funds</b> from your wallet: ${budget} USDT budget, up to ${perTrade} per trade, max ${config.bots.liveMaxImpactPct}% price impact, halts after a ${config.bots.liveDailyLossPct}% daily loss. Its paper history is reset.`,
    kb: confirmKb(`b:${b.id}:liveok:${budget}`, `b:${b.id}`, '🚀 Go live'),
  }
}

function leaderboardScreen(mode) {
  const rows = db.leaderboard(mode, 10)
  return {
    text:
      `<b>Leaderboard (${mode})</b>, P&amp;L after costs\n\n` +
      (rows.map((r, i) => `${i + 1}. ${pct(r.pnl_pct)} · #${r.id} ${esc(r.name)} by @${esc(r.username)} · ${r.strategy} · ${r.trades} trades`).join('\n') || 'No bots yet.'),
    kb: back(new InlineKeyboard().text(mode === 'paper' ? '• Paper' : 'Paper', 'lb:paper').text(mode === 'live' ? '• Live' : 'Live', 'lb:live')),
  }
}

function strategiesScreen() {
  const lines = catalog().map((s) => `<b>${s.name}</b>${s.llm && s.model ? ` (${esc(s.model)})` : ''}: ${esc(s.description)}${Object.keys(s.params).length ? `\n   params: ${esc(JSON.stringify(s.params))}` : ''}`)
  return { text: `${lines.join('\n\n')}\n\n<b>Exit rules for any bot</b> (0 = off): ${esc(JSON.stringify(RISK_DEFAULTS))}`, kb: back(new InlineKeyboard().text('➕ New bot', 'm:new')) }
}

// New-bot wizard: strategy -> assets -> timeframe -> paper bot.
function newBotScreen(strategy, assets) {
  const kb = new InlineKeyboard()
  if (!strategy) {
    for (const [i, s] of catalog().entries()) {
      kb.text(s.name, `n:${s.name}`)
      if (i % 2) kb.row()
    }
    return { text: '➕ <b>New paper bot</b>\nStep 1/3: pick a strategy. (Details under 📚 Strategies.)', kb: back(kb) }
  }
  const s = catalog().find((x) => x.name === strategy)
  if (!s) throw Object.assign(new Error(`Unknown strategy ${strategy}`), { status: 400 })
  if (!assets) {
    kb.text('BTC', `n:${strategy}:wbtc`).text('ETH', `n:${strategy}:weth`)
    if (!s.lp) kb.text('BTC + ETH', `n:${strategy}:wbtc,weth`).text('HSK', `n:${strategy}:hsk`)
    return { text: `➕ <b>${strategy}</b>\nStep 2/3: pick what it trades.${s.lp ? ' (Liquidity bots run on one coin.)' : ''}`, kb: back(kb, 'm:new', '⬅ Back') }
  }
  for (const tf of ['15m', '1h', '4h', '1d']) kb.text(tf, `n:${strategy}:${assets}:${tf}`)
  const names = assets.split(',').map((a) => findAsset(a)?.symbol ?? a).join(' + ')
  return { text: `➕ <b>${strategy}</b> on ${esc(names)}\nStep 3/3: pick the candle timeframe it reads (1h is a good default).`, kb: back(kb, `n:${strategy}`, '⬅ Back') }
}

/** Build the bot and start long polling. `start: false` (tests) only builds it. */
export function startTelegram({ start = true, botInfo } = {}) {
  if (!config.telegramToken) return null
  const bot = new Bot(config.telegramToken, botInfo ? { botInfo } : undefined)
  const reply = (ctx, text, extra = {}) => ctx.reply(text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra })
  const send = (ctx, { text, kb }) => reply(ctx, text, { reply_markup: kb })
  // From a button: replace the message in place; from a command: send a new one.
  const show = async (ctx, screen) => {
    if (!ctx.callbackQuery) return send(ctx, screen)
    await ctx.editMessageText(screen.text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: screen.kb }).catch((err) => {
      if (!/not modified/.test(err.description ?? '')) throw err
    })
  }

  // Only allowlisted accounts (TELEGRAM_ALLOWED_USERS) can use the bot.
  bot.use(async (ctx, next) => {
    if (!ctx.from || !telegramAllowed(ctx.from.id, ctx.from.username)) {
      // Show the ID so the person can pass it to whoever runs this bot to be added.
      if (ctx.chat?.type === 'private' && ctx.from) {
        await reply(ctx, `Swordfish is invite-only for now.\n\nTo get access, send this to the person who invited you:\n<code>${ctx.from.id}</code>${ctx.from.username ? ` (@${ctx.from.username})` : ''}`)
      }
      return
    }
    return next()
  })

  // Wallet and bot commands only work in a private chat with the bot.
  bot.use(async (ctx, next) => {
    const cmd = ctx.message?.text?.split(/[\s@]/)[0]
    if (ctx.chat?.type !== 'private' && cmd && !['/leaderboard', '/strategies', '/help'].includes(cmd)) {
      if (cmd === '/importwallet') await ctx.deleteMessage().catch(() => {})
      return reply(ctx, 'Message me privately for wallet and bot commands.')
    }
    const data = ctx.callbackQuery?.data
    if (data && ctx.chat?.type !== 'private' && !/^(lb:|m:strategies)/.test(data)) {
      return ctx.answerCallbackQuery({ text: 'Message me privately for wallet and bot controls.', show_alert: true })
    }
    return next()
  })

  // /start login_<code> comes from the dashboard's Log in button.
  bot.command(['start', 'menu'], (ctx) => {
    const user = userOf(ctx)
    const payload = args(ctx)[0] ?? ''
    if (!payload.startsWith('login_')) return send(ctx, menuScreen(user))
    markLoginOpened(payload.slice(6))
    return send(ctx, loginScreen(payload.slice(6)))
  })
  bot.command('help', (ctx) => reply(ctx, HELP, { reply_markup: new InlineKeyboard().text('📋 Menu', 'm:menu') }))
  bot.command('wallet', async (ctx) => send(ctx, await walletScreen(userOf(ctx))))
  bot.command('strategies', (ctx) => send(ctx, strategiesScreen()))

  bot.command('newbot', async (ctx) => {
    const user = userOf(ctx)
    const [strategy, assets, ...rest] = args(ctx)
    if (!strategy) return send(ctx, newBotScreen())
    if (!assets) return send(ctx, newBotScreen(strategy))
    const timeframe = rest[0] && !rest[0].includes('=') ? rest.shift() : '1h'
    const params = Object.fromEntries(rest.map((kv) => kv.split('=')))
    const b = createBotFor(user, { strategy, assets, timeframe, params })
    await send(ctx, botScreen(b))
  })

  bot.command('bots', (ctx) => send(ctx, botsScreen(userOf(ctx))))
  bot.command('bot', (ctx) => {
    const [id] = args(ctx)
    return send(ctx, id ? botScreen(ownedBot(userOf(ctx), id)) : botsScreen(userOf(ctx)))
  })

  for (const [cmd, status] of [['stop', 'stopped'], ['resume', 'running']]) {
    bot.command(cmd, async (ctx) => {
      const b = setStatus(ownedBot(userOf(ctx), args(ctx)[0]), status)
      await reply(ctx, `Bot #${b.id} is now ${b.status}.`)
    })
  }

  const closeSummary = (results) =>
    results.map((r) => (r.error ? `${r.asset}: failed, ${esc(r.error)}` : `${r.side === 'buy' ? 'bought' : 'sold'} ${r.asset} for ${usd(r.usdt)}`)).join('\n') || 'No positions. Bot stopped.'
  bot.command('close', async (ctx) => {
    const b = ownedBot(userOf(ctx), args(ctx)[0])
    await reply(ctx, `Closing bot #${b.id}: selling all positions...`)
    await reply(ctx, closeSummary(await closeBot(b)))
  })

  bot.command('live', async (ctx) => {
    const user = userOf(ctx)
    const [id, budget, confirm] = args(ctx)
    const b = ownedBot(user, id)
    if (!budget || confirm !== 'confirm') return send(ctx, liveScreen(b, budget))
    const live = await goLive(user, b, budget)
    await reply(ctx, `Bot #${live.id} is LIVE with ${usd(live.start_usdt)}.\n${botLine(live)}`)
  })

  bot.command('leaderboard', (ctx) => send(ctx, leaderboardScreen(args(ctx)[0] === 'live' ? 'live' : 'paper')))

  const webLink = (ctx) => reply(ctx, `One-time login link (10 min):\n${config.webUrl}/auth/login?token=${db.issueToken(userOf(ctx).id, 'login', 10 * 60)}`)
  bot.command('web', webLink)

  const sent = (r) => (r.error ? `${r.asset.toUpperCase()}: ${esc(r.error)}` : `${r.amount} ${r.asset.toUpperCase()} ${r.status}: <a href="${explorer(`tx/${r.hash}`)}">${r.hash.slice(0, 14)}…</a>`)
  bot.command('withdraw', async (ctx) => {
    const user = userOf(ctx)
    const a = args(ctx)
    if (a[0]?.toLowerCase() === 'all') {
      const [, to, confirm] = a
      if (!to) return reply(ctx, 'Usage: <code>/withdraw all 0xYourAddress</code>')
      if (confirm !== 'confirm') {
        return reply(ctx, `Send <b>everything</b> in your bot wallet (USDT, WBTC, WETH, then HSK minus gas) to <code>${esc(to)}</code>? Funds used by running live bots stay.\nReply <code>/withdraw all ${esc(to)} confirm</code>`)
      }
      await reply(ctx, 'Withdrawing…')
      const results = await withdrawAll(user, to)
      return reply(ctx, results.map(sent).join('\n') || 'Nothing to withdraw.')
    }
    const [asset, amount, to, confirm] = a
    if (!to) return reply(ctx, 'Usage: <code>/withdraw usdt 25 0xYourAddress</code> (amount or <code>max</code>), or <code>/withdraw all 0xYourAddress</code>')
    if (confirm !== 'confirm') return reply(ctx, `Send ${esc(amount)} ${esc(asset)} to <code>${esc(to)}</code>?\nReply <code>/withdraw ${esc(asset)} ${esc(amount)} ${esc(to)} confirm</code>`)
    await reply(ctx, sent(await withdraw(user, asset, amount, to)))
  })

  const deleteBotScreen = (b) => ({
    text: `Delete bot #${b.id} <b>${esc(b.name)}</b> (${b.mode.toUpperCase()}, ${b.trades} trades) and its history? It leaves the leaderboard.`,
    kb: confirmKb(`b:${b.id}:delok`, `b:${b.id}`, '🗑 Delete'),
  })
  bot.command('deletebot', async (ctx) => {
    const [id, confirm] = args(ctx)
    if (!id) return reply(ctx, 'Usage: <code>/deletebot 7</code>')
    const b = ownedBot(userOf(ctx), id)
    if (confirm !== 'confirm') return send(ctx, deleteBotScreen(b))
    await deleteBot(b)
    await reply(ctx, `Bot #${b.id} deleted.`)
  })

  bot.command('importwallet', async (ctx) => {
    const [key] = args(ctx)
    // The key is in the user's message: delete it before doing anything else.
    if (key) await ctx.deleteMessage().catch(() => {})
    if (!key) {
      return reply(
        ctx,
        'Use your own wallet for bots: <code>/importwallet 0xYourPrivateKey</code>\n\n' +
          '• Use a wallet made for trading, not your main one: the key passes through Telegram.\n' +
          '• Your message is deleted right away and the key is stored encrypted.\n' +
          '• Your current bot wallet must be empty with no live bots (withdraw it first).',
      )
    }
    try {
      const r = await importWallet(userOf(ctx), key)
      await reply(ctx, `✅ Imported <code>${r.address}</code> (your message with the key was deleted).\nBalances: ${Object.entries(r.balances).map(([k, v]) => `${v} ${k.toUpperCase()}`).join(' · ')}`)
    } catch (err) {
      // Never echo the key: errors from importWallet don't contain it.
      const balances = err.balances ? '\nWithdraw first with <code>/withdraw all 0xYourAddress</code>, then import again.' : ''
      await reply(ctx, `Import failed: ${esc(err.message)}.${balances}${/key/i.test(err.message) ? '' : '\nYour message with the key was deleted.'}`)
    }
  })

  const deleteWalletScreen = async (w) => ({
    text:
      `⚠️ This permanently deletes the key for <code>${w.address}</code>. Swordfish cannot recover it.\nBalances: ${balancesLine(await walletBalances(w.address))}\n\n` +
      `First move funds out with <code>/withdraw all 0xYourAddress</code> (or save the key with 🔑 Export key) and delete any live bots. Your next command then creates a fresh wallet.`,
    kb: confirmKb('w:deleteok', 'm:wallet', '🗑 Delete wallet'),
  })
  const deleteWalletNow = async (user, abandonFunds) => {
    try {
      const r = await deleteWallet(user, { abandonFunds })
      return `Wallet <code>${r.address}</code> deleted${r.abandoned.length ? `; left behind ${r.abandoned.map(([k, v]) => `${v} ${k.toUpperCase()}`).join(', ')}` : ''}. Send /start for a new one.`
    } catch (err) {
      if (!err.balances) throw err
      return `${esc(err.message)}.\nWithdraw first with <code>/withdraw all 0xYourAddress</code>. To delete anyway and leave the funds (reachable only with a key saved via /export), send <code>/deletewallet confirm abandon</code>.`
    }
  }
  bot.command('deletewallet', async (ctx) => {
    const user = userOf(ctx)
    const w = db.getWallet(user.id)
    const [confirm, abandon] = args(ctx)
    if (confirm !== 'confirm') return send(ctx, await deleteWalletScreen(w))
    await reply(ctx, await deleteWalletNow(user, abandon === 'abandon'))
  })

  const exportScreen = {
    text: '⚠️ Anyone with the private key controls your funds. It is shown once and deleted after 60 seconds.',
    kb: confirmKb('w:exportok', 'm:wallet', '🔑 Show key'),
  }
  const showKey = async (ctx, w) => {
    const msg = await reply(ctx, `<tg-spoiler><code>${exportKey(w)}</code></tg-spoiler>\nSave it offline now; this message deletes in 60s.`)
    setTimeout(() => ctx.api.deleteMessage(ctx.chat.id, msg.message_id).catch(() => {}), 60_000)
  }
  bot.command('export', async (ctx) => {
    const w = db.getWallet(userOf(ctx).id)
    if (args(ctx)[0] !== 'confirm') return send(ctx, exportScreen)
    await showKey(ctx, w)
    setTimeout(() => ctx.api.deleteMessage(ctx.chat.id, ctx.message.message_id).catch(() => {}), 60_000)
  })

  // --- buttons -----------------------------------------------------------------------

  bot.on('callback_query:data', async (ctx) => {
    const [kind, a, b2, c] = ctx.callbackQuery.data.split(':')
    try {
      const user = userOf(ctx)
      if (kind === 'm') {
        if (a === 'menu') return void (await show(ctx, menuScreen(user)))
        if (a === 'wallet') return void (await show(ctx, await walletScreen(user)))
        if (a === 'bots') return void (await show(ctx, botsScreen(user)))
        if (a === 'new') return void (await show(ctx, newBotScreen()))
        if (a === 'strategies') return void (await show(ctx, strategiesScreen()))
        if (a === 'help') return void (await reply(ctx, HELP))
        if (a === 'web') return void (await webLink(ctx))
      }
      if (kind === 'auth') {
        const ok = approveLogin(a, user.id)
        await ctx.answerCallbackQuery({ text: ok ? 'Signed in' : 'Request expired' })
        if (!ok) return void (await show(ctx, loginScreen(a)))
        // A button back to the dashboard. Telegram rejects URL buttons for hosts like localhost,
        // so fall back to showing the address as text until WEB_URL is a public domain.
        const text = '✅ <b>Signed in.</b> Your dashboard is connected.'
        return void (await show(ctx, { text, kb: new InlineKeyboard().url('🌐 Back to dashboard', `${config.webUrl}/app`).row().text('📋 Menu', 'm:menu') }).catch((err) => {
          if (!/url/i.test(err.description ?? '')) throw err
          return show(ctx, { text: `${text}\nBack to your dashboard: <code>${esc(config.webUrl)}/app</code>`, kb: new InlineKeyboard().text('📋 Menu', 'm:menu') })
        }))
      }
      if (kind === 'authx') {
        denyLogin(a)
        await ctx.answerCallbackQuery({ text: 'Sign-in cancelled' })
        return void (await show(ctx, { text: 'Sign-in cancelled. No browser was given access.', kb: new InlineKeyboard().text('📋 Menu', 'm:menu') }))
      }
      if (kind === 'lb') return void (await show(ctx, leaderboardScreen(a === 'live' ? 'live' : 'paper')))
      if (kind === 'n') {
        if (!c) return void (await show(ctx, newBotScreen(a, b2)))
        const created = createBotFor(user, { strategy: a, assets: b2, timeframe: c })
        await ctx.answerCallbackQuery({ text: `Created paper bot #${created.id}` })
        return void (await show(ctx, botScreen(created)))
      }
      if (kind === 'w') {
        const w = db.getWallet(user.id)
        if (a === 'withdraw') {
          return void (await reply(ctx, 'Send funds to your own wallet (a destination address is needed, so this one is typed):\n<code>/withdraw usdt max 0xYourAddress</code>\n<code>/withdraw all 0xYourAddress</code>'))
        }
        if (a === 'export') return void (await show(ctx, exportScreen))
        if (a === 'exportok') {
          await show(ctx, await walletScreen(user))
          return void (await showKey(ctx, w))
        }
        if (a === 'delete') return void (await show(ctx, await deleteWalletScreen(w)))
        if (a === 'deleteok') return void (await show(ctx, { text: await deleteWalletNow(user, false), kb: new InlineKeyboard().text('📋 Menu', 'm:menu') }))
      }
      if (kind === 'b') {
        let bot_ = ownedBot(user, a)
        const action = b2
        if (!action) return void (await show(ctx, botScreen(bot_)))
        if (action === 'stop' || action === 'resume') {
          bot_ = setStatus(bot_, action === 'stop' ? 'stopped' : 'running')
          await ctx.answerCallbackQuery({ text: `Bot #${bot_.id} ${bot_.status}` })
          return void (await show(ctx, botScreen(bot_)))
        }
        if (action === 'close') {
          return void (await show(ctx, { text: `Close bot #${bot_.id}: withdraw any liquidity, sell every position and stop?`, kb: confirmKb(`b:${bot_.id}:closeok`, `b:${bot_.id}`, '💰 Close') }))
        }
        if (action === 'closeok') {
          await ctx.answerCallbackQuery({ text: 'Closing…' })
          const summary = closeSummary(await closeBot(bot_))
          await show(ctx, botScreen(db.getBot(bot_.id)))
          return void (await reply(ctx, `Bot #${bot_.id} closed.\n${summary}`))
        }
        if (action === 'del') return void (await show(ctx, deleteBotScreen(bot_)))
        if (action === 'delok') {
          await deleteBot(bot_)
          await ctx.answerCallbackQuery({ text: `Bot #${bot_.id} deleted` })
          return void (await show(ctx, botsScreen(user)))
        }
        if (action === 'live') return void (await show(ctx, liveScreen(bot_, c)))
        if (action === 'liveok') {
          await ctx.answerCallbackQuery({ text: 'Checking wallet…' })
          return void (await show(ctx, botScreen(await goLive(user, bot_, c))))
        }
      }
      await ctx.answerCallbackQuery({ text: 'Unknown button' })
    } catch (err) {
      // Expected errors (validation, limits) show as an alert on the button.
      if (!err.status) console.error(`telegram button ${ctx.callbackQuery.data}: ${err.stack ?? err}`)
      return void (await ctx.answerCallbackQuery({ text: String(err.message).slice(0, 190), show_alert: true }).catch(() => reply(ctx, `⚠️ ${esc(err.message)}`)))
    } finally {
      await ctx.answerCallbackQuery().catch(() => {})
    }
  })

  bot.catch(async ({ ctx, error }) => {
    const message = error instanceof GrammyError || error instanceof HttpError ? 'Telegram error' : error.message
    if (!error.status) console.error(`telegram: ${error.stack ?? error}`)
    await ctx.reply(`⚠️ ${message}`).catch(() => {})
  })

  // Trade and halt notifications to the bot's owner.
  const notify = (b, text) => {
    const user = db.getUser(b.user_id)
    const reply_markup = new InlineKeyboard().text(`View bot #${b.id}`, `b:${b.id}`)
    if (user) bot.api.sendMessage(user.tg_id, text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup }).catch(() => {})
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

  if (!start) return bot
  bot.api.setMyCommands([
    { command: 'start', description: 'Menu' },
    { command: 'wallet', description: 'Wallet address and balances' },
    { command: 'strategies', description: 'Available strategies' },
    { command: 'newbot', description: 'Create a paper bot' },
    { command: 'bots', description: 'Your bots' },
    { command: 'deletebot', description: 'Delete a bot' },
    { command: 'withdraw', description: 'Send funds out of your bot wallet' },
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
