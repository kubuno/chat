import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Reply, Paperclip, Smile, Send } from 'lucide-react'
import { useAuthStore } from '@kubuno/sdk'
import { useChatStore, encodeTextMessage } from './chatStore'
import { chatApi, type DecodedMessage } from './api'
import MessageBubble from './MessageBubble'
import EmojiPicker from './EmojiPicker'
import { pushMediaToConversation } from './sendMedia'


// In-call chat side panel — posts to the underlying conversation.
/**
 * The meeting's messaging: the conversation itself, not a stripped-down copy.
 * It loads the history, says who wrote what and when, and renders messages with
 * the same component the rest of the app uses — so media, polls, replies,
 * reactions and link previews all work here too.
 */
export function CallChatPanel({ room, onClose }: { room: string; onClose: () => void }) {
  const { t, i18n } = useTranslation('chat')
  const messages = useChatStore(s => s.messages[room]) ?? []
  const fetchMessages = useChatStore(s => s.fetchMessages)
  const appendMessage = useChatStore(s => s.appendMessage)
  const myId = useAuthStore(s => s.user?.id) ?? ''
  const [text, setText] = useState('')
  const [emoji, setEmoji] = useState(false)
  const [replyTo, setReplyTo] = useState<DecodedMessage | null>(null)
  const [authors, setAuthors] = useState<Record<string, { name: string; avatarUrl: string | null }>>({})
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // The history, so someone joining midway sees what was already said.
  useEffect(() => { void fetchMessages(room) }, [room, fetchMessages])
  useEffect(() => {
    let cancelled = false
    chatApi.getConversation(room).then(res => {
      if (cancelled) return
      const map: Record<string, { name: string; avatarUrl: string | null }> = {}
      for (const m of res.members ?? []) map[m.user_id] = { name: m.display_name || m.username, avatarUrl: m.avatar_url }
      setAuthors(map)
    }).catch(() => { /* names fall back to the id */ })
    return () => { cancelled = true }
  }, [room])
  useEffect(() => { bottomRef.current?.scrollIntoView() }, [messages.length])

  async function send() {
    const trimmed = text.trim()
    if (!trimmed) return
    setText('')
    const parent = replyTo
    setReplyTo(null)
    const { encrypted_data, nonce } = encodeTextMessage(trimmed)
    try {
      const msg = await chatApi.sendMessage(room, { encrypted_data, nonce, ...(parent ? { reply_to_id: parent.id } : {}) })
      appendMessage(room, { ...msg, plaintext: trimmed })
    } catch (e) { console.error('send', e) }
  }

  async function attach(files: FileList | null) {
    for (const file of Array.from(files ?? [])) {
      const mime = file.type || 'application/octet-stream'
      const kind = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'file'
      try { await pushMediaToConversation(room, file, { mime, name: file.name, kind }) }
      catch (e) { console.error('attach', e) }
    }
  }

  const locale = i18n.language
  const shown = messages.slice(-100)

  return (
    <div className="relative z-10 flex-shrink-0 bg-[#2a2b2e] text-gray-100 flex flex-col rounded-2xl overflow-hidden mr-3 mb-1" style={{ width: 'min(22rem, 80vw)' }}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <span className="text-sm font-medium">{t('chat_call_chat')}</span>
        <button onClick={onClose} className="p-1 rounded hover:bg-white/10"><X className="w-4 h-4" /></button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2">
        {shown.length === 0 && (
          <p className="text-xs text-gray-400 text-center px-4 py-6">{t('chat_call_chat_empty')}</p>
        )}
        {shown.map((msg, i) => {
          const previous = shown[i - 1]
          const isOwn = msg.sender_id === myId
          const author = authors[msg.sender_id]
          const name = isOwn ? t('chat_call_chat_you') : author?.name ?? msg.sender_id.slice(0, 6)
          // A run of messages from the same person within five minutes is one
          // group: the name and the time are written once, above it.
          const startsGroup = !previous
            || previous.sender_id !== msg.sender_id
            || new Date(msg.created_at).getTime() - new Date(previous.created_at).getTime() > 5 * 60 * 1000
          const next = shown[i + 1]
          const endsGroup = !next || next.sender_id !== msg.sender_id
          const parent = msg.reply_to_id ? shown.find(m => m.id === msg.reply_to_id) ?? null : null
          return (
            <div key={msg.id}>
              {startsGroup && (
                <div className="flex items-center gap-2 mt-3 mb-1">
                  <span className="w-6 h-6 rounded-full overflow-hidden bg-primary/80 text-white text-[11px] font-semibold flex items-center justify-center flex-shrink-0">
                    {author?.avatarUrl
                      ? <img src={author.avatarUrl} alt="" className="w-full h-full object-cover" />
                      : name[0]?.toUpperCase()}
                  </span>
                  <span className="text-xs font-medium text-gray-100 truncate">{name}</span>
                  <span className="text-[11px] text-gray-400 flex-shrink-0">
                    {new Date(msg.created_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              )}
              <div className="pl-8">
                <MessageBubble
                  msg={msg}
                  isOwn={isOwn}
                  onReply={m => setReplyTo(m)}
                  onDelete={id => useChatStore.getState().removeMessage(room, id)}
                  replyParent={parent}
                  hideTime
                  groupStart={startsGroup}
                  groupEnd={endsGroup}
                  quoteAuthor={parent ? {
                    name: authors[parent.sender_id]?.name ?? '…',
                    avatarUrl: authors[parent.sender_id]?.avatarUrl ?? null,
                  } : undefined}
                />
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {replyTo && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-t border-white/10 text-xs text-gray-300">
          <Reply size={13} className="flex-shrink-0" />
          <span className="truncate flex-1">{replyTo.plaintext || t('chat_media_message')}</span>
          <button onClick={() => setReplyTo(null)} className="p-1 rounded hover:bg-white/10"><X className="w-3 h-3" /></button>
        </div>
      )}

      <div className="relative flex items-center gap-1 p-2 border-t border-white/10">
        {emoji && (
          <div className="absolute bottom-full left-2 mb-2 z-10">
            <EmojiPicker onPick={e => { setText(v => v + e); setEmoji(false) }} onClose={() => setEmoji(false)} />
          </div>
        )}
        <input ref={fileRef} type="file" multiple hidden onChange={e => { void attach(e.target.files); e.target.value = '' }} />
        <button onClick={() => fileRef.current?.click()} title={t('chat_attach_file')} className="p-2 rounded-full text-gray-300 hover:bg-white/10">
          <Paperclip className="w-4 h-4" />
        </button>
        <button onClick={() => setEmoji(v => !v)} title={t('chat_emojis')} className="p-2 rounded-full text-gray-300 hover:bg-white/10">
          <Smile className="w-4 h-4" />
        </button>
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
          placeholder={t('chat_message_placeholder')}
          className="flex-1 min-w-0 text-sm bg-white/10 text-gray-100 placeholder:text-gray-400 border border-white/10 rounded-full px-3 py-1.5 focus:outline-none focus:border-primary"
        />
        <button onClick={() => { void send() }} disabled={!text.trim()} className="p-2 bg-primary text-white rounded-full hover:opacity-90 disabled:opacity-40">
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
