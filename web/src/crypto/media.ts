// Client-side encryption for media blobs (images, video, audio, files, voice).
//
// Each media gets a fresh random AES-GCM 256 key + IV. The ciphertext is what we
// upload to the server (an opaque blob); the key/iv travel inside the message's
// own encrypted envelope, so the server never sees the plaintext nor the key.

import { buf2b64, b642buf } from './KeyStore'

export interface EncryptedMedia {
  cipher: Blob    // ciphertext to upload
  key:    string  // base64url AES-GCM 256 key
  iv:     string  // base64url 12-byte IV
}

/** Encrypt a Blob/File with a fresh AES-GCM key. */
export async function encryptBlob(data: Blob): Promise<EncryptedMedia> {
  const keyRaw = crypto.getRandomValues(new Uint8Array(32))
  const iv     = crypto.getRandomValues(new Uint8Array(12))
  const cryptoKey = await crypto.subtle.importKey('raw', keyRaw, { name: 'AES-GCM' }, false, ['encrypt'])
  const plain   = await data.arrayBuffer()
  const cipher  = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, plain)
  return {
    cipher: new Blob([cipher]),
    key:    buf2b64(keyRaw.buffer),
    iv:     buf2b64(iv.buffer),
  }
}

/** Decrypt previously-encrypted media bytes back into a typed Blob. */
export async function decryptToBlob(
  cipher: ArrayBuffer,
  keyB64: string,
  ivB64:  string,
  mime:   string,
): Promise<Blob> {
  const keyRaw    = b642buf(keyB64)
  const iv        = new Uint8Array(b642buf(ivB64))
  const cryptoKey = await crypto.subtle.importKey('raw', keyRaw, { name: 'AES-GCM' }, false, ['decrypt'])
  const plain     = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, cipher)
  return new Blob([plain], { type: mime })
}
