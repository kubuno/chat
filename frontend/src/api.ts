import { api } from '@kubuno/sdk'

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
}

// Decoded message (after client-side decryption)
export interface DecodedMessage extends Message {
  plaintext: string | null  // null if decryption failed or not available
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
    api.get<{ messages: Message[] }>(`/chat/conversations/${convId}/messages`, {
      params: { limit, before },
    }).then(r => r.data.messages),

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
    api.get<{ presence: { status: string; custom_status: string | null; last_seen_at: string } }>(
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

  getMediaUrl: (mediaId: string) => `/api/v1/chat/media/${mediaId}`,
}
