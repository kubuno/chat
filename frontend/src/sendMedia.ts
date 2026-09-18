// Sending a file to a conversation, encrypted end to end.
//
// The server only ever stores the ciphertext: the blob is encrypted here, the
// key and iv travel inside the message envelope, and `media_meta` carries only
// what the server needs — chiefly the media id it checks access against.

import { chatApi, type MediaPayload } from './api'
import { encodeMediaMessage, useChatStore } from './chatStore'
import { encryptBlob } from './crypto/media'

export interface MediaInfo {
  mime:      string
  name:      string
  kind:      MediaPayload['kind']
  width?:    number
  height?:   number
  duration?: number
}

/** Encrypts, uploads and posts `blob` to a conversation, and shows it at once. */
export async function pushMediaToConversation(convId: string, blob: Blob, info: MediaInfo, caption?: string) {
  const { cipher, key, iv } = await encryptBlob(blob)
  const encFile = new File([cipher], `${crypto.randomUUID()}.enc`, { type: 'application/octet-stream' })
  const { media_id } = await chatApi.uploadMedia(encFile)

  const media: MediaPayload = {
    media_id, key, iv,
    mime: info.mime, name: info.name, size: blob.size, kind: info.kind,
    width: info.width, height: info.height, duration: info.duration,
  }
  const media_meta: Record<string, unknown> = { media_id, kind: info.kind, size: blob.size }
  if (info.width)    media_meta.width = info.width
  if (info.height)   media_meta.height = info.height
  if (info.duration) media_meta.duration = info.duration

  const { encrypted_data, nonce } = encodeMediaMessage(media, caption)
  const msg = await chatApi.sendMessage(convId, {
    encrypted_data, nonce, message_type: info.kind, media_meta,
  })
  useChatStore.getState().appendMessage(convId, { ...msg, plaintext: caption ?? '', media })
  return msg
}
