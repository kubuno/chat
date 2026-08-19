// The instance policy set by the administrator, fetched once per page load.
//
// Its only job here is to keep the interface honest: a paperclip that always
// fails, or a link preview the server will refuse, is worse than not offering
// it. The policy itself is enforced server-side — this module never guards
// anything, it only decides what to show.

import { chatApi, type ChatInstanceConfig } from './api'
import { useEffect, useState } from 'react'

// Permissive fallback: if the policy cannot be read, the interface offers
// everything and the server keeps refusing what it must.
const FALLBACK: ChatInstanceConfig = {
  allow_file_sharing:   true,
  max_media_mb:         50,
  allow_link_previews:  true,
  allow_public_spaces:  true,
  space_creation:       'everyone',
  space_invite_policy:  'members',
  default_expiry_hours: 0,
}

let cached: ChatInstanceConfig | null = null
let inflight: Promise<ChatInstanceConfig> | null = null

/** The policy, fetched at most once and shared by every caller. */
export function loadChatConfig(): Promise<ChatInstanceConfig> {
  if (cached) return Promise.resolve(cached)
  if (!inflight) {
    inflight = chatApi.getConfig()
      .then(c => { cached = c; return c })
      .catch(() => FALLBACK)
      .finally(() => { inflight = null })
  }
  return inflight
}

/** The policy already known, without waiting — the permissive fallback until then. */
export function chatConfigNow(): ChatInstanceConfig {
  return cached ?? FALLBACK
}

/** React binding: re-renders once the policy has arrived. */
export function useChatConfig(): ChatInstanceConfig {
  const [cfg, setCfg] = useState<ChatInstanceConfig>(chatConfigNow())
  useEffect(() => {
    let alive = true
    loadChatConfig().then(c => { if (alive) setCfg(c) })
    return () => { alive = false }
  }, [])
  return cfg
}
