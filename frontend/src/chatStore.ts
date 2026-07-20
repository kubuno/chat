import { create } from 'zustand'
import { chatApi, Conversation, ConversationSummary, DecodedMessage, MediaPayload, Message, OtherUser, PollPayload } from './api'
import { isKubunoDataEnvelope, type KubunoDataEnvelope } from './kubunoData'

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

/** Main-area view selected from the sidebar shortcuts. */
export type HomeView = 'home' | 'mentions' | 'starred' | 'browse'
/** Presence, as accepted by chat.presence.status. */
export type PresenceStatus = 'online' | 'away' | 'dnd' | 'offline'
/** How the active conversation is displayed: side panel over the home list, or full width. */
export type ConvDisplay = 'panel' | 'full'

interface ChatState {
  conversations:      ConversationSummary[]
  activeConvId:       string | null
  homeView:           HomeView
  convDisplay:        ConvDisplay
  threadMode:         boolean
  /** Conversations opened as floating pop-up windows (docked bottom-right). */
  popupConvIds:       string[]
  minimizedPopups:    string[]
  messages:           Record<string, DecodedMessage[]>  // keyed by conv_id
  typingUsers:        Record<string, string[]>           // conv_id → user_ids
  onlineUsers:        Set<string>
  /** Fine-grained presence per user (online | away | dnd | offline) + custom text. */
  userStatus:         Record<string, { status: PresenceStatus; custom_status?: string | null }>
  /** My own status, as picked in the header menu. */
  myStatus:           PresenceStatus
  myCustomStatus:     string | null
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
  setHomeView:          (view: HomeView) => void
  setConvDisplay:       (display: ConvDisplay) => void
  setThreadMode:        (on: boolean) => void
  openPopup:            (convId: string) => void
  closePopup:           (convId: string) => void
  togglePopupMinimized: (convId: string) => void
  fetchConversations:   () => Promise<void>
  /** Local reaction to an incoming message: reorder + counters, no HTTP round-trip. */
  bumpConversation:     (convId: string, fromMe: boolean) => void
  fetchMessages:        (convId: string, before?: string) => Promise<void>
  appendMessage:        (convId: string, msg: DecodedMessage) => void
  updateMessage:        (convId: string, msg: Partial<Message> & { id: string }) => void
  removeMessage:        (convId: string, msgId: string) => void
  applyReaction:        (convId: string, msgId: string, emoji: string, userId: string, add: boolean) => void
  setTyping:            (convId: string, userId: string, isTyping: boolean) => void
  setUserOnline:        (userId: string, online: boolean) => void
  setUserPresence:      (userId: string, status: PresenceStatus, customStatus?: string | null) => void
  setMyStatus:          (status: PresenceStatus, customStatus?: string | null) => void
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

// Replies grouped under their root message — a workspace-wide preference.
const THREAD_KEY = 'kubuno.chat.threadMode'

function readThreadMode(): boolean {
  try { return localStorage.getItem(THREAD_KEY) === '1' } catch { return false }
}

// Pop-up conversations survive a page reload (the dock is part of the workspace).
const POPUPS_KEY = 'kubuno.chat.popups'

function readPopups(): string[] {
  try {
    const raw = localStorage.getItem(POPUPS_KEY)
    if (!raw) return []
    const ids = JSON.parse(raw)
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string').slice(-3) : []
  } catch {
    return []
  }
}

function writePopups(ids: string[]): void {
  try {
    localStorage.setItem(POPUPS_KEY, JSON.stringify(ids))
  } catch { /* storage full or disabled — pop-ups just won't persist */ }
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations:      [],
  activeConvId:       null,
  homeView:           'home',
  convDisplay:        'panel',
  threadMode:         readThreadMode(),
  popupConvIds:       readPopups(),
  minimizedPopups:    [],
  messages:           {},
  typingUsers:        {},
  onlineUsers:        new Set(),
  userStatus:         {},
  myStatus:           'online',
  myCustomStatus:     null,
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
  setHomeView: (view) => set({ homeView: view, activeConvId: null }),
  setConvDisplay: (display) => set({ convDisplay: display }),
  setThreadMode: (on) => {
    try { localStorage.setItem(THREAD_KEY, on ? '1' : '0') } catch { /* best effort */ }
    set({ threadMode: on })
  },

  // Pop-ups are capped: past 3, the oldest one is dropped (like a chat dock).
  openPopup: (convId) => set(s => {
    if (s.popupConvIds.includes(convId)) {
      return { minimizedPopups: s.minimizedPopups.filter(id => id !== convId) }
    }
    const next = [...s.popupConvIds, convId].slice(-3)
    writePopups(next)
    return {
      popupConvIds: next,
      minimizedPopups: s.minimizedPopups.filter(id => next.includes(id)),
      // A conversation shown as a pop-up shouldn't stay open in the main area.
      activeConvId: s.activeConvId === convId ? null : s.activeConvId,
    }
  }),
  closePopup: (convId) => set(s => {
    const next = s.popupConvIds.filter(id => id !== convId)
    writePopups(next)
    return {
      popupConvIds: next,
      minimizedPopups: s.minimizedPopups.filter(id => id !== convId),
    }
  }),
  togglePopupMinimized: (convId) => set(s => ({
    minimizedPopups: s.minimizedPopups.includes(convId)
      ? s.minimizedPopups.filter(id => id !== convId)
      : [...s.minimizedPopups, convId],
  })),

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

  bumpConversation: (convId, fromMe) => {
    const { conversations, activeConvId } = get()
    const idx = conversations.findIndex(c => c.conversation.id === convId)
    if (idx < 0) {
      // Unknown conversation (just created elsewhere) — this one needs the server.
      get().fetchConversations()
      return
    }
    const now = new Date().toISOString()
    const isActive = activeConvId === convId
    const bumped = {
      ...conversations[idx],
      conversation: { ...conversations[idx].conversation, updated_at: now },
      // The open conversation is being read right now — don't flash a badge on it.
      ...(fromMe || isActive ? {} : {
        unread_count: conversations[idx].unread_count + 1,
        is_unread: true,
      }),
    }
    set({ conversations: [bumped, ...conversations.filter((_, i) => i !== idx)] })
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

  // A user counts as reachable ("online dot") for online AND dnd/away — they are
  // connected, just not to be disturbed; only 'offline' clears the dot.
  setUserPresence: (userId, status, customStatus) => {
    set(s => {
      const next = new Set(s.onlineUsers)
      if (status === 'offline') next.delete(userId)
      else next.add(userId)
      return {
        onlineUsers: next,
        userStatus: { ...s.userStatus, [userId]: { status, custom_status: customStatus ?? null } },
      }
    })
  },

  setMyStatus: (status, customStatus) => {
    set({ myStatus: status, myCustomStatus: customStatus ?? null })
    chatApi.updatePresence(status, customStatus ?? undefined).catch(e => console.error('updatePresence', e))
  },

  markConvRead: (convId) => {
    set(s => ({
      conversations: s.conversations.map(c =>
        c.conversation.id === convId ? { ...c, unread_count: 0, is_unread: false } : c
      ),
    }))
    const msgs = get().messages[convId]
    if (msgs?.length) {
      chatApi.markRead(convId, msgs[msgs.length - 1].id).catch(() => {})
    } else {
      // No message to acknowledge — clear an explicit "mark as unread" instead.
      chatApi.updateMemberSettings(convId, { mark_unread: false }).catch(() => {})
    }
  },
}))

// Decodes a message envelope: clear text + optional media/poll/card descriptors.
export function decodeEnvelope(encrypted: string): { text: string | null; media: MediaPayload | null; poll: PollPayload | null; card: KubunoDataEnvelope | null } {
  try {
    const parsed = JSON.parse(decodeURIComponent(escape(atob(encrypted.replace(/-/g, '+').replace(/_/g, '/')))))
    const text  = typeof parsed?.text === 'string' ? parsed.text : null
    const media = parsed?.media && typeof parsed.media?.media_id === 'string' ? parsed.media as MediaPayload : null
    const poll  = parsed?.poll && Array.isArray(parsed.poll?.options)
      ? { question: typeof parsed.poll.question === 'string' ? parsed.poll.question : (text ?? ''), options: parsed.poll.options as string[] }
      : null
    const card  = isKubunoDataEnvelope(parsed?.card) ? parsed.card : null
    if (text !== null || media !== null || poll !== null || card !== null) return { text, media, poll, card }
  } catch {}
  // Fallback: plain base64 text
  try {
    return { text: atob(encrypted.replace(/-/g, '+').replace(/_/g, '/')), media: null, poll: null, card: null }
  } catch {}
  return { text: null, media: null, poll: null, card: null }
}

// Builds a DecodedMessage from a raw server message.
export function decodeMessage(m: Message): DecodedMessage {
  const { text, media, poll, card } = decodeEnvelope(m.encrypted_data)
  return { ...m, plaintext: text, media, poll, card }
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

// Helper: encode a cross-module data card (pasted JSON envelope) with an
// optional caption. The card travels inside the opaque envelope like polls —
// the server never reads it, and message_type stays 'text' (no migration).
export function encodeCardMessage(card: KubunoDataEnvelope, caption?: string): { encrypted_data: string; nonce: string } {
  return { encrypted_data: b64urlEncode(JSON.stringify({ text: caption ?? '', card })), nonce: randomNonce() }
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
