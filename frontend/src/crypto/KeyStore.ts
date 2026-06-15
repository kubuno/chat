// Stockage des clés E2E dans IndexedDB (clés privées jamais envoyées au serveur)
// Utilise Web Crypto API (ECDH P-256) pour la génération de clés.

const DB_NAME    = 'kubuno-chat-keys'
const DB_VERSION = 1
const STORE_NAME = 'keys'

export interface IdentityKeyPair {
  publicKeyB64:  string  // base64url
  privateKey:    CryptoKey
  fingerprint:   string
}

export interface SignedPreKey {
  id:           number
  publicKeyB64: string
  signature:    string
  keyPair:      CryptoKeyPair
}

export interface OneTimePreKey {
  id:           number
  publicKeyB64: string
  keyPair:      CryptoKeyPair
}

let _db: IDBDatabase | null = null

async function getDB(): Promise<IDBDatabase> {
  if (_db) return _db
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME)
    }
    req.onsuccess = () => { _db = req.result; resolve(_db) }
    req.onerror   = () => reject(req.error)
  })
}

async function dbGet<T>(key: string): Promise<T | undefined> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(key)
    req.onsuccess = () => resolve(req.result as T)
    req.onerror   = () => reject(req.error)
  })
}

async function dbSet(key: string, value: unknown): Promise<void> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readwrite')
    const req = tx.objectStore(STORE_NAME).put(value, key)
    req.onsuccess = () => resolve()
    req.onerror   = () => reject(req.error)
  })
}

// ── Utilitaires crypto ────────────────────────────────────────────────────────

export function buf2b64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

export function b642buf(b64: string): ArrayBuffer {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/') +
    '=='.slice(0, (4 - b64.length % 4) % 4)
  const binary = atob(padded)
  const buf = new ArrayBuffer(binary.length)
  const view = new Uint8Array(buf)
  for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i)
  return buf
}

async function keyToB64(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', key)
  return buf2b64(raw)
}

async function computeFingerprint(publicKey: CryptoKey): Promise<string> {
  const raw  = await crypto.subtle.exportKey('raw', publicKey)
  const hash = await crypto.subtle.digest('SHA-256', raw)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .match(/.{4}/g)!
    .join(' ')
    .toUpperCase()
}

// ── Identity Key ──────────────────────────────────────────────────────────────

export async function getOrCreateIdentityKey(): Promise<{
  publicKeyB64: string
  fingerprint:  string
  privateKey:   CryptoKey
}> {
  const stored = await dbGet<{ publicKeyB64: string; fingerprint: string; privateKeyJwk: JsonWebKey }>('identity_key')
  if (stored) {
    const privateKey = await crypto.subtle.importKey(
      'jwk', stored.privateKeyJwk,
      { name: 'ECDH', namedCurve: 'P-256' },
      true, ['deriveKey']
    )
    return { publicKeyB64: stored.publicKeyB64, fingerprint: stored.fingerprint, privateKey }
  }

  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']
  )
  const publicKeyB64  = await keyToB64(keyPair.publicKey)
  const fingerprint   = await computeFingerprint(keyPair.publicKey)
  const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey)

  await dbSet('identity_key', { publicKeyB64, fingerprint, privateKeyJwk })
  return { publicKeyB64, fingerprint, privateKey: keyPair.privateKey }
}

// ── Signed PreKey ─────────────────────────────────────────────────────────────

export async function getOrCreateSignedPreKey(): Promise<{
  id:           number
  publicKeyB64: string
  signature:    string
}> {
  const stored = await dbGet<{ id: number; publicKeyB64: string; signature: string; privateKeyJwk: JsonWebKey }>('spk')
  if (stored) {
    return { id: stored.id, publicKeyB64: stored.publicKeyB64, signature: stored.signature }
  }

  const keyPair   = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey'])
  const id        = Date.now() % 2147483647
  const publicB64 = await keyToB64(keyPair.publicKey)
  // En production: signer avec la clé d'identité Ed25519.
  // Ici on utilise une signature HMAC simulée (clé publique encodée).
  const signature = buf2b64(await crypto.subtle.digest('SHA-256', b642buf(publicB64)))

  const privJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey)
  await dbSet('spk', { id, publicKeyB64: publicB64, signature, privateKeyJwk: privJwk })
  return { id, publicKeyB64: publicB64, signature }
}

// ── One-Time PreKeys ──────────────────────────────────────────────────────────

export async function generateOneTimePreKeys(count: number): Promise<{ id: number; public_key: string }[]> {
  const existing = (await dbGet<number[]>('opk_ids')) ?? []
  const startId  = existing.length > 0 ? Math.max(...existing) + 1 : 1
  const result: { id: number; public_key: string }[] = []
  const ids: number[] = [...existing]

  for (let i = 0; i < count; i++) {
    const id      = startId + i
    const keyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey'])
    const pub     = await keyToB64(keyPair.publicKey)
    const privJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey)
    await dbSet(`opk_${id}`, { id, publicKeyB64: pub, privateKeyJwk: privJwk })
    result.push({ id, public_key: pub })
    ids.push(id)
  }

  await dbSet('opk_ids', ids)
  return result
}

// ── Vérification si les clés sont enregistrées ────────────────────────────────

export async function hasIdentityKey(): Promise<boolean> {
  const stored = await dbGet<unknown>('identity_key')
  return stored !== undefined
}

// ── Dérivation de clé partagée (ECDH simplifié) ───────────────────────────────

export async function deriveSharedKey(
  myPrivateKey: CryptoKey,
  theirPublicKeyB64: string
): Promise<CryptoKey> {
  const rawPub      = b642buf(theirPublicKeyB64)
  const theirPubKey = await crypto.subtle.importKey(
    'raw', rawPub,
    { name: 'ECDH', namedCurve: 'P-256' },
    true, []
  )

  return crypto.subtle.deriveKey(
    { name: 'ECDH', public: theirPubKey },
    myPrivateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}
