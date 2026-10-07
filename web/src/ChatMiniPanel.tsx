import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Hash, Users } from 'lucide-react'
import { Spinner } from '@ui'
import { chatApi, type ConversationSummary } from './api'

/**
 * Chat side panel — see who is waiting, jump into the thread.
 *
 * Reading and answering stay in the module. Chat is end-to-end encrypted and its
 * session, key state and decryption live in the global chat service; opening a
 * second message surface here would mean a second consumer of that state, for a
 * column too narrow to hold a conversation anyway.
 */
export default function ChatMiniPanel() {
  const navigate = useNavigate()

  const { data: conversations = [], isLoading } = useQuery({
    queryKey: ['chat-mini-conversations'],
    queryFn:  () => chatApi.listConversations(),
    // Unread counts go stale fast; this panel is a glance, so keep it fresh.
    refetchInterval: 30_000,
  })

  const shown = conversations
    .filter(c => !c.is_archived)
    .sort((a, b) => Number(b.is_pinned) - Number(a.is_pinned) || Number(b.is_unread) - Number(a.is_unread))
    .slice(0, 12)

  const unreadTotal = conversations.reduce((n, c) => n + (c.unread_count || 0), 0)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1.5 px-4 pt-3 pb-1 uppercase tracking-wide text-text-tertiary"
           style={{ fontSize: 'var(--kb-text-meta)' }}>
        <span>Conversations</span>
        {unreadTotal > 0 && (
          <span className="rounded-full bg-primary px-1.5 py-px text-white" style={{ fontSize: 'var(--kb-text-micro)' }}>
            {unreadTotal}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {isLoading ? (
          <div className="flex justify-center py-6"><Spinner /></div>
        ) : shown.length === 0 ? (
          <p className="px-2 py-4 text-text-tertiary" style={{ fontSize: 'var(--kb-text-meta)' }}>
            Aucune conversation.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {shown.map(c => <Row key={c.conversation.id} summary={c} onClick={() => navigate('/chat')} />)}
          </ul>
        )}
      </div>
    </div>
  )
}

function Row({ summary, onClick }: { summary: ConversationSummary; onClick: () => void }) {
  const { conversation, other_user, unread_count, is_unread } = summary
  const isDirect = conversation.conv_type === 'direct'
  const title = isDirect
    ? (other_user?.display_name || other_user?.username || 'Conversation')
    : (conversation.name || 'Groupe')

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        title={title}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors
                   hover:bg-surface-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {isDirect
          ? <Users size={15} className="flex-shrink-0 text-text-tertiary" />
          : <Hash  size={15} className="flex-shrink-0 text-text-tertiary" />}
        <span className={`min-w-0 flex-1 truncate ${is_unread ? 'font-medium text-text-primary' : 'text-text-primary'}`}
              style={{ fontSize: 'var(--kb-text-body)' }}>
          {title}
        </span>
        {unread_count > 0 && (
          <span className="flex-shrink-0 rounded-full bg-primary px-1.5 py-px text-white"
                style={{ fontSize: 'var(--kb-text-micro)' }}>
            {unread_count}
          </span>
        )}
      </button>
    </li>
  )
}
