import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Search, MessageSquarePlus, Trash2, Archive, BellOff, Pin,
  X, List, Ban, Eraser, Bell, Star, MailOpen,
  Users, Plus,
} from 'lucide-react'
import { useChatStore, getConvName } from './chatStore'
import { useAuthStore } from '@kubuno/sdk'
import { api } from '@kubuno/sdk'
import { chatApi } from './api'
import { ConfirmDialog, MenuDropdown, type MenuItem } from '@ui'
import { Button, Input } from '@ui'
import { useConfirm } from '@kubuno/sdk'

interface UserSuggestion {
  id: string
  username: string
  display_name: string
  avatar_url: string | null
}

interface Props {
  onSelect: (convId: string) => void
  activeId: string | null
}

interface CtxMenu {
  convId: string
  x: number
  y: number
}

export default function ConversationList({ onSelect, activeId }: Props) {
  const { t }         = useTranslation('chat')
  const user          = useAuthStore(s => s.user)
  const conversations = useChatStore(s => s.conversations)
  const isLoading     = useChatStore(s => s.isLoadingConvs)
  const onlineUsers   = useChatStore(s => s.onlineUsers)
  const fetchConvs    = useChatStore(s => s.fetchConversations)

  const [search,        setSearch]        = useState('')
  const [showNewDm,     setShowNewDm]     = useState(false)
  const [showNewGroup,  setShowNewGroup]  = useState(false)
  const [dmQuery,       setDmQuery]       = useState('')
  const [suggestions,   setSuggestions]   = useState<UserSuggestion[]>([])
  const [searching,     setSearching]     = useState(false)
  const [creatingDm,    setCreatingDm]    = useState(false)
  const [ctxMenu,       setCtxMenu]       = useState<CtxMenu | null>(null)
  const { confirm, confirmState, handleConfirm, handleCancel } = useConfirm()

  const dmInputRef    = useRef<HTMLInputElement>(null)
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const setActiveConv = useChatStore(s => s.setActiveConv)

  const handleContextMenu = useCallback((e: React.MouseEvent, convId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({ convId, x: e.clientX, y: e.clientY })
  }, [])

  // ── Actions ──────────────────────────────────────────────────────────────────

  const closeMenu = () => setCtxMenu(null)

  const action = useCallback(async (
    fn: () => Promise<unknown>,
    refresh = true,
  ) => {
    closeMenu()
    try {
      await fn()
      if (refresh) await fetchConvs()
    } catch (e) {
      console.error(e)
    }
  }, [fetchConvs]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleArchive = (convId: string) => {
    const s = conversations.find(c => c.conversation.id === convId)
    action(() => chatApi.updateMemberSettings(convId, { archive: !s?.is_archived }))
  }

  const handleMute = (convId: string, hours: number | 'always') => {
    const until = hours === 'always'
      ? '2099-01-01T00:00:00Z'
      : new Date(Date.now() + hours * 3_600_000).toISOString()
    action(() => chatApi.updateMemberSettings(convId, { mute_until: until }))
  }

  const handleUnmute = (convId: string) =>
    action(() => chatApi.updateMemberSettings(convId, { unmute: true }))

  const handlePin = (convId: string) => {
    const s = conversations.find(c => c.conversation.id === convId)
    action(() => chatApi.updateMemberSettings(convId, { pin: !s?.is_pinned }))
  }

  const handleMarkUnread = (convId: string) =>
    action(() => chatApi.updateMemberSettings(convId, { mark_unread: true }))

  const handleFavorite = (convId: string) => {
    const s = conversations.find(c => c.conversation.id === convId)
    action(() => chatApi.updateMemberSettings(convId, { favorite: !s?.is_favorite }))
  }

  const handleClose = (convId: string) => {
    closeMenu()
    if (useChatStore.getState().activeConvId === convId) setActiveConv(null)
  }

  const handleClear = async (convId: string) => {
    closeMenu()
    const ok = await confirm({
      title:        t('chat_clear_title'),
      message:      t('chat_clear_message'),
      confirmLabel: t('chat_clear_confirm'),
      cancelLabel:  t('common_cancel'),
      variant:      'warning',
    })
    if (!ok) return
    try {
      await chatApi.clearMessages(convId)
      useChatStore.setState(s => ({ messages: { ...s.messages, [convId]: [] } }))
    } catch (e) { console.error(e) }
  }

  const handleDelete = async (convId: string) => {
    closeMenu()
    const name = conversations.find(c => c.conversation.id === convId)
    const label = name ? `"${getConvName(name.conversation, myId, name.other_user)}"` : t('chat_delete_fallback_label')
    const ok = await confirm({
      title:        t('chat_delete_title'),
      message:      t('chat_delete_message', { label }),
      confirmLabel: t('common_delete'),
      cancelLabel:  t('common_cancel'),
      variant:      'danger',
    })
    if (!ok) return
    try {
      await chatApi.leaveConversation(convId)
      if (useChatStore.getState().activeConvId === convId) setActiveConv(null)
      await fetchConvs()
    } catch (e) { console.error(e) }
  }

  // ── Données ──────────────────────────────────────────────────────────────────

  const myId = user?.id ?? ''

  const filtered = conversations.filter(c => {
    if (c.is_archived) return false
    const name = getConvName(c.conversation, myId, c.other_user).toLowerCase()
    return name.includes(search.toLowerCase())
  })

  const sorted = [...filtered].sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1
    if (a.is_favorite !== b.is_favorite) return a.is_favorite ? -1 : 1
    return new Date(b.conversation.updated_at).getTime() - new Date(a.conversation.updated_at).getTime()
  })

  // ── Nouveau DM ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (showNewDm) {
      setTimeout(() => dmInputRef.current?.focus(), 50)
    } else {
      setDmQuery('')
      setSuggestions([])
    }
  }, [showNewDm])

  function handleDmQueryChange(q: string) {
    setDmQuery(q)
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    if (q.trim().length < 1) { setSuggestions([]); return }
    setSearching(true)
    searchTimeout.current = setTimeout(async () => {
      try {
        const res = await api.get<{ users: UserSuggestion[] }>('/users/search', { params: { q, limit: 8 } })
        setSuggestions(res.data.users.filter(u => u.id !== myId))
      } catch {
        setSuggestions([])
      } finally {
        setSearching(false)
      }
    }, 200)
  }

  async function startDm(targetUserId: string) {
    setCreatingDm(true)
    try {
      const conv = await chatApi.createDirect(targetUserId)
      await fetchConvs()
      onSelect(conv.id)
      setShowNewDm(false)
    } catch (e) {
      console.error('startDm', e)
    } finally {
      setCreatingDm(false)
    }
  }

  // ── Contexte du menu ─────────────────────────────────────────────────────────
  const ctxSummary = ctxMenu ? conversations.find(c => c.conversation.id === ctxMenu.convId) : null
  const isMuted    = ctxSummary?.muted_until ? new Date(ctxSummary.muted_until) > new Date() : false

  const buildItems = (convId: string, summary: NonNullable<typeof ctxSummary>): MenuItem[] => [
    {
      type: 'action',
      icon: <Archive className="w-4 h-4" />,
      label: summary.is_archived ? t('chat_unarchive') : t('chat_archive'),
      onClick: () => handleArchive(convId),
    },
    isMuted
      ? {
          type: 'action',
          icon: <Bell className="w-4 h-4" />,
          label: t('chat_unmute'),
          onClick: () => handleUnmute(convId),
        }
      : {
          type: 'submenu',
          icon: <BellOff className="w-4 h-4" />,
          label: t('chat_mute'),
          items: [
            { type: 'action', label: t('chat_mute_8h'),     onClick: () => handleMute(convId, 8) },
            { type: 'action', label: t('chat_mute_1week'),  onClick: () => handleMute(convId, 168) },
            { type: 'action', label: t('chat_mute_always'), onClick: () => handleMute(convId, 'always') },
          ],
        },
    {
      type: 'action',
      icon: <Pin className="w-4 h-4" />,
      label: summary.is_pinned ? t('chat_unpin') : t('chat_pin'),
      onClick: () => handlePin(convId),
      checked: summary.is_pinned,
    },
    {
      type: 'action',
      icon: <MailOpen className="w-4 h-4" />,
      label: t('chat_mark_unread'),
      onClick: () => handleMarkUnread(convId),
    },
    {
      type: 'action',
      icon: <Star className="w-4 h-4" />,
      label: summary.is_favorite ? t('chat_unfavorite') : t('chat_favorite'),
      onClick: () => handleFavorite(convId),
      checked: summary.is_favorite,
    },
    { type: 'separator' },
    {
      type: 'action',
      icon: <X className="w-4 h-4" />,
      label: t('chat_close_conversation'),
      onClick: () => handleClose(convId),
    },
    {
      type: 'action',
      icon: <List className="w-4 h-4" />,
      label: t('chat_add_to_list'),
      onClick: () => {},
      disabled: true,
    },
    {
      type: 'action',
      icon: <Ban className="w-4 h-4" />,
      label: t('chat_block'),
      onClick: () => {},
      disabled: true,
    },
    { type: 'separator' },
    {
      type: 'action',
      icon: <Eraser className="w-4 h-4" />,
      label: t('chat_clear_conversation'),
      onClick: () => handleClear(convId),
      danger: true,
    },
    {
      type: 'action',
      icon: <Trash2 className="w-4 h-4" />,
      label: t('chat_delete_conversation'),
      onClick: () => handleDelete(convId),
      danger: true,
    },
  ]

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-white border-r border-gray-200">
      {/* Header */}
      <div className="px-4 pt-4 pb-2 border-b border-gray-100">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-900">{t('chat_messages')}</h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => { setShowNewGroup(v => !v); setShowNewDm(false) }}
              className={`p-1.5 rounded-full hover:bg-gray-100 ${showNewGroup ? 'text-blue-600' : 'text-gray-500'}`}
              title={t('chat_new_group')}
            >
              <Users className="w-4.5 h-4.5" />
            </button>
            <button
              type="button"
              onClick={() => { setShowNewDm(v => !v); setShowNewGroup(false) }}
              className={`p-1.5 rounded-full hover:bg-gray-100 ${showNewDm ? 'text-blue-600' : 'text-gray-500'}`}
              title={t('chat_new_dm')}
            >
              <MessageSquarePlus className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder={t('chat_search_placeholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm bg-gray-100 rounded-full border-0 focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>

        {showNewDm && (
          <div className="mt-2 relative">
            <Input
              ref={dmInputRef}
              type="text"
              placeholder={t('chat_search_user_placeholder')}
              value={dmQuery}
              onChange={e => handleDmQueryChange(e.target.value)}
              disabled={creatingDm}
            />
            {(suggestions.length > 0 || searching) && (
              <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 overflow-hidden">
                {searching && <div className="px-3 py-2 text-xs text-gray-400">{t('chat_searching')}</div>}
                {suggestions.map(u => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => startDm(u.id)}
                    disabled={creatingDm}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-blue-50 text-left transition-colors"
                  >
                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-semibold text-sm flex-shrink-0">
                      {u.avatar_url
                        ? <img src={u.avatar_url} className="w-full h-full rounded-full object-cover" />
                        : (u.display_name?.[0] ?? u.username[0]).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{u.display_name}</p>
                      <p className="text-xs text-gray-400 truncate">@{u.username}</p>
                    </div>
                  </button>
                ))}
                {!searching && suggestions.length === 0 && dmQuery.trim().length > 0 && (
                  <div className="px-3 py-2 text-xs text-gray-400">{t('chat_no_user_found')}</div>
                )}
              </div>
            )}
          </div>
        )}
        {showNewGroup && (
          <GroupCreateForm
            myId={myId}
            onCreated={(convId) => {
              setShowNewGroup(false)
              onSelect(convId)
              fetchConvs()
            }}
            onCancel={() => setShowNewGroup(false)}
          />
        )}
      </div>

      {/* Liste */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && conversations.length === 0 ? (
          <div className="p-4 text-center text-sm text-gray-400">{t('common_loading')}</div>
        ) : sorted.length === 0 ? (
          <div className="p-4 text-center text-sm text-gray-400">
            {search ? t('chat_no_results') : t('chat_no_conversation')}
          </div>
        ) : (
          sorted.map(({ conversation: conv, unread_count, other_user, is_pinned, is_favorite, muted_until }) => {
            const name     = getConvName(conv, myId, other_user)
            const isActive = conv.id === activeId
            const otherId  = conv.conv_type === 'direct'
              ? (conv.user_a_id === myId ? conv.user_b_id : conv.user_a_id)
              : null
            const isOnline = otherId ? onlineUsers.has(otherId) : false
            const isMutedConv = muted_until ? new Date(muted_until) > new Date() : false
            const initial  = name[0]?.toUpperCase() ?? '?'

            return (
              <button
                key={conv.id}
                type="button"
                onClick={() => onSelect(conv.id)}
                onContextMenu={e => handleContextMenu(e, conv.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left ${
                  isActive ? 'bg-blue-50 hover:bg-blue-50' : ''
                }`}
              >
                {/* Avatar */}
                <div className="relative flex-shrink-0">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold ${
                    isActive ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'
                  }`}>
                    {initial}
                  </div>
                  {isOnline && (
                    <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-white" />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className={`text-sm font-medium truncate ${isActive ? 'text-blue-700' : 'text-gray-900'}`}>
                      {name}
                    </p>
                    <div className="flex items-center gap-1 flex-shrink-0 ml-1">
                      {is_pinned    && <Pin    className="w-3 h-3 text-gray-400" />}
                      {is_favorite  && <Star   className="w-3 h-3 text-yellow-400 fill-yellow-400" />}
                      {isMutedConv  && <BellOff className="w-3 h-3 text-gray-400" />}
                      <span className="text-[10px] text-gray-400">
                        {new Date(conv.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-0.5">
                    <p className="text-xs text-gray-500 truncate">
                      {conv.conv_type === 'group' ? t('chat_type_group') : conv.conv_type === 'channel' ? t('chat_type_channel') : ''}
                    </p>
                    {unread_count > 0 && (
                      <span className="ml-1 bg-blue-600 text-white text-[10px] rounded-full px-1.5 py-0.5 flex-shrink-0 font-medium">
                        {unread_count > 99 ? '99+' : unread_count}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            )
          })
        )}
      </div>

      {/* ── Modale de confirmation ──────────────────────────────────────────── */}
      {confirmState && (
        <ConfirmDialog
          {...confirmState}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}

      {/* ── Menu contextuel ─────────────────────────────────────────────────── */}
      {ctxMenu && ctxSummary && (
        <MenuDropdown
          pos={{ top: ctxMenu.y, left: ctxMenu.x }}
          onClose={closeMenu}
          items={buildItems(ctxMenu.convId, ctxSummary)}
        />
      )}
    </div>
  )
}

// ── Group creation form ────────────────────────────────────────────────────────

function GroupCreateForm({
  myId,
  onCreated,
  onCancel,
}: {
  myId:      string
  onCreated: (convId: string) => void
  onCancel:  () => void
}) {
  const { t } = useTranslation('chat')
  const [groupName,   setGroupName]   = useState('')
  const [query,       setQuery]       = useState('')
  const [suggestions, setSuggestions] = useState<UserSuggestion[]>([])
  const [selected,    setSelected]    = useState<UserSuggestion[]>([])
  const [searching,   setSearching]   = useState(false)
  const [creating,    setCreating]    = useState(false)
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef  = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  function handleQuery(q: string) {
    setQuery(q)
    if (searchRef.current) clearTimeout(searchRef.current)
    if (!q.trim()) { setSuggestions([]); return }
    setSearching(true)
    searchRef.current = setTimeout(async () => {
      try {
        const res = await api.get<{ users: UserSuggestion[] }>('/users/search', { params: { q, limit: 8 } })
        const filtered = res.data.users.filter(u => u.id !== myId && !selected.find(s => s.id === u.id))
        setSuggestions(filtered)
      } catch { setSuggestions([]) }
      finally { setSearching(false) }
    }, 200)
  }

  function addMember(u: UserSuggestion) {
    setSelected(p => [...p, u])
    setSuggestions([])
    setQuery('')
  }

  function removeMember(id: string) {
    setSelected(p => p.filter(u => u.id !== id))
  }

  async function handleCreate() {
    const name = groupName.trim()
    if (!name || selected.length === 0) return
    setCreating(true)
    try {
      const conv = await chatApi.createGroup(name, selected.map(u => u.id))
      onCreated(conv.id)
    } catch (e) { console.error(e) }
    finally { setCreating(false) }
  }

  return (
    <div className="mt-2 border border-gray-200 rounded-xl p-3 bg-gray-50 space-y-2.5">
      <Input
        ref={inputRef}
        type="text"
        placeholder={t('chat_group_name_placeholder')}
        value={groupName}
        onChange={e => setGroupName(e.target.value)}
      />

      {/* Selected members chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map(u => (
            <span key={u.id} className="flex items-center gap-1 bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full">
              {u.display_name || u.username}
              <button type="button" onClick={() => removeMember(u.id)} className="hover:text-blue-900">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Member search */}
      <div className="relative">
        <Input
          type="text"
          placeholder={t('chat_add_members_placeholder')}
          value={query}
          onChange={e => handleQuery(e.target.value)}
        />
        {(suggestions.length > 0 || searching) && (
          <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 overflow-hidden">
            {searching && <div className="px-3 py-2 text-xs text-gray-400">{t('chat_searching')}</div>}
            {suggestions.map(u => (
              <button key={u.id} type="button" onClick={() => addMember(u)}
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-blue-50 text-left">
                <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center flex-shrink-0">
                  {(u.display_name?.[0] ?? u.username[0]).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{u.display_name ?? u.username}</p>
                  <p className="text-xs text-gray-400">@{u.username}</p>
                </div>
                <Plus className="w-3.5 h-3.5 text-blue-400" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <Button type="button" onClick={onCancel} variant="secondary" size="sm" className="flex-1">
          {t('common_cancel')}
        </Button>
        <Button type="button" onClick={handleCreate}
          disabled={!groupName.trim() || selected.length === 0 || creating}
          loading={creating}
          size="sm" className="flex-1">
          {creating ? t('chat_creating') : t('chat_create_group')}
        </Button>
      </div>
    </div>
  )
}
