import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarClock, Clock, Users, Link as LinkIcon, X, Video, MessageSquare, Trash2, Crown } from 'lucide-react'
import { useAuthStore } from '@kubuno/sdk'
import { chatApi, type ConvMember, type DecodedMessage } from './api'
import { useChatStore } from './chatStore'

/**
 * Read-only side panel opened when a meeting row is clicked (rather than
 * entering the call). It shows the meeting's details and a plain transcript of
 * its messages, so the meeting can be reviewed without joining it.
 */
interface Props {
  meetingId: string
  title:     string
  at:        Date
  lang:      string
  /** Distance (px) from the top of the meetings area to the first list row, so
   *  the card lines up with it. */
  topOffset: number
  onClose:   () => void
  onJoin:    (id: string) => void
  onDelete:  (id: string) => void
}

/** A short, human body for a message, mirroring the conversation-list snippet. */
function messageBody(m: DecodedMessage, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (m.message_type === 'deleted') return t('chat_message_deleted', { defaultValue: 'Message supprimé' })
  if (m.media) {
    if (m.media.voice) return `🎤 ${t('chat_media_voice', { defaultValue: 'Message vocal' })}`
    if (m.media.kind === 'sticker') return `🏷️ ${t('chat_media_sticker', { defaultValue: 'Sticker' })}`
    if (m.media.kind === 'gif') return 'GIF'
    return `📎 ${m.media.name || t('chat_media_file', { defaultValue: 'Fichier' })}`
  }
  if (m.poll) return `📊 ${m.poll.question || ''}`
  if (m.card) return m.card.title ?? m.card.type
  return m.plaintext ?? ''
}

export default function MeetingDetailPanel({ meetingId, title, at, lang, topOffset, onClose, onJoin, onDelete }: Props) {
  const { t } = useTranslation('chat')
  const myId = useAuthStore(s => s.user?.id ?? '')
  const messages = useChatStore(s => s.messages[meetingId])
  const fetchMessages = useChatStore(s => s.fetchMessages)

  const [members, setMembers] = useState<ConvMember[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.all([
      chatApi.getConversation(meetingId).then(r => { if (alive) setMembers(r.members ?? []) }).catch(() => {}),
      fetchMessages(meetingId),
    ]).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [meetingId, fetchMessages])

  // Resolve a sender id to a readable name using the meeting's member list.
  const nameOf = useMemo(() => {
    const map = new Map(members.map(m => [m.user_id, m.display_name ?? m.username]))
    return (id: string) => (id === myId ? t('chat_you', { defaultValue: 'Vous' }) : (map.get(id) ?? t('chat_unknown_user', { defaultValue: 'Utilisateur' })))
  }, [members, myId, t])

  const fmtTime = (d: Date) => new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' }).format(d)
  const fmtDate = (d: Date) => new Intl.DateTimeFormat(lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d)

  return (
    <aside
      className="self-start mr-4 mb-4 flex-1 min-w-0 rounded-xl border border-border bg-surface-0 shadow-sm overflow-hidden flex flex-col"
      style={{ marginTop: topOffset, maxHeight: `calc(100% - ${topOffset + 16}px)` }}
      data-module="chat"
    >
      {/* Header — title plus the meeting's actions (join / delete / close) */}
      <div className="flex items-center gap-2 px-4 h-14 border-b border-border flex-shrink-0">
        <CalendarClock className="w-5 h-5 text-primary flex-shrink-0" />
        <p className="flex-1 min-w-0 truncate text-[15px] font-medium text-gray-900">{title}</p>
        <button
          onClick={() => onJoin(meetingId)}
          className="flex items-center gap-1.5 bg-primary text-white text-sm px-3 py-1.5 rounded-full hover:opacity-90 flex-shrink-0"
        >
          <Video size={15} />
          {t('chat_meeting_join', { defaultValue: 'Rejoindre' })}
        </button>
        <button
          onClick={() => onDelete(meetingId)}
          className="p-1.5 rounded-full text-danger hover:bg-danger/10 flex-shrink-0"
          title={t('chat_meeting_delete_title', { defaultValue: 'Supprimer la réunion' })}
        >
          <Trash2 size={16} />
        </button>
        <button onClick={onClose} className="p-1.5 rounded-full text-text-secondary hover:bg-surface-1 flex-shrink-0" title={t('common_close', { defaultValue: 'Fermer' })}>
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Meeting info */}
        <div className="px-4 py-4 flex flex-col gap-2.5 border-b border-border">
          <div className="flex items-center gap-2.5 text-sm text-text-secondary">
            <CalendarClock size={16} className="text-text-tertiary flex-shrink-0" />
            <span className="capitalize">{fmtDate(at)}</span>
          </div>
          <div className="flex items-center gap-2.5 text-sm text-text-secondary">
            <Clock size={16} className="text-text-tertiary flex-shrink-0" />
            <span className="tabular-nums">{fmtTime(at)}</span>
          </div>
          <div className="flex items-center gap-2.5 text-sm text-text-secondary">
            <Users size={16} className="text-text-tertiary flex-shrink-0" />
            <span>{t('chat_member_count', { count: members.length, defaultValue: '{{count}} membre(s)' })}</span>
          </div>
        </div>

        {/* Members */}
        {members.length > 0 && (
          <div className="px-4 py-3 border-b border-border">
            <p className="text-xs font-medium uppercase tracking-wide text-text-tertiary mb-2">
              {t('chat_members', { count: members.length, defaultValue: 'Membres' })}
            </p>
            <div className="flex flex-col gap-1">
              {members.map(m => {
                const name = m.display_name ?? m.username
                return (
                  <div key={m.user_id} className="flex items-center gap-2.5 py-1">
                    <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 text-xs font-semibold flex-shrink-0">
                      {m.avatar_url ? <img src={m.avatar_url} className="w-full h-full rounded-full object-cover" alt="" /> : (name[0]?.toUpperCase() ?? '?')}
                    </div>
                    <span className="flex-1 min-w-0 truncate text-sm text-text-primary">
                      {name}{m.user_id === myId ? ` ${t('chat_me_suffix', { defaultValue: '(vous)' })}` : ''}
                    </span>
                    {(m.role === 'owner' || m.role === 'admin') && (
                      <Crown size={12} className={m.role === 'owner' ? 'text-yellow-500' : 'text-primary'} />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Transcript */}
        <div className="px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-text-tertiary mb-2 flex items-center gap-1.5">
            <MessageSquare size={13} />
            {t('chat_meeting_messages', { defaultValue: 'Messages' })}
          </p>
          {loading ? (
            <p className="text-sm text-text-tertiary py-4 text-center">{t('common_loading', { defaultValue: 'Chargement…' })}</p>
          ) : !messages || messages.length === 0 ? (
            <p className="text-sm text-text-tertiary py-4 text-center">{t('chat_meeting_no_messages', { defaultValue: 'Aucun message dans cette réunion.' })}</p>
          ) : (
            <div className="flex flex-col gap-3">
              {messages.map(m => (
                <div key={m.id} className="flex flex-col gap-0.5">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-medium text-text-primary truncate">{nameOf(m.sender_id)}</span>
                    <span className="text-[10px] text-text-tertiary tabular-nums flex-shrink-0">{fmtTime(new Date(m.created_at))}</span>
                  </div>
                  <p className={`text-sm break-words ${m.message_type === 'deleted' ? 'italic text-text-tertiary' : 'text-text-secondary'}`}>
                    {messageBody(m, t)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
