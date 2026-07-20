import { api } from '@kubuno/sdk'
import type { KubunoDataEnvelope } from './kubunoData'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Conversation {
  id:          string
  conv_type:   'direct' | 'group' | 'channel'
  name:        string | null
  description: string | null
  avatar_path: string | null
  user_a_id:   string | null
  user_b_id:   string | null
  created_by:  string | null
  created_at:  string
  updated_at:  string
  is_meeting?: boolean
}

export interface OtherUser {
  id:           string
  display_name: string | null
  username:     string
  avatar_url:   string | null
}

export interface ConvMember {
  user_id:      string
  role:         string
  joined_at:    string
  display_name: string | null
  username:     string
  avatar_url:   string | null
}

export interface ConversationSummary {
  conversation:  Conversation
  unread_count:  number
  /** Anything past last_read_at — true as well when the user marked it unread by hand. */
  is_unread:     boolean
  member_count:  number
  is_pinned:     boolean
  is_archived:   boolean
  is_favorite:   boolean
  muted_until:   string | null
  other_user:    OtherUser | null
}

export interface Message {
  id:              string
  conversation_id: string
  sender_id:       string
  encrypted_data:  string
  message_type:    string
  media_meta:      Record<string, unknown> | null
  reply_to_id:     string | null
  status:          'sent' | 'delivered' | 'read'
  edited_at:       string | null
  deleted_at:      string | null
  nonce:           string
  created_at:      string
  is_pinned?:      boolean
  pinned_at?:      string | null
}

export interface ReactionLite {
  message_id: string
  user_id:    string
  emoji:      string
}

// Media descriptor carried inside a message's encrypted envelope (never seen
// by the server in clear — key/iv let the recipient decrypt the uploaded blob).
export interface MediaPayload {
  media_id:  string
  key:       string   // base64url AES-GCM key
  iv:        string   // base64url IV
  mime:      string
  name:      string
  size:      number
  // 'sticker' and 'gif' are rendered bare (no bubble) but travel as regular
  // encrypted media; the server-side message_type stays 'image' for them.
  kind:      'image' | 'video' | 'audio' | 'file' | 'sticker' | 'gif'
  width?:    number
  height?:   number
  duration?: number   // seconds (audio/video)
  voice?:    boolean  // true → voice message (recorded clip)
  waveform?: number[] // normalized peaks [0..1] for voice rendering
}

// A GIF as returned by the server-side GIPHY proxy (the API key never reaches
// the browser; `url` is fetched back through /chat/gifs/fetch before sending).
export interface GifResult {
  id:      string
  title:   string
  preview: string
  url:     string
  width:   number
  height:  number
}

export interface PollPayload { question: string; options: string[] }

// Decoded message (after client-side decryption)
export interface DecodedMessage extends Message {
  plaintext: string | null         // null if decryption failed or not available
  media?:    MediaPayload | null    // present for media messages
  poll?:     PollPayload | null     // present for poll messages
  card?:     KubunoDataEnvelope | null  // cross-module data card (pasted JSON envelope)
  reactions?: { emoji: string; user_id: string }[]  // aggregated client-side
}

export interface PreKeyBundle {
  user_id:             string
  identity_key_pub:    string
  fingerprint:         string
  signed_prekey_id:    number
  signed_prekey_pub:   string
  signed_prekey_sig:   string
  one_time_prekey_id:  number | null
  one_time_prekey_pub: string | null
  opk_count:           number
}

export interface KeyStatus {
  opk_count:     number
  needs_refill:  boolean
  min_threshold: number
}

// ── Conversations ─────────────────────────────────────────────────────────────

export const chatApi = {
  listConversations: () =>
    api.get<{ conversations: ConversationSummary[] }>('/chat/conversations').then(r => r.data.conversations),

  createDirect: (targetUserId: string) =>
    api.post<{ conversation: Conversation }>('/chat/conversations', {
      conv_type: 'direct',
      target_user: targetUserId,
    }).then(r => r.data.conversation),

  createGroup: (name: string, memberIds: string[]) =>
    api.post<{ conversation: Conversation }>('/chat/conversations', {
      conv_type: 'group',
      name,
      member_ids: memberIds,
    }).then(r => r.data.conversation),

  // A space is a public channel: discoverable in /channels/browse, open join.
  createSpace: (name: string, memberIds: string[] = []) =>
    api.post<{ conversation: Conversation }>('/chat/conversations', {
      conv_type: 'channel',
      name,
      member_ids: memberIds,
    }).then(r => r.data.conversation),

  // Meeting room = open-join group conversation (scheduled video meetings).
  createMeeting: (name: string, memberIds: string[] = []) =>
    api.post<{ conversation: Conversation }>('/chat/conversations', {
      conv_type: 'group', name, member_ids: memberIds, is_meeting: true,
    }).then(r => r.data.conversation),

  joinMeeting: (convId: string) =>
    api.post<{ ok: boolean }>(`/chat/conversations/${convId}/join`).then(r => r.data),

  getConversation: (id: string) =>
    api.get<{ conversation: Conversation; members: ConvMember[] }>(
      `/chat/conversations/${id}`
    ).then(r => r.data),

  updateConversation: (id: string, data: { name?: string; description?: string }) =>
    api.patch<{ conversation: Conversation }>(`/chat/conversations/${id}`, data).then(r => r.data.conversation),

  leaveConversation: (id: string) =>
    api.post(`/chat/conversations/${id}/leave`),

  updateMemberSettings: (id: string, settings: {
    pin?:         boolean
    archive?:     boolean
    favorite?:    boolean
    mute_until?:  string   // ISO date
    unmute?:      boolean
    mark_unread?: boolean
  }) => api.patch(`/chat/conversations/${id}/member-settings`, settings),

  clearMessages: (id: string) =>
    api.post(`/chat/conversations/${id}/clear`),

  addMembers: (id: string, userIds: string[]) =>
    api.post(`/chat/conversations/${id}/members`, { user_ids: userIds }),

  removeMember: (convId: string, userId: string) =>
    api.delete(`/chat/conversations/${convId}/members/${userId}`),

  // ── Messages ────────────────────────────────────────────────────────────────

  listMessages: (convId: string, limit?: number, before?: string) =>
    api.get<{ messages: Message[]; reactions?: ReactionLite[] }>(`/chat/conversations/${convId}/messages`, {
      params: { limit, before },
    }).then(r => r.data),

  getPinned: (convId: string) =>
    api.get<{ messages: Message[] }>(`/chat/conversations/${convId}/pinned`).then(r => r.data.messages),

  pinMessage: (msgId: string) =>
    api.post<{ message: Message }>(`/chat/messages/${msgId}/pin`).then(r => r.data.message),

  votePoll: (msgId: string, optionIndex: number) =>
    api.post<{ counts: Record<string, number>; my_vote: number }>(`/chat/messages/${msgId}/vote`, { option_index: optionIndex }).then(r => r.data),

  getPoll: (msgId: string) =>
    api.get<{ counts: Record<string, number>; my_vote: number | null }>(`/chat/messages/${msgId}/poll`).then(r => r.data),

  unfurl: (url: string) =>
    api.get<{ url: string; title: string | null; description: string | null; image: string | null; site_name?: string | null }>(
      '/chat/unfurl', { params: { url } }
    ).then(r => r.data),

  // GIF search — proxied by the module (GIPHY key stays server-side). `enabled`
  // is false when no key is configured, in which case the GIF tab is hidden.
  // Public spaces (channels) discovery — powers the "browse spaces" page.
  browseChannels: (q = '', joined = false) =>
    api.get<{ channels: { id: string; name: string | null; description: string | null; created_at: string; member_count: number; is_member: boolean }[] }>(
      '/chat/channels/browse', { params: { q, joined } }
    ).then(r => r.data.channels),

  gifStatus: () =>
    api.get<{ enabled: boolean; provider: string }>('/chat/gifs/status').then(r => r.data),

  searchGifs: (q: string, limit = 24, offset = 0, lang?: string) =>
    api.get<{ gifs: GifResult[] }>('/chat/gifs/search', { params: { q, limit, offset, lang } })
      .then(r => r.data.gifs),

  // Pull the GIF bytes back through the module so they can be encrypted and
  // uploaded like any other media (the recipient never contacts GIPHY).
  fetchGif: (url: string) =>
    api.get<Blob>('/chat/gifs/fetch', { params: { url }, responseType: 'blob' }).then(r => r.data),

  getReadState: (convId: string) =>
    api.get<{ members: { user_id: string; last_read_message_id: string | null; last_read_at: string }[] }>(
      `/chat/conversations/${convId}/read-state`
    ).then(r => r.data.members),

  sendMessage: (convId: string, payload: {
    encrypted_data:  string
    nonce:           string
    message_type?:   string
    media_meta?:     Record<string, unknown>
    reply_to_id?:    string
    ephemeral_key?:  string
    sender_ik_pub?:  string
    ratchet_header?: string
    used_opk_id?:    string
    scheduled_at?:    string   // ISO — future send
    expires_in_secs?: number   // ephemeral TTL
  }) =>
    api.post<{ message: Message }>(`/chat/conversations/${convId}/messages`, payload)
      .then(r => r.data.message),

  editMessage: (msgId: string, encrypted_data: string, nonce: string) =>
    api.patch<{ message: Message }>(`/chat/messages/${msgId}`, { encrypted_data, nonce })
      .then(r => r.data.message),

  deleteMessage: (msgId: string) =>
    api.delete(`/chat/messages/${msgId}`),

  markRead: (convId: string, upToMessageId: string) =>
    api.post(`/chat/conversations/${convId}/read`, { up_to_message_id: upToMessageId }),

  addReaction: (msgId: string, emoji: string) =>
    api.post(`/chat/messages/${msgId}/reactions`, { emoji }),

  removeReaction: (msgId: string, emoji: string) =>
    api.delete(`/chat/messages/${msgId}/reactions/${encodeURIComponent(emoji)}`),

  // ── Keys ────────────────────────────────────────────────────────────────────

  registerKeys: (payload: {
    identity_key_pub: string
    fingerprint:      string
    signed_prekey:    { id: number; public_key: string; signature: string }
    one_time_prekeys: { id: number; public_key: string }[]
  }) => api.post('/chat/keys/register', payload),

  getPreKeyBundle: (userId: string) =>
    api.get<PreKeyBundle>(`/chat/keys/${userId}`).then(r => r.data),

  uploadOneTimePrekeys: (keys: { id: number; public_key: string }[]) =>
    api.post<{ inserted: number; remaining: number }>('/chat/keys/one-time', {
      one_time_prekeys: keys,
    }).then(r => r.data),

  getKeyStatus: () =>
    api.get<KeyStatus>('/chat/keys/status').then(r => r.data),

  // ── Présence ────────────────────────────────────────────────────────────────

  getPresence: (userId: string) =>
    api.get<{ presence: { status: string; custom_status: string | null; manual_status: string | null; last_seen_at: string } }>(
      `/chat/presence/${userId}`
    ).then(r => r.data.presence),

  updatePresence: (status: string, customStatus?: string) =>
    api.patch('/chat/presence', { status, custom_status: customStatus }),

  // ── Médias ──────────────────────────────────────────────────────────────────

  uploadMedia: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.post<{ media_id: string; content_type: string }>('/chat/media/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },

  // Fetch the encrypted blob with auth (axios attaches the bearer); the caller
  // decrypts it client-side. A plain <img src> can't be used because the proxy
  // needs the Authorization header.
  downloadMedia: (mediaId: string) =>
    api.get<ArrayBuffer>(`/chat/media/${mediaId}`, { responseType: 'arraybuffer' }).then(r => r.data),

  getMediaUrl: (mediaId: string) => `/api/v1/chat/media/${mediaId}`,
}
