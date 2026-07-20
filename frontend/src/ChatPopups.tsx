/**
 * Floating conversation windows, docked bottom-right and stacked side by side.
 *
 * Rendered from the global `app-dialogs` slot, so a pop-up keeps running (and
 * receiving messages) while the user browses another module. Not a
 * @ui/FloatingWindow: those are centered, backdropped modals — a chat dock needs
 * several small, non-modal, stackable windows anchored to a corner.
 */
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Minus, Maximize2, MessageSquare } from 'lucide-react'
import { useChatStore, getConvName } from './chatStore'
import { useAuthStore } from '@kubuno/sdk'
import { useNavigate } from 'react-router-dom'
import ConversationView from './ConversationView'

export default function ChatPopups() {
  const { t } = useTranslation('chat')
  const navigate = useNavigate()
  const popupConvIds = useChatStore(s => s.popupConvIds)
  const minimized = useChatStore(s => s.minimizedPopups)
  const conversations = useChatStore(s => s.conversations)
  const closePopup = useChatStore(s => s.closePopup)
  const toggleMinimized = useChatStore(s => s.togglePopupMinimized)
  const setActiveConv = useChatStore(s => s.setActiveConv)
  const sendTyping = useChatStore(s => s.sendTyping)
  const fetchConversations = useChatStore(s => s.fetchConversations)
  const user = useAuthStore(s => s.user)
  const myId = user?.id ?? ''

  // A pop-up restored on another module has no conversation list behind it
  // (only ChatPage fetches one) — without this its title would stay "…".
  useEffect(() => {
    if (popupConvIds.length > 0 && conversations.length === 0) fetchConversations()
  }, [popupConvIds.length, conversations.length, fetchConversations])

  if (popupConvIds.length === 0) return null

  function expand(convId: string) {
    closePopup(convId)
    setActiveConv(convId)
    navigate('/chat')
  }

  return (
    <div className="fixed bottom-0 right-4 z-[2147483000] flex items-end gap-3 pointer-events-none">
      {popupConvIds.map(convId => {
        const summary = conversations.find(c => c.conversation.id === convId)
        const name = summary ? getConvName(summary.conversation, myId, summary.other_user) : '…'
        const isMin = minimized.includes(convId)

        return (
          <div
            key={convId}
            data-chat-popup={convId}
            className={`pointer-events-auto w-[340px] bg-white rounded-t-xl shadow-2xl border border-gray-200 border-b-0 flex flex-col overflow-hidden
              ${isMin ? 'h-11' : 'h-[460px] max-h-[70vh]'}`}
          >
            <header className="flex items-center gap-2 px-3 h-11 flex-shrink-0 bg-white border-b border-gray-100">
              <button
                onClick={() => toggleMinimized(convId)}
                className="flex items-center gap-2 flex-1 min-w-0 text-left"
                title={isMin ? t('chat_popup_restore', { defaultValue: 'Restaurer' }) : t('chat_popup_minimize', { defaultValue: 'Réduire' })}
              >
                <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold flex items-center justify-center flex-shrink-0">
                  {name[0]?.toUpperCase() ?? <MessageSquare className="w-3 h-3" />}
                </span>
                <span className="text-sm font-medium text-gray-900 truncate">{name}</span>
                {summary && summary.unread_count > 0 && isMin && (
                  <span className="bg-primary text-white text-[10px] rounded-full px-1.5 py-0.5 font-medium flex-shrink-0">
                    {summary.unread_count > 99 ? '99+' : summary.unread_count}
                  </span>
                )}
              </button>

              <span className="flex items-center gap-0.5 flex-shrink-0">
                <button onClick={() => toggleMinimized(convId)} className="p-1 rounded hover:bg-gray-100 text-gray-500" title={t('chat_popup_minimize', { defaultValue: 'Réduire' })}>
                  <Minus className="w-4 h-4" />
                </button>
                <button onClick={() => expand(convId)} className="p-1 rounded hover:bg-gray-100 text-gray-500" title={t('chat_expand', { defaultValue: 'Agrandir' })}>
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => closePopup(convId)} className="p-1 rounded hover:bg-gray-100 text-gray-500" title={t('chat_close_panel', { defaultValue: 'Fermer' })}>
                  <X className="w-4 h-4" />
                </button>
              </span>
            </header>

            {!isMin && (
              <div className="flex-1 flex min-h-0">
                <ConversationView key={convId} convId={convId} sendTyping={sendTyping} compact />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
