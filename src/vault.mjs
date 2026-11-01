// Custodial bot wallets. Private keys are encrypted at rest with AES-256-GCM
// under MASTER_KEY (32 bytes, hex) and only decrypted in memory to sign.
// Losing MASTER_KEY makes every stored wallet unrecoverable: back it up.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

function masterKey() {
  const hex = process.env.MASTER_KEY ?? ''
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('MASTER_KEY must be 64 hex chars (openssl rand -hex 32)')
  return Buffer.from(hex, 'hex')
}

// Bound to the wallet address so a ciphertext can't be swapped onto another row.
export function encrypt(plaintext, address) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv)
  cipher.setAAD(Buffer.from(address.toLowerCase()))
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')].join(':')
}

export function decrypt(blob, address) {
  const [version, iv, tag, body] = blob.split(':')
  if (version !== 'v1') throw new Error(`Unknown key format ${version}`)
  const decipher = createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(iv, 'base64'))
  decipher.setAAD(Buffer.from(address.toLowerCase()))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8')
}

/** New random wallet: { address, encryptedKey }. The plaintext key never leaves this function. */
export function createWallet() {
  const key = generatePrivateKey()
  const { address } = privateKeyToAccount(key)
  return { address, encryptedKey: encrypt(key, address) }
}

/**
 * Wallet from an existing private key (64 hex characters, 0x optional). Errors
 * never include the key.
 */
export function importWallet(privateKey) {
  const hex = String(privateKey ?? '').trim().replace(/^0x/i, '')
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw Object.assign(new Error('That is not a private key (expected 64 hex characters)'), { status: 400 })
  const key = `0x${hex.toLowerCase()}`
  let address
  try {
    ;({ address } = privateKeyToAccount(key))
  } catch {
    throw Object.assign(new Error('Invalid private key'), { status: 400 })
  }
  return { address, encryptedKey: encrypt(key, address) }
}

/** viem account for signing; keep it short-lived. */
export const unlock = ({ address, encryptedKey }) => privateKeyToAccount(decrypt(encryptedKey, address))

export const exportKey = ({ address, encryptedKey }) => decrypt(encryptedKey, address)
