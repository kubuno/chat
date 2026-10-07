import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Reply, Trash2, Lock, Pin, Forward, Copy } from 'lucide-react'
import { DecodedMessage } from './api'
import { chatApi } from './api'
import { useChatStore } from './chatStore'
import { useConfirm, useAuthStore } from '@kubuno/sdk'
import { ConfirmDialog, MenuDropdown, type MenuItem } from '@ui'
import MediaContent from './MediaContent'
import PollMessage from './PollMessage'
import LinkPreview from './LinkPreview'
import DataCardView from './DataCardView'
import { renderRich, firstUrl } from './richText'

interface Props {
  msg:          DecodedMessage
  isOwn:        boolean
  onReply?:     (msg: DecodedMessage) => void
  onDelete?:    (msgId: string) => void
  onForward?:   (msg: DecodedMessage) => void
  replyParent?: DecodedMessage | null   // resolved parent for quote preview
  seenByCount?: number                  // group "seen by N" on own messages
  /** The author line above the group already carries the time — don't repeat it. */
  hideTime?:    boolean
  /** Position within a same-author group — drives the corner continuity. */
  groupStart?:  boolean
  groupEnd?:    boolean
  /** Thread mode hangs replies under their root — the in-bubble quote is redundant there. */
  showQuote?:   boolean
  /** Author of the quoted message — avatar shown at the left of the quote. */
  quoteAuthor?: { name: string; avatarUrl: string | null }
}

export default function MessageBubble({ msg, isOwn, onReply, onDelete, onForward, replyParent, seenByCount, hideTime = false, groupStart = true, groupEnd = true, showQuote = true, quoteAuthor }: Props) {
  const { t, i18n } = useTranslation('chat')
  const myId = useAuthStore(s => s.user?.id) ?? ''
  const applyReaction = useChatStore(s => s.applyReaction)
  const [menuPos,     setMenuPos]     = useState<{ top: number; left: number } | null>(null)
  const { confirm, confirmState, handleConfirm, handleCancel } = useConfirm()

  const isDeleted = msg.message_type === 'deleted'
  const poll      = !isDeleted ? msg.poll ?? null : null
  const media     = !isDeleted ? msg.media ?? null : null
  const card      = !isDeleted ? msg.card ?? null : null
  const caption   = (media || card) && msg.plaintext && msg.plaintext.trim() ? msg.plaintext : null
  const tightMedia = media && (media.kind === 'image' || media.kind === 'video' || media.kind === 'gif')
  // A sticker is shown as-is, floating on the conversation background.
  const bare      = media?.kind === 'sticker' && !caption
  // Reply rendering: the quoted parent is glued INSIDE the bubble, above the
  // body — both spanning the full bubble width, each at least one line tall.
  const hasQuote  = showQuote && !!msg.reply_to_id && !isDeleted && !bare
  const ONE_LINE  = 37   // px — height of a single-line bubble (py-2 + line-height)
  const time      = new Date(msg.created_at).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })
  const linkUrl   = !isDeleted && msg.plaintext && !media && !poll && !card ? firstUrl(msg.plaintext) : null
  const quoteText = replyParent
    ? (replyParent.plaintext?.trim() ||
       (replyParent.media
         ? (replyParent.media.voice ? '🎤'
           : replyParent.media.kind === 'sticker' ? '🏷️'
           : replyParent.media.kind === 'gif' ? 'GIF'
           : replyParent.media.kind === 'image' ? '📷' : '📎')
         : '…'))
    : null

  // Aggregate reactions by emoji.
  const reactionGroups = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const r of msg.reactions ?? []) {
      const arr = m.get(r.emoji) ?? []
      arr.push(r.user_id)
      m.set(r.emoji, arr)
    }
    return Array.from(m.entries())
  }, [msg.reactions])

  async function toggleReaction(emoji: string) {
    const mine = (msg.reactions ?? []).some(r => r.emoji === emoji && r.user_id === myId)
    applyReaction(msg.conversation_id, msg.id, emoji, myId, !mine)   // optimistic
    if (mine) await chatApi.removeReaction(msg.id, emoji).catch(() => {})
    else      await chatApi.addReaction(msg.id, emoji).catch(() => {})
  }

  async function pin() {
    await chatApi.pinMessage(msg.id).catch(() => {})
  }

  function copy() {
    if (msg.plaintext) navigator.clipboard?.writeText(msg.plaintext).catch(() => {})
  }

  // Right-click context menu (MenuDropdown from @ui — never a hand-rolled div).
  const QUICK = ['👍', '❤️', '😂', '😮', '😢', '🙏']
  function menuItems(): MenuItem[] {
    const items: MenuItem[] = [
      { type: 'custom', render: (close) => (
        <div className="flex gap-1 px-2 py-1.5 border-b border-gray-100">
          {QUICK.map(e => (
            <button key={e} onClick={() => { toggleReaction(e); close() }} className="text-lg hover:scale-125 transition-transform">{e}</button>
          ))}
        </div>
      ) },
    ]
    if (onReply)   items.push({ type: 'action', label: t('chat_reply'), icon: <Reply size={15} />, onClick: () => onReply(msg) })
    if (onForward) items.push({ type: 'action', label: t('chat_forward', { defaultValue: 'Transférer' }), icon: <Forward size={15} />, onClick: () => onForward(msg) })
    items.push({ type: 'action', label: t(msg.is_pinned ? 'chat_unpin_msg' : 'chat_pin_msg', { defaultValue: msg.is_pinned ? 'Détacher' : 'Épingler' }), icon: <Pin size={15} />, onClick: pin })
    if (msg.plaintext) items.push({ type: 'action', label: t('chat_copy', { defaultValue: 'Copier' }), icon: <Copy size={15} />, onClick: copy })
    if (isOwn) {
      items.push({ type: 'separator' })
      items.push({ type: 'action', label: t('common_delete'), danger: true, icon: <Trash2 size={15} />, onClick: del })
    }
    return items
  }

  async function del() {
    const ok = await confirm({
      title:        t('chat_delete_message_title'),
      message:      t('chat_delete_message_body'),
      confirmLabel: t('common_delete'),
      variant:      'danger',
    })
    if (!ok) return
    await chatApi.deleteMessage(msg.id).catch(() => {})
    onDelete?.(msg.id)
  }

  return (
    <div
      className={`flex ${isOwn ? 'justify-end' : 'justify-start'} group relative mb-1`}
      onContextMenu={(e) => { if (isDeleted) return; e.preventDefault(); setMenuPos({ top: e.clientY, left: e.clientX }) }}
    >
      <div className={`max-w-[70%] ${isOwn ? 'items-end' : 'items-start'} flex flex-col`}>
        {msg.is_pinned && !isDeleted && (
          <div className={`flex items-center gap-1 text-[10px] text-blue-600 mb-0.5 px-1 ${isOwn ? 'self-end' : ''}`}>
            <Pin className="w-3 h-3 fill-blue-600" /> {t('chat_pinned', { defaultValue: 'Épinglé' })}
          </div>
        )}

        {/* A bare sticker has no bubble to glue the quote onto — floating chip. */}
        {showQuote && msg.reply_to_id && bare && (
          <div className={`text-xs px-2 py-1 mb-1 rounded-lg bg-blue-50 max-w-full ${isOwn ? 'self-end' : ''}`}>
            {quoteText ? <span className="text-gray-600 line-clamp-2 break-words">{quoteText}</span>
              : <span className="text-gray-400">{t('chat_reply_to_message')}</span>}
          </div>
        )}

        <div
          className={bare ? 'text-sm' : `
            rounded-2xl text-sm leading-relaxed shadow-sm overflow-hidden
            ${hasQuote ? '' : tightMedia ? 'p-1' : 'px-3 py-2'}
            ${isOwn ? 'bg-blue-600 text-white' : 'bg-white text-gray-900 border border-gray-100'}
            ${isDeleted ? 'italic opacity-60' : ''}
          `}
          // Inline: the host shell's own .rounded-2xl outranks the module's corner
          // utility (kubuno-module cascade layer), so a class can't square it off.
          style={bare ? undefined : (isOwn
            ? { borderBottomRightRadius: 0, ...(groupStart ? {} : { borderTopRightRadius: 6 }) }
            : { borderBottomLeftRadius: 0, ...(groupStart ? {} : { borderTopLeftRadius: 6 }) })}
        >
          {hasQuote && (
            <div
              className={`px-3 flex items-center text-xs ${isOwn ? 'text-blue-100' : 'text-gray-500'}`}
              style={{
                minHeight: ONE_LINE,
                background: isOwn ? 'rgba(255,255,255,0.16)' : 'rgba(15,23,42,0.05)',
              }}
            >
              {quoteAuthor && (
                quoteAuthor.avatarUrl ? (
                  <img
                    src={quoteAuthor.avatarUrl}
                    alt=""
                    className="w-5 h-5 rounded-full object-cover flex-shrink-0 mr-2"
                  />
                ) : (
                  <span className={`w-5 h-5 rounded-full flex-shrink-0 mr-2 flex items-center justify-center text-[10px] font-semibold
                    ${isOwn ? 'bg-white/25 text-white' : 'bg-blue-100 text-blue-700'}`}>
                    {quoteAuthor.name[0]?.toUpperCase()}
                  </span>
                )
              )}
              <span className="line-clamp-2 break-words py-1">
                {quoteText ?? t('chat_reply_to_message')}
              </span>
            </div>
          )}
          <div
            className={hasQuote ? (tightMedia ? 'p-1' : 'px-3 py-2') : 'contents'}
            style={hasQuote ? { minHeight: ONE_LINE, display: 'flex', alignItems: 'center' } : undefined}
          >
          {isDeleted ? (
            <span className="flex items-center gap-1 px-2 py-0.5">
              <Trash2 className="w-3 h-3" />
              {t('chat_message_deleted')}
            </span>
          ) : poll ? (
            <PollMessage msg={msg} isOwn={isOwn} />
          ) : card ? (
            <div className="flex flex-col gap-1">
              <DataCardView envelope={card} />
              {caption && <span className="whitespace-pre-wrap break-words">{caption}</span>}
            </div>
          ) : media ? (
            <div className="flex flex-col gap-1">
              <MediaContent media={media} isOwn={isOwn} />
              {caption && <span className={`whitespace-pre-wrap break-words ${tightMedia ? 'px-2 pb-0.5' : ''}`}>{caption}</span>}
            </div>
          ) : msg.plaintext ? (
            <div className="flex flex-col">
              <span className="whitespace-pre-wrap break-words">{renderRich(msg.plaintext, isOwn)}</span>
              {linkUrl && <LinkPreview url={linkUrl} isOwn={isOwn} />}
            </div>
          ) : (
            <span className="flex items-center gap-1 opacity-70 text-xs">
              <Lock className="w-3 h-3" />
              {t('chat_message_encrypted')}
            </span>
          )}
          </div>
        </div>

        {/* Reaction chips */}
        {reactionGroups.length > 0 && (
          <div className={`flex flex-wrap gap-1 mt-1 ${isOwn ? 'justify-end' : ''}`}>
            {reactionGroups.map(([emoji, users]) => {
              const mine = users.includes(myId)
              return (
                <button
                  key={emoji}
                  onClick={() => toggleReaction(emoji)}
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs border transition-colors ${
                    mine ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <span>{emoji}</span>
                  <span className="text-[10px] font-medium">{users.length}</span>
                </button>
              )
            })}
          </div>
        )}

        <div className={`flex items-center gap-1 mt-0.5 px-1 ${isOwn ? 'flex-row-reverse' : ''}`}>
          {!hideTime && <span className="text-[10px] text-gray-400">{time}</span>}
          {msg.edited_at && <span className="text-[10px] text-gray-400">· {t('chat_edited')}</span>}
          {isOwn && (
            <span className="text-[10px] text-gray-400">
              {msg.status === 'read' ? '✓✓' : msg.status === 'delivered' ? '✓✓' : '✓'}
            </span>
          )}
          {isOwn && seenByCount ? (
            <span className="text-[10px] text-blue-400">· {t('chat_seen_by', { count: seenByCount, defaultValue: 'Vu par {{count}}' })}</span>
          ) : null}
        </div>
      </div>
      {menuPos && (
        <MenuDropdown items={menuItems()} pos={menuPos} onClose={() => setMenuPos(null)} />
      )}
      {confirmState && (
        <ConfirmDialog {...confirmState} onConfirm={handleConfirm} onCancel={handleCancel} />
      )}
    </div>
  )
}
