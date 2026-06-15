import { buf2b64, b642buf } from './KeyStore'

// Chiffrement AES-GCM d'un texte clair
export async function encrypt(
  key: CryptoKey,
  plaintext: string
): Promise<{ ciphertext: string; nonce: string }> {
  const iv        = crypto.getRandomValues(new Uint8Array(12))
  const encoded   = new TextEncoder().encode(plaintext)
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded)

  return {
    ciphertext: buf2b64(encrypted),
    nonce:      buf2b64(iv.buffer),
  }
}

// Déchiffrement AES-GCM
export async function decrypt(
  key: CryptoKey,
  ciphertext: string,
  nonce: string
): Promise<string> {
  const iv        = new Uint8Array(b642buf(nonce))
  const data      = b642buf(ciphertext)
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)
  return new TextDecoder().decode(decrypted)
}

// Générer un nonce aléatoire (pour anti-replay)
export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return buf2b64(bytes.buffer)
}

// Dériver une clé AES depuis un secret brut (HKDF)
export async function deriveKeyFromSecret(secret: ArrayBuffer): Promise<CryptoKey> {
  const importedSecret = await crypto.subtle.importKey(
    'raw', secret,
    { name: 'HKDF' },
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt:  new Uint8Array(32),
      info:  new TextEncoder().encode('kubuno-chat-v1'),
    },
    importedSecret,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}
