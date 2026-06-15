import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Smile, Reply, Trash2, Lock } from 'lucide-react'
import { DecodedMessage } from './api'
import { chatApi } from './api'
import { useConfirm } from '@kubuno/sdk'
import { ConfirmDialog } from '@ui'

interface Props {
  msg:         DecodedMessage
  isOwn:       boolean
  onReply?:    (msg: DecodedMessage) => void
  onDelete?:   (msgId: string) => void
}

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏']

export default function MessageBubble({ msg, isOwn, onReply, onDelete }: Props) {
  const { t } = useTranslation('chat')
  const [showActions, setShowActions] = useState(false)
  const [showEmojis,  setShowEmojis]  = useState(false)
  const { confirm, confirmState, handleConfirm, handleCancel } = useConfirm()

  const isDeleted = msg.message_type === 'deleted'
  const time      = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  async function react(emoji: string) {
    setShowEmojis(false)
    await chatApi.addReaction(msg.id, emoji).catch(() => {})
  }

  async function del() {
    setShowActions(false)
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
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => { setShowActions(false); setShowEmojis(false) }}
    >
      {/* Actions flottantes */}
      {showActions && !isDeleted && (
        <div className={`absolute top-0 flex items-center gap-1 bg-white border border-gray-200 rounded-lg shadow-sm px-1.5 py-1 z-10 ${isOwn ? 'right-full mr-2' : 'left-full ml-2'}`}>
          <button onClick={() => setShowEmojis(!showEmojis)} className="p-1 hover:bg-gray-100 rounded" title={t('chat_react')}>
            <Smile className="w-4 h-4 text-gray-500" />
          </button>
          {onReply && (
            <button onClick={() => onReply(msg)} className="p-1 hover:bg-gray-100 rounded" title={t('chat_reply')}>
              <Reply className="w-4 h-4 text-gray-500" />
            </button>
          )}
          {isOwn && (
            <button onClick={del} className="p-1 hover:bg-gray-100 rounded" title={t('common_delete')}>
              <Trash2 className="w-4 h-4 text-red-500" />
            </button>
          )}

          {/* Emoji picker rapide */}
          {showEmojis && (
            <div className="absolute top-full mt-1 left-0 bg-white border border-gray-200 rounded-lg shadow-lg flex gap-1 p-2 z-20">
              {QUICK_EMOJIS.map(e => (
                <button key={e} onClick={() => react(e)} className="text-xl hover:scale-125 transition-transform">
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Bulle */}
      <div className={`max-w-[70%] ${isOwn ? 'items-end' : 'items-start'} flex flex-col`}>
        {/* Réponse parente */}
        {msg.reply_to_id && (
          <div className={`text-xs px-3 py-1 mb-1 rounded-lg border-l-2 border-blue-400 bg-blue-50 text-gray-500 truncate max-w-full ${isOwn ? 'self-end' : ''}`}>
            {t('chat_reply_to_message')}
          </div>
        )}

        <div className={`
          px-3 py-2 rounded-2xl text-sm leading-relaxed
          ${isOwn
            ? 'bg-blue-600 text-white rounded-br-sm'
            : 'bg-white text-gray-900 border border-gray-200 rounded-bl-sm'
          }
          ${isDeleted ? 'italic opacity-60' : ''}
        `}>
          {isDeleted ? (
            <span className="flex items-center gap-1">
              <Trash2 className="w-3 h-3" />
              {t('chat_message_deleted')}
            </span>
          ) : msg.plaintext ? (
            <span className="whitespace-pre-wrap break-words">{msg.plaintext}</span>
          ) : (
            <span className="flex items-center gap-1 opacity-70 text-xs">
              <Lock className="w-3 h-3" />
              {t('chat_message_encrypted')}
            </span>
          )}
        </div>

        {/* Horodatage + statut */}
        <div className={`flex items-center gap-1 mt-0.5 px-1 ${isOwn ? 'flex-row-reverse' : ''}`}>
          <span className="text-[10px] text-gray-400">{time}</span>
          {msg.edited_at && <span className="text-[10px] text-gray-400">· {t('chat_edited')}</span>}
          {isOwn && (
            <span className="text-[10px] text-gray-400">
              {msg.status === 'read' ? '✓✓' : msg.status === 'delivered' ? '✓✓' : '✓'}
            </span>
          )}
        </div>
      </div>
      {confirmState && (
        <ConfirmDialog {...confirmState} onConfirm={handleConfirm} onCancel={handleCancel} />
      )}
    </div>
  )
}
