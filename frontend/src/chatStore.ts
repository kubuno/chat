import { create } from 'zustand'
import { chatApi, Conversation, ConversationSummary, DecodedMessage, Message, OtherUser } from './api'

export interface IncomingCall {
  convId:      string
  fromUserId:  string
  fromName:    string
  type:        'audio' | 'video'
  sdpOffer:    RTCSessionDescriptionInit
}

export interface CallParticipant {
  userId: string
  name:   string
}

export interface ActiveCall {
  convId:       string
  type:         'audio' | 'video'
  isInitiator:  boolean
  participants: CallParticipant[]
  // kept for legacy 1:1 signal compatibility
  peerUserId:   string
  peerName:     string
}

export interface PreCallState {
  convId:       string
  convName:     string
  type:         'audio' | 'video'
  candidates:   CallParticipant[]   // all members that can be invited
}

interface ChatState {
  conversations:      ConversationSummary[]
  activeConvId:       string | null
  messages:           Record<string, DecodedMessage[]>  // keyed by conv_id
  typingUsers:        Record<string, string[]>           // conv_id → user_ids
  onlineUsers:        Set<string>
  isLoadingConvs:     boolean
  isLoadingMsgs:      boolean
  wsStatus:           'disconnected' | 'connecting' | 'connected'
  keysRegistered:     boolean
  sendTypingFn:       ((convId: string, isTyping: boolean) => void) | null
  sendCallSignalFn:   ((toUserId: string, signal: object) => void) | null
  incomingCall:       IncomingCall | null
  activeCall:         ActiveCall | null
  preCallState:       PreCallState | null

  // Actions
  setActiveConv:        (convId: string | null) => void
  fetchConversations:   () => Promise<void>
  fetchMessages:        (convId: string, before?: string) => Promise<void>
  appendMessage:        (convId: string, msg: DecodedMessage) => void
  updateMessage:        (convId: string, msg: Partial<Message> & { id: string }) => void
  removeMessage:        (convId: string, msgId: string) => void
  setTyping:            (convId: string, userId: string, isTyping: boolean) => void
  setUserOnline:        (userId: string, online: boolean) => void
  setWsStatus:          (status: 'disconnected' | 'connecting' | 'connected') => void
  setKeysRegistered:    (val: boolean) => void
  markConvRead:         (convId: string) => void
  setSendTypingFn:      (fn: (convId: string, isTyping: boolean) => void) => void
  sendTyping:           (convId: string, isTyping: boolean) => void
  setSendCallSignalFn:  (fn: (toUserId: string, signal: object) => void) => void
  sendCallSignal:       (toUserId: string, signal: object) => void
  setIncomingCall:      (call: IncomingCall | null) => void
  setActiveCall:        (call: ActiveCall | null) => void
  setPreCallState:      (state: PreCallState | null) => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations:      [],
  activeConvId:       null,
  messages:           {},
  typingUsers:        {},
  onlineUsers:        new Set(),
  isLoadingConvs:     false,
  isLoadingMsgs:      false,
  wsStatus:           'disconnected',
  keysRegistered:     false,
  sendTypingFn:       null,
  sendCallSignalFn:   null,
  incomingCall:       null,
  activeCall:         null,
  preCallState:       null,

  setActiveConv: (convId) => set({ activeConvId: convId }),

  fetchConversations: async () => {
    set({ isLoadingConvs: true })
    try {
      const convs = await chatApi.listConversations()
      set({ conversations: convs })
    } catch (e) {
      console.error('fetchConversations', e)
    } finally {
      set({ isLoadingConvs: false })
    }
  },

  fetchMessages: async (convId, before) => {
    set({ isLoadingMsgs: true })
    try {
      const msgs = await chatApi.listMessages(convId, 50, before)
      const decoded: DecodedMessage[] = msgs.map(m => ({
        ...m,
        plaintext: tryDecodeText(m.encrypted_data),
      }))
      set(s => ({
        messages: {
          ...s.messages,
          [convId]: before
            ? [...decoded.reverse(), ...(s.messages[convId] ?? [])]
            : decoded.reverse(),
        },
      }))
    } catch (e) {
      console.error('fetchMessages', e)
    } finally {
      set({ isLoadingMsgs: false })
    }
  },

  appendMessage: (convId, msg) => {
    set(s => ({
      messages: {
        ...s.messages,
        [convId]: [...(s.messages[convId] ?? []), msg],
      },
      conversations: s.conversations.map(c =>
        c.conversation.id === convId
          ? { ...c, conversation: { ...c.conversation, updated_at: msg.created_at } }
          : c
      ),
    }))
  },

  updateMessage: (convId, partial) => {
    set(s => ({
      messages: {
        ...s.messages,
        [convId]: (s.messages[convId] ?? []).map(m =>
          m.id === partial.id ? { ...m, ...partial } : m
        ),
      },
    }))
  },

  removeMessage: (convId, msgId) => {
    set(s => ({
      messages: {
        ...s.messages,
        [convId]: (s.messages[convId] ?? []).map(m =>
          m.id === msgId ? { ...m, message_type: 'deleted', plaintext: null } : m
        ),
      },
    }))
  },

  setTyping: (convId, userId, isTyping) => {
    set(s => {
      const current = s.typingUsers[convId] ?? []
      const next    = isTyping
        ? [...new Set([...current, userId])]
        : current.filter(id => id !== userId)
      return { typingUsers: { ...s.typingUsers, [convId]: next } }
    })
  },

  setUserOnline: (userId, online) => {
    set(s => {
      const next = new Set(s.onlineUsers)
      if (online) next.add(userId); else next.delete(userId)
      return { onlineUsers: next }
    })
  },

  setWsStatus:          (wsStatus)       => set({ wsStatus }),
  setKeysRegistered:    (keysRegistered) => set({ keysRegistered }),
  setSendTypingFn:      (fn) => set({ sendTypingFn: fn }),
  sendTyping:           (convId, isTyping) => get().sendTypingFn?.(convId, isTyping),
  setSendCallSignalFn:  (fn) => set({ sendCallSignalFn: fn }),
  sendCallSignal:       (toUserId, signal) => get().sendCallSignalFn?.(toUserId, signal),
  setIncomingCall:      (call) => set({ incomingCall: call }),
  setActiveCall:        (call) => set({ activeCall: call }),
  setPreCallState:      (state) => set({ preCallState: state }),

  markConvRead: (convId) => {
    set(s => ({
      conversations: s.conversations.map(c =>
        c.conversation.id === convId ? { ...c, unread_count: 0 } : c
      ),
    }))
    const msgs = get().messages[convId]
    if (msgs?.length) {
      chatApi.markRead(convId, msgs[msgs.length - 1].id).catch(() => {})
    }
  },
}))

// Tente de décoder un message texte simple (non-chiffré ou JSON simple)
function tryDecodeText(encrypted: string): string | null {
  try {
    // Si c'est du JSON avec un champ "text", on l'affiche directement
    const parsed = JSON.parse(atob(encrypted.replace(/-/g, '+').replace(/_/g, '/')))
    if (typeof parsed?.text === 'string') return parsed.text
  } catch {}
  // Si c'est du texte base64 simple
  try {
    return atob(encrypted.replace(/-/g, '+').replace(/_/g, '/'))
  } catch {}
  return null
}

// Helper: encoder un message texte avant envoi
export function encodeTextMessage(text: string): { encrypted_data: string; nonce: string } {
  const payload = JSON.stringify({ text })
  const b64     = btoa(payload).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  const nonceBytes = crypto.getRandomValues(new Uint8Array(24))
  const nonce   = btoa(String.fromCharCode(...nonceBytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  return { encrypted_data: b64, nonce }
}

export function getConvName(conv: Conversation, currentUserId: string, otherUser?: OtherUser | null): string {
  if (conv.name) return conv.name
  if (conv.conv_type === 'direct') {
    if (otherUser) return otherUser.display_name ?? otherUser.username
    const otherId = conv.user_a_id === currentUserId ? conv.user_b_id : conv.user_a_id
    return otherId ? otherId.slice(0, 8) + '…' : 'Direct'
  }
  return 'Conversation'
}
