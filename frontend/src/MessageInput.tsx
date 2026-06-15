import { useState, useRef, useCallback, KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Send, Paperclip, X } from 'lucide-react'
import { DecodedMessage } from './api'

interface Props {
  onSend:    (text: string) => Promise<void>
  onTyping?: (isTyping: boolean) => void
  replyTo?:  DecodedMessage | null
  onCancelReply?: () => void
  disabled?: boolean
}

export default function MessageInput({ onSend, onTyping, replyTo, onCancelReply, disabled }: Props) {
  const { t } = useTranslation('chat')
  const [text,      setText]      = useState('')
  const [sending,   setSending]   = useState(false)
  const typingTimer = useRef<number | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleChange = useCallback((val: string) => {
    setText(val)

    if (onTyping) {
      onTyping(true)
      if (typingTimer.current) clearTimeout(typingTimer.current)
      typingTimer.current = window.setTimeout(() => onTyping(false), 3000)
    }

    // Auto-resize textarea
    const ta = textareaRef.current
    if (ta) {
      ta.style.height = 'auto'
      ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'
    }
  }, [onTyping])

  const handleSend = useCallback(async () => {
    const trimmed = text.trim()
    if (!trimmed || sending || disabled) return

    setSending(true)
    try {
      await onSend(trimmed)
      setText('')
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
      onTyping?.(false)
    } finally {
      setSending(false)
    }
  }, [text, sending, disabled, onSend, onTyping])

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="border-t border-gray-200 bg-white">
      {/* Aperçu de la réponse */}
      {replyTo && (
        <div className="flex items-center justify-between px-4 py-2 bg-blue-50 border-b border-blue-100">
          <div className="text-xs text-blue-700 truncate">
            <span className="font-medium">{t('chat_reply_prefix')} </span>
            {replyTo.plaintext ?? t('chat_message_encrypted')}
          </div>
          <button onClick={onCancelReply} className="ml-2 text-blue-400 hover:text-blue-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="flex items-end gap-2 px-3 py-2">
        <button className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100" title={t('chat_attach_file')}>
          <Paperclip className="w-5 h-5" />
        </button>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={e => handleChange(e.target.value)}
          onKeyDown={handleKey}
          placeholder={t('chat_message_placeholder')}
          rows={1}
          disabled={disabled || sending}
          className="flex-1 resize-none rounded-2xl border border-gray-200 px-4 py-2 text-sm focus:outline-none focus:border-blue-400 placeholder-gray-400 max-h-[120px] overflow-y-auto"
        />

        <button
          onClick={handleSend}
          disabled={!text.trim() || sending || disabled}
          className="p-2 bg-blue-600 text-white rounded-full hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
          title={t('chat_send')}
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
