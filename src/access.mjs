// Who may use the bot and dashboard: accounts in TELEGRAM_ALLOWED_USERS (the operator)
// plus people invited on the private invite page. Invites live in the database, so
// adding or removing someone applies on their next message, with no restart.
// With no env list and no invites at all, the bot is open to everyone.

import { config } from './config.mjs'
import * as db from './db.mjs'

export function telegramAllowed(tgId, username) {
  const list = config.telegramAllowed
  const name = String(username ?? '').toLowerCase()
  if (list.includes(String(tgId)) || (name && list.includes(name))) return true
  if (db.inviteAllows(tgId, name)) return true
  return !list.length && !db.hasInvites()
}
