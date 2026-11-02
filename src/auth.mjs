// Dashboard sign-in approved in Telegram: the dashboard asks for a request, opens the bot with
// /start login_<code>, and the Telegram user taps Approve. The code travels in the t.me link; the
// secret stays in the requesting browser's cookie, so only that browser can collect the session.
// Requests live in memory: a restart just means clicking Log in again.

import { randomBytes, timingSafeEqual } from 'node:crypto'

export const LOGIN_TTL_SEC = 10 * 60
const pending = new Map() // code -> { secret, expires, userId }

export function requestLogin() {
  for (const [code, r] of pending) if (r.expires < Date.now()) pending.delete(code)
  const code = randomBytes(12).toString('base64url')
  const secret = randomBytes(24).toString('base64url')
  pending.set(code, { secret, expires: Date.now() + LOGIN_TTL_SEC * 1000, userId: null })
  return { code, secret }
}

const live = (code) => {
  const r = pending.get(code)
  return r && r.expires > Date.now() ? r : null
}

export const loginPending = (code) => Boolean(live(code) && !live(code).userId)

export function approveLogin(code, userId) {
  const r = live(code)
  if (!r || r.userId) return false
  r.userId = userId
  return true
}

export const denyLogin = (code) => pending.delete(code)

const same = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

// { status: 'pending' | 'expired' } or, once and only for the secret's holder, { status: 'approved', userId }.
export function collectLogin(code, secret) {
  const r = live(code)
  if (!r || !same(r.secret, String(secret))) return { status: 'expired' }
  if (!r.userId) return { status: 'pending' }
  pending.delete(code)
  return { status: 'approved', userId: r.userId }
}
