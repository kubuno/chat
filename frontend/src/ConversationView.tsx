import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Phone, Video, Info } from 'lucide-react'
import { useChatStore, getConvName, encodeTextMessage, CallParticipant } from './chatStore'
import { useAuthStore } from '@kubuno/sdk'
import { chatApi, DecodedMessage } from './api'
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
  }, [convId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    if (messages.length > 0) markConvRead(convId)
  }, [messages.length]) // eslint-disable-line react-hooks/exhaustive-deps

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
      })
      appendMessage(convId, { ...msg, plaintext: text })
      setReplyTo(null)
    } catch (e) {
      console.error('sendMessage', e)
    }
  }

  async function handleCallClick(type: 'audio' | 'video') {
    if (!conv) return
    if (!isGroupConv) {
      // Direct conversation: call immediately
      const peerId   = convSummary?.other_user?.id ?? ''
      const peerName = convSummary?.other_user?.display_name ?? convSummary?.other_user?.username ?? convName
      startCall(peerId, peerName, convId, type)
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
    // Start mesh calls to all selected participants
    participants.forEach((p, i) => {
      startCall(p.userId, p.name, convId, type, i === 0)
    })
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

        {messages.map((msg, i) => {
          const prevMsg = i > 0 ? messages[i - 1] : null
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

      {/* Saisie */}
      <MessageInput
        onSend={sendMessage}
        onTyping={(typing) => sendTyping(convId, typing)}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
      />
    </div>
  )
}
