import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Phone, Video, Info, Pin, Forward, X, BarChart3, Search, ChevronDown, Maximize2, Lock, MessagesSquare, CornerDownRight, UserPlus, FileUp, ListTodo, FolderOpen, PictureInPicture2 } from 'lucide-react'
import { MenuDropdown, useMenuDropdown, ConfirmDialog, Button } from '@ui'
import { ModuleServiceRegistry } from '@kubuno/sdk'
import { useConvActions } from './useConvActions'
import { useChatStore, getConvName, encodeTextMessage, encodeMediaMessage, encodePollMessage, encodeCardMessage, CallParticipant } from './chatStore'
import type { KubunoDataEnvelope } from './kubunoData'
import { useAuthStore } from '@kubuno/sdk'
import { chatApi, DecodedMessage, MediaPayload, type GifResult } from './api'
import { encryptBlob } from './crypto/media'
import type { Sticker } from './stickers'
import MessageBubble from './MessageBubble'
import MessageInput from './MessageInput'
import { useInitiateCall } from './CallWindow'
import InfoPanel from './InfoPanel'
import ConvFilesPanel from './ConvFilesPanel'
import { CHAT_BG_STYLE } from './chatPattern'
import PreCallModal from './PreCallModal'

interface Props {
  convId:       string
  onBack?:      () => void  // mobile / single pane: back to the list
  sendTyping:   (convId: string, isTyping: boolean) => void
  // Side-panel mode (dual pane): expand to full width / close the panel.
  onExpand?:      () => void
  onClosePanel?:  () => void
  /** Pop-up window: the window chrome already shows the title — drop our header. */
  compact?:       boolean
}

export default function ConversationView({ convId, onBack, sendTyping, onExpand, onClosePanel, compact = false }: Props) {
  const { t, i18n }    = useTranslation('chat')
  const locale         = i18n.language
  const currentUser    = useAuthStore(s => s.user)
  const conversations  = useChatStore(s => s.conversations)
  const messages       = useChatStore(s => s.messages[convId]) ?? []
  const typingUsers    = useChatStore(s => s.typingUsers[convId]) ?? []
  // Thread view (replies grouped under their root) — shared with the home header toggle.
  const threadMode     = useChatStore(s => s.threadMode)
  const setThreadMode  = useChatStore(s => s.setThreadMode)
  const { fetchMessages, appendMessage, markConvRead } = useChatStore()

  const [replyTo,       setReplyTo]      = useState<DecodedMessage | null>(null)
  const [pendingCard,   setPendingCard]  = useState<KubunoDataEnvelope | null>(null)
  const [forwardMsg,    setForwardMsg]   = useState<DecodedMessage | null>(null)
  const [pollOpen,      setPollOpen]     = useState(false)
  const [ephemeralSecs, setEphemeralSecs] = useState(0)   // 0 = off ; TTL en secondes
  const [members,       setMembers]      = useState<{ userId: string; name: string; username: string }[]>([])
  // Every member, self included — used to label message groups with their author.
  const [memberNames,   setMemberNames]  = useState<Record<string, string>>({})
  const [memberAvatars, setMemberAvatars] = useState<Record<string, string | null>>({})
  const [searchOpen,    setSearchOpen]   = useState(false)
  const [searchQuery,   setSearchQuery]  = useState('')
  const [readState,     setReadState]    = useState<{ user_id: string; last_read_at: string }[]>([])
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [showInfo,      setShowInfo]     = useState(false)
  const [showFiles,     setShowFiles]    = useState(false)
  const [preCallType,   setPreCallType]  = useState<'audio' | 'video' | null>(null)
  const [groupMembers,  setGroupMembers] = useState<CallParticipant[]>([])
  const bottomRef  = useRef<HTMLDivElement>(null)
  const listRef    = useRef<HTMLDivElement>(null)
  // Scroll bookkeeping: id of the newest message already seen (to tell an append
  // from a prepend), and the last message acknowledged as read.
  const newestIdRef  = useRef<string | null>(null)
  // Sentinel ≠ null: an empty conversation still needs its first read-ack (it
  // clears a hand-set "unread" flag), and its newest id IS null.
  const lastAckedRef = useRef<string | null | undefined>(undefined)

  const convSummary  = conversations.find(c => c.conversation.id === convId)
  const conv         = convSummary?.conversation
  const convName     = conv ? getConvName(conv, currentUser?.id ?? '', convSummary?.other_user) : '…'
  const isGroupConv  = conv?.conv_type !== 'direct'

  const startCall    = useInitiateCall()
  const myId         = currentUser?.id ?? ''

  // Tasks integration is optional: the button only exists if the module is installed
  // and publishes the service (no hard dependency on it).
  const taskService = ModuleServiceRegistry.get<
    (opts?: { title?: string }) => Promise<{ id: string; title: string } | null>
  >('tasks', 'createTask')

  async function assignTask() {
    const task = await taskService?.().catch(() => null)
    if (task) await sendMessage(t('chat_task_created', { title: task.title, defaultValue: 'Tâche créée : {{title}}' }))
  }

  // Header dropdown on the conversation name — same actions as the list rows.
  const headerMenu = useMenuDropdown()
  const {
    buildItems,
    confirmState: convConfirmState,
    handleConfirm: handleConvConfirm,
    handleCancel: handleConvCancel,
  } = useConvActions()

  useEffect(() => {
    fetchMessages(convId)
    // Members power @mention autocomplete (groups mostly).
    chatApi.getConversation(convId).then(res => {
      setMembers((res.members ?? []).filter(m => m.user_id !== (currentUser?.id ?? ''))
        .map(m => ({ userId: m.user_id, name: m.display_name ?? m.username, username: m.username })))
      const names: Record<string, string> = {}
      const avatars: Record<string, string | null> = {}
      for (const m of res.members ?? []) {
        names[m.user_id] = m.display_name ?? m.username
        avatars[m.user_id] = m.avatar_url ?? null
      }
      setMemberNames(names)
      setMemberAvatars(avatars)
    }).catch(() => { setMembers([]); setMemberNames({}); setMemberAvatars({}) })
  }, [convId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset the scroll bookkeeping when switching conversation.
  useEffect(() => {
    newestIdRef.current = null
    lastAckedRef.current = undefined
  }, [convId])

  useEffect(() => {
    const newest = messages.length ? messages[messages.length - 1].id : null
    const list = listRef.current

    if (newestIdRef.current === null) {
      // First paint of this conversation: land at the bottom instantly — a smooth
      // animation across the whole history reads as flicker.
      bottomRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior })
    } else if (newest !== newestIdRef.current) {
      // A genuinely new message at the bottom. Only follow it if the user is
      // already near the bottom (or it's their own) — never yank them out of
      // reading older history.
      const own = messages[messages.length - 1]?.sender_id === myId
      const nearBottom = list
        ? list.scrollHeight - list.scrollTop - list.clientHeight < 160
        : true
      if (own || nearBottom) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
    // else: older messages were prepended (load previous) — leave the scroll alone.
    newestIdRef.current = newest

    // Acknowledge reads once per newest message, not on every render.
    if (lastAckedRef.current !== newest) {
      lastAckedRef.current = newest
      markConvRead(convId)
    }
  }, [convId, messages.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Read receipts power the group "seen by N" indicator.
  useEffect(() => {
    if (!isGroupConv) { setReadState([]); return }
    chatApi.getReadState(convId).then(setReadState).catch(() => setReadState([]))
  }, [convId, messages.length, isGroupConv]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadMore() {
    const oldest = messages[0]
    if (!oldest || isLoadingMore) return
    setIsLoadingMore(true)
    // Keep the viewport anchored on the message the user was looking at: measure
    // the content height before the prepend, restore the delta after.
    const list = listRef.current
    const before = list ? list.scrollHeight - list.scrollTop : 0
    await fetchMessages(convId, oldest.id)
    requestAnimationFrame(() => {
      if (list) list.scrollTop = list.scrollHeight - before
    })
    setIsLoadingMore(false)
  }

  async function sendMessage(text: string, scheduledAt?: string) {
    if (!currentUser) return
    // A pending cross-module card rides in the envelope with the caption text.
    const card = pendingCard
    const { encrypted_data, nonce } = card ? encodeCardMessage(card, text) : encodeTextMessage(text)
    try {
      const msg = await chatApi.sendMessage(convId, {
        encrypted_data,
        nonce,
        ...(replyTo ? { reply_to_id: replyTo.id } : {}),
        ...(ephemeralSecs ? { expires_in_secs: ephemeralSecs } : {}),
        ...(scheduledAt ? { scheduled_at: scheduledAt } : {}),
      })
      // A scheduled message stays invisible until due — don't append it now
      // (the list endpoint shows it back to its sender on the next load).
      if (!scheduledAt) appendMessage(convId, { ...msg, plaintext: text, ...(card ? { card } : {}) })
      setReplyTo(null)
      setPendingCard(null)
    } catch (e) {
      console.error('sendMessage', e)
    }
  }

  async function sendPoll(question: string, options: string[]) {
    setPollOpen(false)
    const { encrypted_data, nonce } = encodePollMessage(question, options)
    try {
      const msg = await chatApi.sendMessage(convId, {
        encrypted_data, nonce, message_type: 'poll',
        ...(ephemeralSecs ? { expires_in_secs: ephemeralSecs } : {}),
      })
      appendMessage(convId, { ...msg, plaintext: question, poll: { question, options } })
    } catch (e) { console.error('sendPoll', e) }
  }

  // Chiffre un blob, l'upload (le serveur ne stocke que le ciphertext), puis
  // envoie un message média dont l'enveloppe porte la clé/iv de déchiffrement.
  async function pushMedia(
    blob: Blob,
    info: { mime: string; name: string; kind: MediaPayload['kind']; width?: number; height?: number; duration?: number; voice?: boolean; waveform?: number[] },
    caption?: string,
  ) {
    if (!currentUser) return
    const { cipher, key, iv } = await encryptBlob(blob)
    const encFile = new File([cipher], `${crypto.randomUUID()}.enc`, { type: 'application/octet-stream' })
    const { media_id } = await chatApi.uploadMedia(encFile)
    const media: MediaPayload = {
      media_id, key, iv, mime: info.mime, name: info.name, size: blob.size, kind: info.kind,
      width: info.width, height: info.height, duration: info.duration, voice: info.voice, waveform: info.waveform,
    }
    // media_meta = métadonnées non sensibles visibles du serveur (dont media_id
    // requis pour le contrôle d'accès au téléchargement).
    const media_meta: Record<string, unknown> = { media_id, kind: info.kind, size: blob.size }
    if (info.width)    media_meta.width = info.width
    if (info.height)   media_meta.height = info.height
    if (info.duration) media_meta.duration = info.duration
    const { encrypted_data, nonce } = encodeMediaMessage(media, caption)
    // Stickers and GIFs are images as far as the server is concerned — the
    // message_type column only accepts the historical set. Their real kind
    // lives in the (encrypted) envelope and drives the bubble-less rendering.
    const messageType = info.kind === 'sticker' || info.kind === 'gif' ? 'image' : info.kind
    const msg = await chatApi.sendMessage(convId, {
      encrypted_data, nonce, message_type: messageType, media_meta,
      ...(replyTo ? { reply_to_id: replyTo.id } : {}),
      ...(ephemeralSecs ? { expires_in_secs: ephemeralSecs } : {}),
    })
    appendMessage(convId, { ...msg, plaintext: caption ?? '', media })
    setReplyTo(null)
  }

  async function sendFiles(files: File[], caption?: string) {
    for (const [i, file] of files.entries()) {
      const mime = file.type || 'application/octet-stream'
      const kind: MediaPayload['kind'] =
        mime.startsWith('image/') ? 'image' :
        mime.startsWith('video/') ? 'video' :
        mime.startsWith('audio/') ? 'audio' : 'file'
      let dims: { width?: number; height?: number } = {}
      if (kind === 'image') dims = await imageDimensions(file)
      // The typed text rides as the caption of the last file (WhatsApp-like).
      const cap = i === files.length - 1 ? caption : undefined
      try { await pushMedia(file, { mime, name: file.name, kind, ...dims }, cap) }
      catch (e) { console.error('sendFile', e) }
    }
  }

  async function sendVoice(blob: Blob, durationSec: number, waveform: number[]) {
    try {
      await pushMedia(blob, { mime: blob.type || 'audio/webm', name: 'message-vocal.webm', kind: 'audio', duration: durationSec, voice: true, waveform })
    } catch (e) { console.error('sendVoice', e) }
  }

  // A picked GIF is pulled back through the module (the browser never talks to
  // GIPHY for the send), then encrypted and uploaded like any other media — so
  // recipients fetch it from Kubuno, not from a third party.
  async function sendGif(gif: GifResult) {
    try {
      const blob = await chatApi.fetchGif(gif.url)
      await pushMedia(blob, {
        mime: blob.type || 'image/gif',
        name: `${gif.title?.trim() || 'gif'}.gif`,
        kind: 'gif',
        width: gif.width,
        height: gif.height,
      })
    } catch (e) { console.error('sendGif', e) }
  }

  async function sendSticker(sticker: Sticker) {
    try {
      await pushMedia(sticker.blob, {
        mime: 'image/png', name: 'sticker.png', kind: 'sticker',
        width: sticker.width, height: sticker.height,
      })
    } catch (e) { console.error('sendSticker', e) }
  }

  // Forward a message's content to another conversation. Media is re-referenced
  // by media_id (the new message lives in the target conv → access is granted).
  async function forwardTo(targetConvId: string, m: DecodedMessage) {
    const env = m.media
      ? encodeMediaMessage(m.media, m.plaintext ?? '')
      : encodeTextMessage(m.plaintext ?? '')
    const media_meta = m.media
      ? { media_id: m.media.media_id, kind: m.media.kind, size: m.media.size,
          ...(m.media.width ? { width: m.media.width } : {}), ...(m.media.height ? { height: m.media.height } : {}),
          ...(m.media.duration ? { duration: m.media.duration } : {}) }
      : undefined
    try {
      const msg = await chatApi.sendMessage(targetConvId, {
        encrypted_data: env.encrypted_data, nonce: env.nonce,
        message_type: m.media ? m.media.kind : 'text',
        ...(media_meta ? { media_meta } : {}),
      })
      appendMessage(targetConvId, { ...msg, plaintext: m.plaintext ?? '', media: m.media ?? null })
    } catch (e) { console.error('forward', e) }
    setForwardMsg(null)
  }

  // Pinned banner: derive from currently-loaded messages flagged is_pinned.
  const pinnedMessages = messages.filter(m => m.is_pinned && m.message_type !== 'deleted')

  // In-conversation search filters the loaded messages by decoded text.
  const visibleMessages = searchOpen && searchQuery.trim()
    ? messages.filter(m => m.plaintext?.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : messages

  // Thread view: group replies under their root message. The root is derived by
  // walking up reply_to_id — there is no thread_root_id in the schema, and none
  // is needed as long as the ancestors are in the loaded page (when one isn't,
  // the chain simply stops there and that message becomes a local root).
  const threadedMessages = useMemo(() => {
    type Node = { msg: DecodedMessage; replies: DecodedMessage[] }
    if (!threadMode) return visibleMessages.map(msg => ({ msg, replies: [] as DecodedMessage[] }))

    const rootOf = new Map<string, string>()
    const nodes = new Map<string, Node>()
    const order: string[] = []

    for (const msg of visibleMessages) {
      // Messages arrive in chronological order, so a parent is always seen first.
      const parentRoot = msg.reply_to_id ? rootOf.get(msg.reply_to_id) : undefined
      if (parentRoot && nodes.has(parentRoot)) {
        rootOf.set(msg.id, parentRoot)
        nodes.get(parentRoot)!.replies.push(msg)
      } else {
        rootOf.set(msg.id, msg.id)
        nodes.set(msg.id, { msg, replies: [] })
        order.push(msg.id)
      }
    }
    return order.map(id => nodes.get(id)!)
  }, [visibleMessages, threadMode])

  async function handleCallClick(type: 'audio' | 'video') {
    if (!conv) return
    if (!isGroupConv) {
      // Direct conversation: ring the single peer and open the call.
      const peerId   = convSummary?.other_user?.id ?? ''
      const peerName = convSummary?.other_user?.display_name ?? convSummary?.other_user?.username ?? convName
      startCall(convId, convName, type, peerId ? [{ userId: peerId, name: peerName }] : [])
      return
    }
    // Group: fetch members and show pre-call selection
    try {
      const res = await chatApi.getConversation(convId)
      const candidates: CallParticipant[] = (res.members ?? [])
        .filter(m => m.user_id !== myId)
        .map(m => ({ userId: m.user_id, name: m.display_name ?? m.username }))
      setGroupMembers(candidates)
      setPreCallType(type)
    } catch (e) { console.error(e) }
  }

  function handlePreCallStart(participants: CallParticipant[], type: 'audio' | 'video') {
    setPreCallType(null)
    if (participants.length === 0) return
    // Mesh call: ring all selected participants; the session connects everyone.
    startCall(convId, convName, type, participants)
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative" style={CHAT_BG_STYLE}>
      {/* Shared files, as a right-hand drawer over the conversation. */}
      {showFiles && !compact && (
        <div className="absolute inset-y-0 right-0 z-20 flex shadow-xl">
          <ConvFilesPanel convId={convId} memberNames={memberNames} onClose={() => setShowFiles(false)} />
        </div>
      )}

      {/* Header conversation */}
      <div className={`items-center gap-3 px-4 py-3 border-b border-gray-200 bg-white flex-shrink-0 no-print ${compact ? 'hidden' : 'flex'}`}>
        {onBack && (
          <button onClick={onBack} className="p-1 rounded-full hover:bg-gray-100 mr-1">
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
        )}
        <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-semibold text-sm flex-shrink-0">
          {convName[0]?.toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          {/* The name opens the conversation menu (same actions as the list rows). */}
          <button
            onClick={e => headerMenu.open(e)}
            className="flex items-center gap-1 max-w-full rounded-lg px-1 -mx-1 hover:bg-gray-100"
            aria-haspopup="menu"
          >
            <span className="font-medium text-gray-900 truncate text-sm">{convName}</span>
            <ChevronDown className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
          </button>
          {typingUsers.length > 0 ? (
            <p className="text-xs text-blue-500 italic">{t('chat_typing')}</p>
          ) : (
            <p className="text-xs text-gray-400">
              {t('chat_member_count', { count: convSummary?.member_count ?? 1 })}
            </p>
          )}
        </div>
        {/* Call & info buttons */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => handleCallClick('audio')}
            className="p-2 rounded-full hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
            title={t('chat_audio_call')}
          >
            <Phone className="w-4 h-4" />
          </button>
          <button
            onClick={() => handleCallClick('video')}
            className="p-2 rounded-full hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
            title={t('chat_video_call')}
          >
            <Video className="w-4 h-4" />
          </button>
          <button
            onClick={() => { setSearchOpen(v => !v); setSearchQuery('') }}
            className={`p-2 rounded-full hover:bg-gray-100 transition-colors ${searchOpen ? 'text-blue-600 bg-blue-50' : 'text-gray-500 hover:text-gray-700'}`}
            title={t('common_search', { defaultValue: 'Rechercher' })}
          >
            <Search className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowFiles(v => !v)}
            className={`p-2 rounded-full hover:bg-gray-100 transition-colors ${showFiles ? 'text-blue-600 bg-blue-50' : 'text-gray-500 hover:text-gray-700'}`}
            title={t('chat_shared_files', { defaultValue: 'Fichiers partagés' })}
            aria-pressed={showFiles}
          >
            <FolderOpen className="w-4 h-4" />
          </button>
          <button
            onClick={() => setThreadMode(!threadMode)}
            className={`p-2 rounded-full hover:bg-gray-100 transition-colors ${threadMode ? 'text-blue-600 bg-blue-50' : 'text-gray-500 hover:text-gray-700'}`}
            title={t('chat_thread_mode', { defaultValue: 'Fil de discussion' })}
            aria-pressed={threadMode}
          >
            <MessagesSquare className="w-4 h-4" />
          </button>
          <button
            onClick={() => useChatStore.getState().openPopup(convId)}
            className="p-2 rounded-full hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
            title={t('chat_open_popup', { defaultValue: 'Ouvrir dans une fenêtre pop-up' })}
          >
            <PictureInPicture2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowInfo(v => !v)}
            className={`p-2 rounded-full hover:bg-gray-100 transition-colors ${showInfo ? 'text-blue-600 bg-blue-50' : 'text-gray-500 hover:text-gray-700'}`}
            title={t('chat_info')}
          >
            <Info className="w-4 h-4" />
          </button>
          {onExpand && (
            <button
              onClick={onExpand}
              className="p-2 rounded-full hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
              title={t('chat_expand', { defaultValue: 'Agrandir' })}
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          )}
          {onClosePanel && (
            <button
              onClick={onClosePanel}
              className="p-2 rounded-full hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
              title={t('chat_close_panel', { defaultValue: 'Fermer' })}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {headerMenu.pos && convSummary && (
        <MenuDropdown
          pos={headerMenu.pos}
          onClose={headerMenu.close}
          items={[
            { type: 'action', icon: <Search className="w-4 h-4" />, label: t('chat_search_in_conv_menu', { defaultValue: 'Rechercher dans la conversation' }), onClick: () => { setSearchOpen(true); setSearchQuery('') } },
            { type: 'action', icon: <Info className="w-4 h-4" />, label: t('chat_details', { defaultValue: 'Détails de la conversation' }), onClick: () => setShowInfo(true) },
            { type: 'separator' },
            ...buildItems(convSummary, { onManageMembers: () => setShowInfo(true) }),
          ]}
        />
      )}
      {convConfirmState && (
        <ConfirmDialog {...convConfirmState} onConfirm={handleConvConfirm} onCancel={handleConvCancel} />
      )}
      {showInfo && conv && (
        <InfoPanel
          conversation={conv}
          otherUser={convSummary?.other_user ?? null}
          onClose={() => setShowInfo(false)}
          onLeft={() => { setShowInfo(false); onBack?.() }}
        />
      )}

      {preCallType && (
        <PreCallModal
          state={{ convId, convName, type: preCallType, candidates: groupMembers }}
          onStart={handlePreCallStart}
          onCancel={() => setPreCallType(null)}
        />
      )}

      {/* Barre de recherche dans la conversation */}
      {searchOpen && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 bg-white flex-shrink-0">
          <Search className="w-4 h-4 text-gray-400" />
          <input
            autoFocus value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            placeholder={t('chat_search_in_conv', { defaultValue: 'Rechercher dans la conversation…' })}
            className="flex-1 text-sm focus:outline-none"
          />
          {searchQuery && <span className="text-xs text-gray-400">{visibleMessages.length}</span>}
          <button onClick={() => { setSearchOpen(false); setSearchQuery('') }} className="p-1 rounded hover:bg-gray-100"><X className="w-4 h-4 text-gray-400" /></button>
        </div>
      )}

      {/* Bandeau des messages épinglés */}
      {pinnedMessages.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-100 text-xs text-amber-800 flex-shrink-0">
          <Pin className="w-3.5 h-3.5 fill-amber-500 text-amber-500 flex-shrink-0" />
          <span className="font-medium">{t('chat_pinned', { defaultValue: 'Épinglé' })} ({pinnedMessages.length})</span>
          <span className="truncate flex-1 text-amber-700">
            {pinnedMessages[pinnedMessages.length - 1].plaintext ?? t('chat_message_encrypted')}
          </span>
        </div>
      )}

      {/* Zone de messages */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
        {/* Bouton charger plus */}
        {messages.length >= 50 && (
          <div className="flex justify-center mb-2">
            <button
              onClick={loadMore}
              disabled={isLoadingMore}
              className="text-xs text-blue-500 hover:underline disabled:opacity-50"
            >
              {isLoadingMore ? t('common_loading') : t('chat_load_previous')}
            </button>
          </div>
        )}

        {/* Profile intro at the very top of the history (start of the conversation). */}
        {conv && !compact && messages.length < 50 && (
          <div className="flex flex-col items-center text-center pt-8 pb-6 gap-1.5">
            <div className={`w-20 h-20 ${isGroupConv ? 'rounded-2xl' : 'rounded-full'} bg-blue-100 flex items-center justify-center text-blue-700 font-semibold text-3xl`}>
              {convName[0]?.toUpperCase()}
            </div>
            <p className="text-xl text-gray-900 mt-2">{convName}</p>
            {!isGroupConv && convSummary?.other_user && (
              <p className="text-sm text-gray-500">@{convSummary.other_user.username}</p>
            )}
            {isGroupConv && (
              <p className="text-sm text-gray-500">{t('chat_member_count', { count: convSummary?.member_count ?? 1 })}</p>
            )}
            <p className="text-xs text-gray-400">
              {t('chat_conv_created_on', {
                date: new Date(conv.created_at).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
                defaultValue: 'Conversation créée le {{date}}',
              })}
            </p>
            <p className="flex items-center gap-1 text-[11px] text-gray-400 mt-1">
              <Lock className="w-3 h-3" />
              {t('chat_e2e_note', { defaultValue: 'Les messages sont chiffrés de bout en bout.' })}
            </p>
          </div>
        )}

        {/* Onboarding card of a space — only while it is still (nearly) empty. */}
        {conv && isGroupConv && !compact && messages.length < 3 && (
          <div className="max-w-xl mx-auto my-4 flex flex-col items-center gap-3">
            <div className="w-full rounded-2xl bg-blue-50 px-5 py-4 text-center">
              <p className="text-sm text-gray-800 mb-3">
                {t('chat_space_welcome', {
                  name: currentUser?.display_name ?? currentUser?.username ?? '',
                  defaultValue: '{{name}}, bienvenue dans votre nouvel espace de collaboration. Pour commencer :',
                })}
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="sm" variant="secondary" icon={<UserPlus className="w-4 h-4" />} onClick={() => setShowInfo(true)}>
                  {t('chat_space_add_members', { defaultValue: 'Ajouter des membres' })}
                </Button>
                <Button
                  size="sm" variant="secondary" icon={<FileUp className="w-4 h-4" />}
                  onClick={() => window.dispatchEvent(new CustomEvent('chat:attach-file', { detail: { convId } }))}
                >
                  {t('chat_space_share_file', { defaultValue: 'Partager un fichier' })}
                </Button>
                {taskService && (
                  <Button size="sm" variant="secondary" icon={<ListTodo className="w-4 h-4" />} onClick={assignTask}>
                    {t('chat_space_assign_task', { defaultValue: 'Attribuer des tâches' })}
                  </Button>
                )}
              </div>
            </div>
            <p className="text-xs text-gray-400">
              {t('chat_space_created_by', {
                name: memberNames[conv.created_by ?? ''] ?? '',
                date: new Date(conv.created_at).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
                defaultValue: '{{name}} a créé cet espace le {{date}}',
              })}
            </p>
          </div>
        )}

        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 text-sm">
            <p>{t('chat_empty')}</p>
          </div>
        )}

        {threadedMessages.map(({ msg, replies }, i) => {
          const prevMsg = i > 0 ? threadedMessages[i - 1].msg : null
          const nextMsg = i < threadedMessages.length - 1 ? threadedMessages[i + 1].msg : null
          const replyParent = msg.reply_to_id ? messages.find(m => m.id === msg.reply_to_id) ?? null : null
          // "Seen by N": only on the last own message of a group conversation.
          const isLast = i === threadedMessages.length - 1 && replies.length === 0
          const seenByCount = (isGroupConv && isLast && msg.sender_id === myId)
            ? readState.filter(r => r.user_id !== myId && new Date(r.last_read_at).getTime() >= new Date(msg.created_at).getTime()).length
            : 0
          const isOwn = msg.sender_id === myId
          const showDate = !prevMsg ||
            new Date(msg.created_at).toDateString() !== new Date(prevMsg.created_at).toDateString()

          // Consecutive messages from the same author within 5 minutes form a group:
          // the author line is drawn once, the reply link once at the bottom.
          const GROUP_GAP_MS = 5 * 60 * 1000
          const sameGroup = (a: DecodedMessage | null, b: DecodedMessage) =>
            !!a && a.sender_id === b.sender_id &&
            Math.abs(new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) < GROUP_GAP_MS &&
            new Date(a.created_at).toDateString() === new Date(b.created_at).toDateString()
          const startsGroup = showDate || !sameGroup(prevMsg, msg)
          const endsGroup   = !nextMsg || !sameGroup(msg, nextMsg) ||
            new Date(nextMsg.created_at).toDateString() !== new Date(msg.created_at).toDateString()
          const authorName = isOwn
            ? (currentUser?.display_name ?? currentUser?.username ?? '')
            : (memberNames[msg.sender_id] ?? convSummary?.other_user?.display_name ?? convSummary?.other_user?.username ?? '…')

          return (
            <div key={msg.id}>
              {showDate && (
                <div className="flex justify-center my-4">
                  {/* WhatsApp-like chip: short numeric date on a floating white pill. */}
                  <span
                    className="text-xs font-medium text-gray-600 bg-white px-3 py-1.5"
                    style={{ borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.12)' }}
                  >
                    {new Date(msg.created_at).toLocaleDateString(locale)}
                  </span>
                </div>
              )}

              {/* Author line: avatar + name + time, drawn once per group. */}
              {startsGroup && (
                <div className={`flex items-center gap-2 mt-3 mb-1 ${isOwn ? 'justify-end pr-1' : 'pl-1'}`}>
                  {!isOwn && (
                    <span className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold flex items-center justify-center flex-shrink-0">
                      {authorName[0]?.toUpperCase()}
                    </span>
                  )}
                  {!isOwn && <span className="text-sm font-medium text-gray-900">{authorName}</span>}
                  <span className="text-xs text-gray-400">
                    {new Date(msg.created_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              )}

              <div className={isOwn ? '' : 'pl-10'}>
              <MessageBubble
                msg={msg}
                isOwn={isOwn}
                onReply={() => setReplyTo(msg)}
                onDelete={(id) => useChatStore.getState().removeMessage(convId, id)}
                onForward={(m) => setForwardMsg(m)}
                replyParent={threadMode ? null : replyParent}
                seenByCount={seenByCount}
                hideTime
                groupStart={startsGroup}
                groupEnd={endsGroup}
                showQuote={!threadMode}
                quoteAuthor={replyParent ? {
                  name: memberNames[replyParent.sender_id] ?? '…',
                  avatarUrl: memberAvatars[replyParent.sender_id] ?? null,
                } : undefined}
              />

              {/* Persistent reply affordance at the end of a group — starts a thread. */}
              {endsGroup && !isOwn && replies.length === 0 && (
                <button
                  onClick={() => setReplyTo(msg)}
                  className="flex items-center gap-1 mt-0.5 text-xs text-gray-400 hover:text-gray-700"
                >
                  <CornerDownRight className="w-3.5 h-3.5" />
                  {t('chat_reply')}
                </button>
              )}
              </div>

              {/* Thread mode: the replies hang under their root message. */}
              {replies.length > 0 && (
                <div className="ml-8 pl-3 py-1.5 pr-2 bg-gray-50 rounded-lg mt-1 space-y-1">
                  <p className="text-[11px] text-gray-400">
                    {t('chat_thread_replies', { count: replies.length, defaultValue: '{{count}} réponse(s)' })}
                  </p>
                  {replies.map(reply => (
                    <MessageBubble
                      key={reply.id}
                      msg={reply}
                      isOwn={reply.sender_id === myId}
                      onReply={() => setReplyTo(reply)}
                      onDelete={(id) => useChatStore.getState().removeMessage(convId, id)}
                      onForward={(m) => setForwardMsg(m)}
                      replyParent={null}
                      seenByCount={0}
                      showQuote={false}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {/* Indicateur "en train d'écrire" */}
        {typingUsers.length > 0 && (
          <div className="flex items-center gap-2 px-1">
            <div className="flex gap-1">
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Modal de transfert */}
      {forwardMsg && (
        <ForwardModal
          currentConvId={convId}
          onPick={(cid) => forwardTo(cid, forwardMsg)}
          onClose={() => setForwardMsg(null)}
        />
      )}

      {/* Composeur de sondage */}
      {pollOpen && <PollComposer onCreate={sendPoll} onClose={() => setPollOpen(false)} />}

      {/* Saisie */}
      <div className="no-print contents">
      <MessageInput
        onSend={sendMessage}
        onSendFiles={sendFiles}
        onSendVoice={sendVoice}
        onSendGif={sendGif}
        onSendSticker={sendSticker}
        onCreatePoll={() => setPollOpen(true)}
        ephemeralSecs={ephemeralSecs}
        onCycleEphemeral={() => setEphemeralSecs(s => (s === 0 ? 3600 : s === 3600 ? 86400 : 0))}
        members={members}
        onTyping={(typing) => sendTyping(convId, typing)}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        pendingCard={pendingCard}
        onPasteCard={setPendingCard}
        onCancelCard={() => setPendingCard(null)}
      />
      </div>
    </div>
  )
}

// Poll composer modal (question + 2..10 options).
function PollComposer({ onCreate, onClose }: { onCreate: (q: string, opts: string[]) => void; onClose: () => void }) {
  const { t } = useTranslation('chat')
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState<string[]>(['', ''])
  const valid = question.trim() && options.filter(o => o.trim()).length >= 2

  return (
    <div className="fixed inset-0 z-[2147483100] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-[360px] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
            <BarChart3 className="w-4 h-4" /> {t('chat_poll', { defaultValue: 'Sondage' })}
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <input
            autoFocus value={question} onChange={e => setQuestion(e.target.value)}
            placeholder={t('chat_poll_question', { defaultValue: 'Question…' })}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400"
          />
          <div className="space-y-2">
            {options.map((opt, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={opt}
                  onChange={e => setOptions(o => o.map((v, j) => (j === i ? e.target.value : v)))}
                  placeholder={t('chat_poll_option', { defaultValue: 'Option {{n}}', n: i + 1 })}
                  className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-400"
                />
                {options.length > 2 && (
                  <button onClick={() => setOptions(o => o.filter((_, j) => j !== i))} className="p-1 text-gray-400 hover:text-red-500"><X className="w-4 h-4" /></button>
                )}
              </div>
            ))}
          </div>
          {options.length < 10 && (
            <button onClick={() => setOptions(o => [...o, ''])} className="text-xs text-blue-600 hover:underline">
              + {t('chat_poll_add_option', { defaultValue: 'Ajouter une option' })}
            </button>
          )}
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-100">
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-lg hover:bg-gray-100">{t('common_cancel')}</button>
          <button
            onClick={() => onCreate(question.trim(), options.map(o => o.trim()).filter(Boolean))}
            disabled={!valid}
            className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
          >
            {t('chat_poll_create', { defaultValue: 'Créer' })}
          </button>
        </div>
      </div>
    </div>
  )
}

// Conversation picker for forwarding a message.
function ForwardModal({ currentConvId, onPick, onClose }: {
  currentConvId: string
  onPick: (convId: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation('chat')
  const currentUser  = useAuthStore(s => s.user)
  const conversations = useChatStore(s => s.conversations)
  const list = conversations.filter(c => c.conversation.id !== currentConvId)
  return (
    <div className="fixed inset-0 z-[2147483100] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-[340px] max-h-[70vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
            <Forward className="w-4 h-4" /> {t('chat_forward', { defaultValue: 'Transférer' })}
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {list.length === 0 && <div className="px-4 py-6 text-center text-sm text-gray-400">{t('chat_empty')}</div>}
          {list.map(c => {
            const name = getConvName(c.conversation, currentUser?.id ?? '', c.other_user)
            return (
              <button key={c.conversation.id} onClick={() => onPick(c.conversation.id)}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 text-left">
                <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-semibold text-sm flex-shrink-0">
                  {name[0]?.toUpperCase()}
                </div>
                <span className="text-sm text-gray-900 truncate">{name}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// Lit les dimensions naturelles d'une image (pour caler la bulle avant déchiffrement).
function imageDimensions(file: File): Promise<{ width?: number; height?: number }> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload  = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url) }
    img.onerror = () => { resolve({}); URL.revokeObjectURL(url) }
    img.src = url
  })
}
