import { create } from 'zustand'
import { chatApi, Conversation, ConversationSummary, DecodedMessage, MediaPayload, Message, OtherUser, PollPayload } from './api'

export interface IncomingCall {
  room:        string   // conversation id (or meeting room)
  fromUserId:  string
  fromName:    string
  type:        'audio' | 'video'
}

export interface CallParticipant {
  userId: string
  name:   string
}

// A call is a full-mesh session bound to a conversation/meeting room. A 1:1 call
// is simply a 2-participant mesh. Peers discover each other via signaling.
export interface ActiveCall {
  room:        string             // conversation id (or meeting room id)
  title:       string             // display title
  type:        'audio' | 'video'
  isInitiator: boolean
  ring:        CallParticipant[]  // members to ring when starting (empty when joining)
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
  applyReaction:        (convId: string, msgId: string, emoji: string, userId: string, add: boolean) => void
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
      const { messages: rawMsgs, reactions } = await chatApi.listMessages(convId, 50, before)
      const byMsg: Record<string, { emoji: string; user_id: string }[]> = {}
      ;(reactions ?? []).forEach(r => { (byMsg[r.message_id] ??= []).push({ emoji: r.emoji, user_id: r.user_id }) })
      const decoded: DecodedMessage[] = rawMsgs.map(m => ({ ...decodeMessage(m), reactions: byMsg[m.id] ?? [] }))
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
    set(s => {
      const existing = s.messages[convId] ?? []
      // Idempotent: a message may arrive twice (optimistic send + WS, or a
      // scheduled message delivered later). Replace in place rather than dup.
      const list = existing.some(m => m.id === msg.id)
        ? existing.map(m => (m.id === msg.id ? { ...m, ...msg } : m))
        : [...existing, msg]
      return {
        messages: {
          ...s.messages,
          [convId]: list,
        },
        conversations: s.conversations.map(c =>
          c.conversation.id === convId
            ? { ...c, conversation: { ...c.conversation, updated_at: msg.created_at } }
            : c
        ),
      }
    })
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

  applyReaction: (convId, msgId, emoji, userId, add) => {
    set(s => ({
      messages: {
        ...s.messages,
        [convId]: (s.messages[convId] ?? []).map(m => {
          if (m.id !== msgId) return m
          const list = (m.reactions ?? []).filter(r => !(r.emoji === emoji && r.user_id === userId))
          if (add) list.push({ emoji, user_id: userId })
          return { ...m, reactions: list }
        }),
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

// Décode l'enveloppe d'un message : texte clair + descripteur média éventuel.
export function decodeEnvelope(encrypted: string): { text: string | null; media: MediaPayload | null; poll: PollPayload | null } {
  try {
    const parsed = JSON.parse(decodeURIComponent(escape(atob(encrypted.replace(/-/g, '+').replace(/_/g, '/')))))
    const text  = typeof parsed?.text === 'string' ? parsed.text : null
    const media = parsed?.media && typeof parsed.media?.media_id === 'string' ? parsed.media as MediaPayload : null
    const poll  = parsed?.poll && Array.isArray(parsed.poll?.options)
      ? { question: typeof parsed.poll.question === 'string' ? parsed.poll.question : (text ?? ''), options: parsed.poll.options as string[] }
      : null
    if (text !== null || media !== null || poll !== null) return { text, media, poll }
  } catch {}
  // Repli : texte base64 simple
  try {
    return { text: atob(encrypted.replace(/-/g, '+').replace(/_/g, '/')), media: null, poll: null }
  } catch {}
  return { text: null, media: null, poll: null }
}

// Construit un DecodedMessage à partir d'un message brut serveur.
export function decodeMessage(m: Message): DecodedMessage {
  const { text, media, poll } = decodeEnvelope(m.encrypted_data)
  return { ...m, plaintext: text, media, poll }
}

// Encode un sondage : question + options voyagent chiffrés dans l'enveloppe ;
// le serveur ne voit que les index de vote.
export function encodePollMessage(question: string, options: string[]): { encrypted_data: string; nonce: string } {
  return { encrypted_data: b64urlEncode(JSON.stringify({ text: question, poll: { question, options } })), nonce: randomNonce() }
}

function b64urlEncode(s: string): string {
  // unescape(encodeURIComponent(...)) → UTF-8 safe avant btoa
  return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

// Helper: encoder un message texte avant envoi
export function encodeTextMessage(text: string): { encrypted_data: string; nonce: string } {
  return { encrypted_data: b64urlEncode(JSON.stringify({ text })), nonce: randomNonce() }
}

// Helper: encoder un message média (image/vidéo/audio/fichier/vocal) avant envoi.
// La clé/iv du blob voyagent ici, dans l'enveloppe — invisibles au serveur.
export function encodeMediaMessage(media: MediaPayload, caption?: string): { encrypted_data: string; nonce: string } {
  return { encrypted_data: b64urlEncode(JSON.stringify({ text: caption ?? '', media })), nonce: randomNonce() }
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
