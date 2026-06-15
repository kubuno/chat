import { useEffect, useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { BellOff, Archive, LogOut, UserPlus, UserMinus, Crown, X, Check, Search } from 'lucide-react'
import { chatApi, Conversation, OtherUser, ConvMember } from './api'
import { useChatStore } from './chatStore'
import { useAuthStore } from '@kubuno/sdk'
import { api } from '@kubuno/sdk'
import { FloatingWindow } from '@ui'
import { ConfirmDialog } from '@ui'
import { useConfirm } from '@kubuno/sdk'

interface UserSuggestion {
  id:           string
  username:     string
  display_name: string
  avatar_url:   string | null
}

interface Props {
  conversation: Conversation
  otherUser:    OtherUser | null
  onClose:      () => void
  onLeft?:      () => void
}

export default function InfoPanel({ conversation, otherUser, onClose, onLeft }: Props) {
  const { t }        = useTranslation('chat')
  const currentUser  = useAuthStore(s => s.user)
  const onlineUsers  = useChatStore(s => s.onlineUsers)
  const fetchConvs   = useChatStore(s => s.fetchConversations)

  const [members,     setMembers]     = useState<ConvMember[]>([])
  const [showAddForm, setShowAddForm] = useState(false)
  const [query,       setQuery]       = useState('')
  const [suggestions, setSuggestions] = useState<UserSuggestion[]>([])
  const [searching,   setSearching]   = useState(false)
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { confirm, confirmState, handleConfirm, handleCancel } = useConfirm()

  const isGroup  = conversation.conv_type !== 'direct'
  const convName = conversation.name ?? otherUser?.display_name ?? otherUser?.username ?? t('chat_conversation')
  const myId     = currentUser?.id ?? ''
  const myMember = members.find(m => m.user_id === myId)
  const isAdmin  = myMember?.role === 'admin' || myMember?.role === 'owner'

  function loadMembers() {
    chatApi.getConversation(conversation.id).then(res => {
      setMembers(res.members ?? [])
    }).catch(() => {})
  }

  useEffect(() => { loadMembers() }, [conversation.id]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleQuery(q: string) {
    setQuery(q)
    if (searchRef.current) clearTimeout(searchRef.current)
    if (!q.trim()) { setSuggestions([]); return }
    setSearching(true)
    searchRef.current = setTimeout(async () => {
      try {
        const existingIds = new Set(members.map(m => m.user_id))
        const res = await api.get<{ users: UserSuggestion[] }>('/users/search', { params: { q, limit: 8 } })
        setSuggestions(res.data.users.filter(u => !existingIds.has(u.id)))
      } catch { setSuggestions([]) }
      finally { setSearching(false) }
    }, 200)
  }

  async function addMember(userId: string) {
    try {
      await chatApi.addMembers(conversation.id, [userId])
      loadMembers()
      setQuery('')
      setSuggestions([])
      setShowAddForm(false)
      fetchConvs()
    } catch (e) { console.error(e) }
  }

  async function removeMember(userId: string, name: string) {
    const isSelf = userId === myId
    const ok = await confirm({
      title:        isSelf ? t('chat_leave_group_title') : t('chat_remove_member_title'),
      message:      isSelf
        ? t('chat_leave_group_message', { name: convName })
        : t('chat_remove_member_message', { name, group: convName }),
      confirmLabel: isSelf ? t('chat_leave') : t('chat_remove'),
      cancelLabel:  t('common_cancel'),
      variant:      'danger',
    })
    if (!ok) return
    try {
      if (isSelf) {
        await chatApi.leaveConversation(conversation.id)
        onClose()
        onLeft?.()
        fetchConvs()
      } else {
        await chatApi.removeMember(conversation.id, userId)
        loadMembers()
        fetchConvs()
      }
    } catch (e) { console.error(e) }
  }

  return (
    <FloatingWindow
      title={t('chat_info')}
      defaultWidth={340}
      defaultHeight={520}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4 p-4 text-sm h-full overflow-y-auto">
        {/* Avatar + name */}
        <div className="flex flex-col items-center gap-2 py-2">
          <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 text-2xl font-bold">
            {isGroup ? convName[0]?.toUpperCase() : convName[0]?.toUpperCase()}
          </div>
          <p className="font-semibold text-text-primary text-base">{convName}</p>
          {conversation.conv_type === 'direct' && otherUser && (
            <span className={`text-xs px-2 py-0.5 rounded-full ${
              onlineUsers.has(otherUser.id) ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
            }`}>
              {onlineUsers.has(otherUser.id) ? t('chat_online') : t('chat_offline')}
            </span>
          )}
          {isGroup && (
            <span className="text-xs text-text-tertiary">{t('chat_member_count', { count: members.length })}</span>
          )}
          {conversation.description && (
            <p className="text-xs text-text-tertiary text-center">{conversation.description}</p>
          )}
        </div>

        {/* Quick actions */}
        <div className="flex justify-center gap-3">
          <button className="flex flex-col items-center gap-1 p-2 rounded-lg hover:bg-surface-2 text-text-secondary">
            <BellOff size={18} />
            <span className="text-xs">{t('chat_mute_short')}</span>
          </button>
          <button className="flex flex-col items-center gap-1 p-2 rounded-lg hover:bg-surface-2 text-text-secondary">
            <Archive size={18} />
            <span className="text-xs">{t('chat_archive_short')}</span>
          </button>
          {isGroup && (
            <button
              onClick={() => removeMember(myId, '')}
              className="flex flex-col items-center gap-1 p-2 rounded-lg hover:bg-danger/10 text-danger"
            >
              <LogOut size={18} />
              <span className="text-xs">{t('chat_leave')}</span>
            </button>
          )}
        </div>

        {/* Members (group only) */}
        {isGroup && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wider">
                {t('chat_members', { count: members.length })}
              </p>
              {isAdmin && (
                <button
                  onClick={() => setShowAddForm(v => !v)}
                  className="flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <UserPlus size={12} />
                  {t('chat_add')}
                </button>
              )}
            </div>

            {/* Add member form */}
            {showAddForm && (
              <div className="mb-3 relative">
                <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden bg-white">
                  <Search size={14} className="ml-2.5 text-gray-400 flex-shrink-0" />
                  <input
                    type="text"
                    placeholder={t('chat_search_user')}
                    value={query}
                    onChange={e => handleQuery(e.target.value)}
                    autoFocus
                    className="flex-1 text-xs px-2 py-2 outline-none"
                  />
                  <button onClick={() => { setShowAddForm(false); setQuery(''); setSuggestions([]) }}
                    className="px-2 text-gray-400 hover:text-gray-600">
                    <X size={14} />
                  </button>
                </div>
                {(suggestions.length > 0 || searching) && (
                  <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 overflow-hidden">
                    {searching && <div className="px-3 py-2 text-xs text-gray-400">{t('chat_searching')}</div>}
                    {suggestions.map(u => (
                      <button key={u.id} type="button" onClick={() => addMember(u.id)}
                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-blue-50 text-left">
                        <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center flex-shrink-0">
                          {(u.display_name?.[0] ?? u.username[0]).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-gray-800 truncate">{u.display_name ?? u.username}</p>
                          <p className="text-[10px] text-gray-400">@{u.username}</p>
                        </div>
                        <Check size={12} className="text-blue-400" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-1">
              {members.map(m => {
                const name    = m.display_name ?? m.username
                const initial = name[0]?.toUpperCase() ?? '?'
                const isSelf  = m.user_id === myId
                const canRemove = (isAdmin && !isSelf) || isSelf

                return (
                  <div key={m.user_id} className="flex items-center gap-2.5 py-1.5 px-1 rounded-lg hover:bg-gray-50 group">
                    <div className="relative flex-shrink-0">
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 text-sm font-semibold">
                        {m.avatar_url
                          ? <img src={m.avatar_url} className="w-full h-full rounded-full object-cover" alt="" />
                          : initial}
                      </div>
                      <div className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-white ${
                        onlineUsers.has(m.user_id) ? 'bg-green-500' : 'bg-gray-300'
                      }`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-text-primary truncate">
                        {name}{isSelf ? ` ${t('chat_me_suffix')}` : ''}
                      </p>
                      <p className="text-[10px] text-text-tertiary">@{m.username}</p>
                    </div>
                    {(m.role === 'owner' || m.role === 'admin') && (
                      <Crown size={12} className={m.role === 'owner' ? 'text-yellow-500' : 'text-primary'} />
                    )}
                    {canRemove && (
                      <button
                        onClick={() => removeMember(m.user_id, name)}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-danger/10 text-danger transition-all"
                        title={isSelf ? t('chat_leave_group_title') : t('chat_remove')}
                      >
                        <UserMinus size={13} />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Direct conversation profile */}
        {!isGroup && otherUser && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wider">{t('chat_profile')}</p>
            <div className="space-y-1">
              {otherUser.display_name && (
                <div className="flex justify-between">
                  <span className="text-text-tertiary">{t('chat_name')}</span>
                  <span className="text-text-primary">{otherUser.display_name}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-text-tertiary">{t('chat_username')}</span>
                <span className="text-text-primary">@{otherUser.username}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {confirmState && (
        <ConfirmDialog {...confirmState} onConfirm={handleConfirm} onCancel={handleCancel} />
      )}
    </FloatingWindow>
  )
}
