/**
 * Personal sticker pack — stored locally (IndexedDB), never on the server.
 *
 * A sticker is just a square PNG with transparency. Sending one re-encrypts it
 * with a fresh key and uploads it like any other media, so the server can never
 * correlate the same sticker across conversations (and the pack itself, being
 * local, is invisible to it).
 *
 * Cross-device sync is deliberately out of scope: the chat's E2E identity keys
 * are already device-local, so a server-side pack would leak plaintext images.
 */

const DB_NAME = 'kubuno-chat-stickers'
const DB_VERSION = 1
const STORE = 'stickers'

export interface Sticker {
  id:         string
  blob:       Blob     // square PNG, transparent background
  width:      number
  height:     number
  created_at: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(db => new Promise<T>((resolve, reject) => {
    const request = run(db.transaction(STORE, mode).objectStore(STORE))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }))
}

/** Most recently added first. */
export async function listStickers(): Promise<Sticker[]> {
  const all = await tx<Sticker[]>('readonly', s => s.getAll() as IDBRequest<Sticker[]>)
  return all.sort((a, b) => b.created_at - a.created_at)
}

export async function addSticker(blob: Blob, width: number, height: number): Promise<Sticker> {
  const sticker: Sticker = { id: uid(), blob, width, height, created_at: Date.now() }
  await tx('readwrite', s => s.put(sticker))
  return sticker
}

export async function removeSticker(id: string): Promise<void> {
  await tx('readwrite', s => s.delete(id))
}

/** crypto.randomUUID is unavailable over plain HTTP on a non-localhost host. */
function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try { return crypto.randomUUID() } catch { /* insecure context */ }
  }
  const rnd = new Uint8Array(16)
  crypto.getRandomValues(rnd)
  return Array.from(rnd, b => b.toString(16).padStart(2, '0')).join('')
}

export const STICKER_SIZE = 512

/**
 * Turn any image into a sticker-sized square PNG: contain-fit on a transparent
 * canvas, so nothing is cropped away and the aspect ratio is preserved.
 */
export async function imageToSticker(file: Blob, size = STICKER_SIZE): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d indisponible')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    const scale = Math.min(size / bitmap.width, size / bitmap.height)
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)
    ctx.drawImage(bitmap, Math.round((size - w) / 2), Math.round((size - h) / 2), w, h)

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        blob => (blob ? resolve(blob) : reject(new Error('encodage PNG impossible'))),
        'image/png',
      )
    })
  } finally {
    bitmap.close()
  }
}
