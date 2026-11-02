// SQLite store (node:sqlite) for users, custodial wallets, bots, trades and
// web sessions. File: DB_FILE (default data/swordfish.db).

import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { config } from './config.mjs'

mkdirSync(dirname(config.dbFile), { recursive: true })
export const db = new DatabaseSync(config.dbFile)
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, tg_id TEXT UNIQUE NOT NULL, username TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS wallets (
    user_id INTEGER PRIMARY KEY REFERENCES users(id), address TEXT NOT NULL, encrypted_key TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS bots (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), name TEXT NOT NULL,
    strategy TEXT NOT NULL, params TEXT NOT NULL, assets TEXT NOT NULL, timeframe TEXT NOT NULL, interval_sec INTEGER NOT NULL,
    mode TEXT NOT NULL DEFAULT 'paper', status TEXT NOT NULL DEFAULT 'running', halted_reason TEXT,
    start_usdt REAL NOT NULL, cash REAL NOT NULL, positions TEXT NOT NULL DEFAULT '{}', cost_basis TEXT NOT NULL DEFAULT '{}',
    highs TEXT NOT NULL DEFAULT '{}', gas_usd REAL NOT NULL DEFAULT 0, peak_equity REAL,
    day TEXT, day_start_equity REAL, equity_usd REAL, pnl_pct REAL, trades INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY, bot_id INTEGER NOT NULL REFERENCES bots(id) ON DELETE CASCADE, time TEXT NOT NULL,
    asset TEXT NOT NULL, side TEXT NOT NULL, quantity REAL NOT NULL, usdt REAL NOT NULL, exec_price REAL NOT NULL,
    mid_price REAL, impact_pct REAL, realized_pnl REAL, gas_usd REAL, tx_hash TEXT, reason TEXT
  );
  CREATE TABLE IF NOT EXISTS decisions (
    id INTEGER PRIMARY KEY, bot_id INTEGER NOT NULL REFERENCES bots(id) ON DELETE CASCADE, time TEXT NOT NULL,
    asset TEXT NOT NULL, action TEXT, reason TEXT, error TEXT
  );
  CREATE INDEX IF NOT EXISTS decisions_bot ON decisions(bot_id, id);
  CREATE INDEX IF NOT EXISTS trades_bot ON trades(bot_id, id);
  CREATE TABLE IF NOT EXISTS tokens (
    token TEXT PRIMARY KEY, kind TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS invites (
    id INTEGER PRIMARY KEY, kind TEXT NOT NULL, value TEXT NOT NULL, note TEXT, tg_id TEXT, created_at TEXT NOT NULL, joined_at TEXT,
    UNIQUE(kind, value)
  );
`)

// Added after the first release: one-sided LP state for lp-range bots (JSON).
if (!db.prepare('PRAGMA table_info(bots)').all().some((c) => c.name === 'lp')) db.exec('ALTER TABLE bots ADD COLUMN lp TEXT')

const now = () => new Date().toISOString()
const JSON_COLS = ['params', 'assets', 'positions', 'cost_basis', 'highs', 'lp']
const parseBot = (row) => row && Object.fromEntries(Object.entries(row).map(([k, v]) => [k, JSON_COLS.includes(k) && v != null ? JSON.parse(v) : v]))

// --- users & wallets ---------------------------------------------------------

export function upsertUser(tgId, username) {
  db.prepare(`INSERT INTO users (tg_id, username, created_at) VALUES (?, ?, ?)
              ON CONFLICT(tg_id) DO UPDATE SET username = excluded.username`).run(String(tgId), username ?? null, now())
  return db.prepare('SELECT * FROM users WHERE tg_id = ?').get(String(tgId))
}
export const getUser = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id)
export const getUserByTg = (tgId) => db.prepare('SELECT * FROM users WHERE tg_id = ?').get(String(tgId))

export const getWallet = (userId) => {
  const w = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId)
  return w && { userId: w.user_id, address: w.address, encryptedKey: w.encrypted_key, createdAt: w.created_at }
}
export function saveWallet(userId, { address, encryptedKey }) {
  db.prepare('INSERT INTO wallets (user_id, address, encrypted_key, created_at) VALUES (?, ?, ?, ?)').run(userId, address, encryptedKey, now())
  return getWallet(userId)
}

// --- bots ---------------------------------------------------------------------

export function createBot({ userId, name, strategy, params, assets, timeframe, intervalSec, startUsdt }) {
  const { lastInsertRowid } = db
    .prepare(`INSERT INTO bots (user_id, name, strategy, params, assets, timeframe, interval_sec, start_usdt, cash, equity_usd, pnl_pct, peak_equity, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`)
    .run(userId, name, strategy, JSON.stringify(params), JSON.stringify(assets), timeframe, intervalSec, startUsdt, startUsdt, startUsdt, startUsdt, now(), now())
  return getBot(Number(lastInsertRowid))
}
/** Delete a bot with its trades and decisions. */
export const deleteBot = (id) => db.prepare('DELETE FROM bots WHERE id = ?').run(id).changes
/** Forget a user's custodial wallet; the next command creates a new one. */
export const walletOwner = (address) => db.prepare('SELECT user_id FROM wallets WHERE lower(address) = lower(?)').get(address)?.user_id ?? null
export const deleteWallet = (userId) => db.prepare('DELETE FROM wallets WHERE user_id = ?').run(userId).changes
export const getBot = (id) => parseBot(db.prepare('SELECT * FROM bots WHERE id = ?').get(id))
export const userBots = (userId) => db.prepare('SELECT * FROM bots WHERE user_id = ? ORDER BY id').all(userId).map(parseBot)
export const runningBots = () => db.prepare("SELECT * FROM bots WHERE status = 'running'").all().map(parseBot)

/** Patch bot columns; JSON columns are serialized. */
export function updateBot(id, patch) {
  const cols = Object.keys(patch)
  if (!cols.length) return getBot(id)
  const values = cols.map((c) => (JSON_COLS.includes(c) ? JSON.stringify(patch[c]) : patch[c]))
  db.prepare(`UPDATE bots SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...values, now(), id)
  return getBot(id)
}

export function leaderboard(mode = 'paper', limit = 50) {
  return db
    .prepare(`SELECT b.id, b.name, b.strategy, b.assets, b.timeframe, b.mode, b.status, b.start_usdt, b.equity_usd, b.pnl_pct,
                     b.trades, b.created_at, u.username, w.address AS wallet
              FROM bots b JOIN users u ON u.id = b.user_id LEFT JOIN wallets w ON w.user_id = b.user_id
              WHERE b.mode = ? ORDER BY b.pnl_pct DESC, b.trades DESC LIMIT ?`)
    .all(mode, limit)
    .map((r) => ({ ...r, assets: JSON.parse(r.assets), wallet: r.mode === 'live' ? r.wallet : null }))
}

// --- trades & decisions --------------------------------------------------------

export function addTrade(botId, t) {
  db.prepare(`INSERT INTO trades (bot_id, time, asset, side, quantity, usdt, exec_price, mid_price, impact_pct, realized_pnl, gas_usd, tx_hash, reason)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(botId, t.time, t.asset, t.side, t.quantity, t.usdt, t.execPrice, t.midPrice ?? null, t.impactPct ?? null,
      t.realizedPnlUsd ?? null, t.gasUsd ?? null, t.txHash ?? null, t.reason ?? null)
  db.prepare('UPDATE bots SET trades = trades + 1 WHERE id = ?').run(botId)
}
export const botTrades = (botId, limit = 100) => db.prepare('SELECT * FROM trades WHERE bot_id = ? ORDER BY id DESC LIMIT ?').all(botId, limit)

const KEEP_DECISIONS = 300
export function addDecision(botId, d) {
  db.prepare('INSERT INTO decisions (bot_id, time, asset, action, reason, error) VALUES (?, ?, ?, ?, ?, ?)')
    .run(botId, d.time, d.asset, d.action ?? null, d.reason ?? null, d.error ?? null)
  db.prepare('DELETE FROM decisions WHERE bot_id = ? AND id <= (SELECT id FROM decisions WHERE bot_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?)')
    .run(botId, botId, KEEP_DECISIONS)
}
export const botDecisions = (botId, limit = 100) => db.prepare('SELECT * FROM decisions WHERE bot_id = ? ORDER BY id DESC LIMIT ?').all(botId, limit)

// --- one-time login links and web sessions -------------------------------------

export function issueToken(userId, kind, ttlSec) {
  const token = randomBytes(24).toString('base64url')
  db.prepare('DELETE FROM tokens WHERE expires_at < ?').run(Date.now())
  db.prepare('INSERT INTO tokens (token, kind, user_id, expires_at) VALUES (?, ?, ?, ?)').run(token, kind, userId, Date.now() + ttlSec * 1000)
  return token
}
export function useToken(token, kind, { consume = false } = {}) {
  const row = db.prepare('SELECT * FROM tokens WHERE token = ? AND kind = ? AND expires_at > ?').get(String(token), kind, Date.now())
  if (row && consume) db.prepare('DELETE FROM tokens WHERE token = ?').run(row.token)
  return row ? getUser(row.user_id) : null
}
export const revokeToken = (token) => db.prepare('DELETE FROM tokens WHERE token = ?').run(String(token))

// --- invites (managed on the private invite page) ------------------------------
// kind 'username' stores the lowercased name without @; kind 'phone' stores digits only.
// tg_id is filled the first time the invited person reaches the bot, so access then
// follows the Telegram account even if the username changes.

export const hasInvites = () => Boolean(db.prepare('SELECT 1 FROM invites LIMIT 1').get())
export const listInvites = () => db.prepare(`SELECT i.*, u.username AS joined_as FROM invites i
  LEFT JOIN users u ON u.tg_id = i.tg_id ORDER BY i.id DESC`).all()
export function addInvite(kind, value, note) {
  db.prepare('INSERT OR IGNORE INTO invites (kind, value, note, created_at) VALUES (?, ?, ?, ?)').run(kind, value, note || null, now())
  return db.prepare('SELECT * FROM invites WHERE kind = ? AND value = ?').get(kind, value)
}
export const removeInvite = (id) => db.prepare('DELETE FROM invites WHERE id = ?').run(id).changes

export function inviteAllows(tgId, username) {
  const row = db.prepare(`SELECT * FROM invites WHERE tg_id = ?
    OR (tg_id IS NULL AND kind = 'username' AND value = ?) LIMIT 1`).get(String(tgId), String(username ?? '').toLowerCase())
  if (row && !row.tg_id) db.prepare('UPDATE invites SET tg_id = ?, joined_at = ? WHERE id = ?').run(String(tgId), now(), row.id)
  return Boolean(row)
}

// Telegram reports numbers with the country code; an invite typed in local form
// (leading 0, no country code) still matches on its trailing digits.
export function claimPhoneInvite(phoneDigits, tgId) {
  const rows = db.prepare("SELECT * FROM invites WHERE kind = 'phone' AND tg_id IS NULL").all()
  const row = rows.find((r) => {
    const want = r.value.replace(/^0+/, '')
    return want.length >= 8 && phoneDigits.endsWith(want)
  })
  if (row) db.prepare('UPDATE invites SET tg_id = ?, joined_at = ? WHERE id = ?').run(String(tgId), now(), row.id)
  return Boolean(row)
}
