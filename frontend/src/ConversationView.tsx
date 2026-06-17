import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Phone, Video, Info, Pin, Forward, X, BarChart3, Search } from 'lucide-react'
import { useChatStore, getConvName, encodeTextMessage, encodeMediaMessage, encodePollMessage, CallParticipant } from './chatStore'
import { useAuthStore } from '@kubuno/sdk'
import { chatApi, DecodedMessage, MediaPayload } from './api'
import { encryptBlob } from './crypto/media'
import MessageBubble from './MessageBubble'
import MessageInput from './MessageInput'
import { useInitiateCall } from './CallWindow'
import InfoPanel from './InfoPanel'
import PreCallModal from './PreCallModal'

interface Props {
  convId:       string
  onBack?:      () => void  // mobile: retour vers la liste
  sendTyping:   (convId: string, isTyping: boolean) => void
}

export default function ConversationView({ convId, onBack, sendTyping }: Props) {
  const { t }          = useTranslation('chat')
  const currentUser    = useAuthStore(s => s.user)
  const conversations  = useChatStore(s => s.conversations)
  const messages       = useChatStore(s => s.messages[convId]) ?? []
  const typingUsers    = useChatStore(s => s.typingUsers[convId]) ?? []
  const { fetchMessages, appendMessage, markConvRead } = useChatStore()

  const [replyTo,       setReplyTo]      = useState<DecodedMessage | null>(null)
  const [forwardMsg,    setForwardMsg]   = useState<DecodedMessage | null>(null)
  const [pollOpen,      setPollOpen]     = useState(false)
  const [ephemeralSecs, setEphemeralSecs] = useState(0)   // 0 = off ; TTL en secondes
  const [members,       setMembers]      = useState<{ userId: string; name: string; username: string }[]>([])
  const [searchOpen,    setSearchOpen]   = useState(false)
  const [searchQuery,   setSearchQuery]  = useState('')
  const [readState,     setReadState]    = useState<{ user_id: string; last_read_at: string }[]>([])
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [showInfo,      setShowInfo]     = useState(false)
  const [preCallType,   setPreCallType]  = useState<'audio' | 'video' | null>(null)
  const [groupMembers,  setGroupMembers] = useState<CallParticipant[]>([])
  const bottomRef  = useRef<HTMLDivElement>(null)

  const convSummary  = conversations.find(c => c.conversation.id === convId)
  const conv         = convSummary?.conversation
  const convName     = conv ? getConvName(conv, currentUser?.id ?? '', convSummary?.other_user) : '…'
  const isGroupConv  = conv?.conv_type !== 'direct'

  const startCall    = useInitiateCall()
  const myId         = currentUser?.id ?? ''

  useEffect(() => {
    fetchMessages(convId)
    // Members power @mention autocomplete (groups mostly).
    chatApi.getConversation(convId).then(res => {
      setMembers((res.members ?? []).filter(m => m.user_id !== (currentUser?.id ?? ''))
        .map(m => ({ userId: m.user_id, name: m.display_name ?? m.username, username: m.username })))
    }).catch(() => setMembers([]))
  }, [convId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    if (messages.length > 0) markConvRead(convId)
  }, [messages.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Read receipts power the group "seen by N" indicator.
  useEffect(() => {
    if (!isGroupConv) { setReadState([]); return }
    chatApi.getReadState(convId).then(setReadState).catch(() => setReadState([]))
  }, [convId, messages.length, isGroupConv]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadMore() {
    const oldest = messages[0]
    if (!oldest || isLoadingMore) return
    setIsLoadingMore(true)
    await fetchMessages(convId, oldest.id)
    setIsLoadingMore(false)
  }

  async function sendMessage(text: string) {
    if (!currentUser) return
    const { encrypted_data, nonce } = encodeTextMessage(text)
    try {
      const msg = await chatApi.sendMessage(convId, {
        encrypted_data,
        nonce,
        ...(replyTo ? { reply_to_id: replyTo.id } : {}),
        ...(ephemeralSecs ? { expires_in_secs: ephemeralSecs } : {}),
      })
      appendMessage(convId, { ...msg, plaintext: text })
      setReplyTo(null)
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
    const msg = await chatApi.sendMessage(convId, {
      encrypted_data, nonce, message_type: info.kind, media_meta,
      ...(replyTo ? { reply_to_id: replyTo.id } : {}),
      ...(ephemeralSecs ? { expires_in_secs: ephemeralSecs } : {}),
    })
    appendMessage(convId, { ...msg, plaintext: caption ?? '', media })
    setReplyTo(null)
  }

  async function sendFiles(files: File[]) {
    for (const file of files) {
      const mime = file.type || 'application/octet-stream'
      const kind: MediaPayload['kind'] =
        mime.startsWith('image/') ? 'image' :
        mime.startsWith('video/') ? 'video' :
        mime.startsWith('audio/') ? 'audio' : 'file'
      let dims: { width?: number; height?: number } = {}
      if (kind === 'image') dims = await imageDimensions(file)
      try { await pushMedia(file, { mime, name: file.name, kind, ...dims }) }
      catch (e) { console.error('sendFile', e) }
    }
  }

  async function sendVoice(blob: Blob, durationSec: number, waveform: number[]) {
    try {
      await pushMedia(blob, { mime: blob.type || 'audio/webm', name: 'message-vocal.webm', kind: 'audio', duration: durationSec, voice: true, waveform })
    } catch (e) { console.error('sendVoice', e) }
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
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Header conversation */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-white flex-shrink-0">
        {onBack && (
          <button onClick={onBack} className="p-1 rounded-full hover:bg-gray-100 mr-1">
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
        )}
        <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-semibold text-sm flex-shrink-0">
          {convName[0]?.toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-gray-900 truncate text-sm">{convName}</p>
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
            onClick={() => setShowInfo(v => !v)}
            className={`p-2 rounded-full hover:bg-gray-100 transition-colors ${showInfo ? 'text-blue-600 bg-blue-50' : 'text-gray-500 hover:text-gray-700'}`}
            title={t('chat_info')}
          >
            <Info className="w-4 h-4" />
          </button>
        </div>
      </div>
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
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
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

        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 text-sm">
            <p>{t('chat_empty')}</p>
          </div>
        )}

        {visibleMessages.map((msg, i) => {
          const prevMsg = i > 0 ? visibleMessages[i - 1] : null
          const replyParent = msg.reply_to_id ? messages.find(m => m.id === msg.reply_to_id) ?? null : null
          // "Seen by N": only on the last own message of a group conversation.
          const isLast = i === visibleMessages.length - 1
          const seenByCount = (isGroupConv && isLast && msg.sender_id === myId)
            ? readState.filter(r => r.user_id !== myId && new Date(r.last_read_at).getTime() >= new Date(msg.created_at).getTime()).length
            : 0
          const showDate = !prevMsg ||
            new Date(msg.created_at).toDateString() !== new Date(prevMsg.created_at).toDateString()

          return (
            <div key={msg.id}>
              {showDate && (
                <div className="flex justify-center my-3">
                  <span className="text-xs text-gray-400 bg-gray-100 px-3 py-1 rounded-full">
                    {new Date(msg.created_at).toLocaleDateString()}
                  </span>
                </div>
              )}
              <MessageBubble
                msg={msg}
                isOwn={msg.sender_id === myId}
                onReply={() => setReplyTo(msg)}
                onDelete={(id) => useChatStore.getState().removeMessage(convId, id)}
                onForward={(m) => setForwardMsg(m)}
                replyParent={replyParent}
                seenByCount={seenByCount}
              />
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
      <MessageInput
        onSend={sendMessage}
        onSendFiles={sendFiles}
        onSendVoice={sendVoice}
        onCreatePoll={() => setPollOpen(true)}
        ephemeralSecs={ephemeralSecs}
        onCycleEphemeral={() => setEphemeralSecs(s => (s === 0 ? 3600 : s === 3600 ? 86400 : 0))}
        members={members}
        onTyping={(typing) => sendTyping(convId, typing)}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
      />
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
