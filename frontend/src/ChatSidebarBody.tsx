import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  MessageSquarePlus, Search, Trash2, Archive, BellOff, Pin,
  X, List, Ban, Eraser, Bell, Star, MailOpen,
} from 'lucide-react'
import { useChatStore, getConvName } from './chatStore'
import { useAuthStore } from '@kubuno/sdk'
import { useUiStore } from '@kubuno/sdk'
import { api } from '@kubuno/sdk'
import { chatApi } from './api'
import { ConfirmDialog, MenuDropdown, type MenuItem, Input } from '@ui'
import { useConfirm } from '@kubuno/sdk'

interface UserSuggestion {
  id: string
  username: string
  display_name: string
  avatar_url: string | null
}

interface CtxMenu {
  convId: string
  x: number
  y: number
}

export default function ChatSidebarBody({ collapsed = false }: { collapsed?: boolean }) {
  const { t }         = useTranslation('chat')
  const setSidebarCollapsed = useUiStore(s => s.setSidebarCollapsed)
  const user          = useAuthStore(s => s.user)
  const conversations = useChatStore(s => s.conversations)
  const isLoading     = useChatStore(s => s.isLoadingConvs)
  const onlineUsers   = useChatStore(s => s.onlineUsers)
  const activeConvId  = useChatStore(s => s.activeConvId)
  const setActiveConv = useChatStore(s => s.setActiveConv)
  const fetchConvs    = useChatStore(s => s.fetchConversations)

  const [search,      setSearch]      = useState('')
  const [showNewDm,   setShowNewDm]   = useState(false)
  const [dmQuery,     setDmQuery]     = useState('')
  const [suggestions, setSuggestions] = useState<UserSuggestion[]>([])
  const [searching,   setSearching]   = useState(false)
  const [creatingDm,  setCreatingDm]  = useState(false)
  const [ctxMenu,     setCtxMenu]     = useState<CtxMenu | null>(null)
  const { confirm, confirmState, handleConfirm, handleCancel } = useConfirm()

  const dmInputRef    = useRef<HTMLInputElement>(null)
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleContextMenu = useCallback((e: React.MouseEvent, convId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({ convId, x: e.clientX, y: e.clientY })
  }, [])

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

  const myId = user?.id ?? ''

  const handleDelete = async (convId: string) => {
    closeMenu()
    const name = conversations.find(c => c.conversation.id === convId)
    const label = name ? `"${getConvName(name.conversation, myId, name.other_user)}"` : t('chat_this_conversation')
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
      setActiveConv(conv.id)
      setShowNewDm(false)
    } catch (e) {
      console.error('startDm', e)
    } finally {
      setCreatingDm(false)
    }
  }

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
      label: summary.is_favorite ? t('chat_remove_favorite') : t('chat_add_favorite'),
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

  // Replié : icône « nouveau message » (déplie la sidebar + ouvre le panneau DM).
  if (collapsed) {
    return (
      <nav className="flex flex-col items-center px-2 py-2 gap-1">
        <button
          onClick={() => { setSidebarCollapsed(false); setShowNewDm(true) }}
          title={t('chat_new_message')}
          className="w-10 h-10 flex items-center justify-center bg-white rounded-full transition-shadow"
          style={{ boxShadow: '0 1px 3px rgba(60,64,67,0.3), 0 4px 8px rgba(60,64,67,0.15)' }}
        >
          <MessageSquarePlus size={20} className="text-text-secondary" />
        </button>
      </nav>
    )
  }

  return (
    <>
      {/* Nouveau message */}
      <div className="px-3 mb-3">
        <button
          onClick={() => setShowNewDm(v => !v)}
          className="flex items-center gap-2 bg-white text-sm font-medium text-text-primary
                     cursor-pointer w-full hover:shadow-md transition-shadow"
          style={{
            padding:      '20px 25px',
            border:       '1px solid #e0e0e0',
            borderRadius: '20px',
            boxShadow:    '0 1px 3px rgba(0,0,0,0.12)',
          }}
        >
          <MessageSquarePlus size={20} className="text-text-secondary" />
          {t('chat_new_message')}
        </button>
      </div>

      {/* Panneau nouveau DM */}
      {showNewDm && (
        <div className="px-3 mb-3">
          <div className="relative">
            <Input
              ref={dmInputRef}
              type="text"
              placeholder={t('chat_search_user')}
              value={dmQuery}
              onChange={e => handleDmQueryChange(e.target.value)}
              disabled={creatingDm}
            />
            {(suggestions.length > 0 || searching) && (
              <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-border
                              rounded-xl shadow-xl z-20 overflow-hidden">
                {searching && (
                  <div className="px-3 py-2 text-xs text-text-tertiary">{t('chat_searching')}</div>
                )}
                {suggestions.map(u => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => startDm(u.id)}
                    disabled={creatingDm}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-surface-1
                               text-left transition-colors"
                  >
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center
                                    text-primary font-semibold text-sm flex-shrink-0">
                      {u.avatar_url
                        ? <img src={u.avatar_url} className="w-full h-full rounded-full object-cover" alt="" />
                        : (u.display_name?.[0] ?? u.username[0]).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-text-primary truncate">{u.display_name}</p>
                      <p className="text-xs text-text-tertiary truncate">@{u.username}</p>
                    </div>
                  </button>
                ))}
                {!searching && suggestions.length === 0 && dmQuery.trim().length > 0 && (
                  <div className="px-3 py-2 text-xs text-text-tertiary">{t('chat_no_user_found')}</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Barre de recherche */}
      <div className="px-3 mb-2">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            type="text"
            placeholder={t('chat_search_placeholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-surface-2 rounded-full border-0
                       focus:outline-none focus:ring-2 focus:ring-primary/30 text-text-primary
                       placeholder:text-text-tertiary"
          />
        </div>
      </div>

      {/* Liste des conversations */}
      <div className="flex-1 overflow-y-auto pb-4">
        {isLoading && conversations.length === 0 ? (
          <div className="px-3 py-4 text-center text-sm text-text-tertiary">{t('common_loading')}</div>
        ) : sorted.length === 0 ? (
          <div className="px-3 py-4 text-center text-sm text-text-tertiary">
            {search ? t('chat_no_results') : t('chat_no_conversation')}
          </div>
        ) : (
          sorted.map(({ conversation: conv, unread_count, other_user, is_pinned, is_favorite, muted_until }) => {
            const name       = getConvName(conv, myId, other_user)
            const isActive   = conv.id === activeConvId
            const otherId    = conv.conv_type === 'direct'
              ? (conv.user_a_id === myId ? conv.user_b_id : conv.user_a_id)
              : null
            const isOnline   = otherId ? onlineUsers.has(otherId) : false
            const isMutedConv = muted_until ? new Date(muted_until) > new Date() : false
            const initial    = name[0]?.toUpperCase() ?? '?'

            return (
              <button
                key={conv.id}
                type="button"
                onClick={() => setActiveConv(conv.id)}
                onContextMenu={e => handleContextMenu(e, conv.id)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 hover:bg-surface-1
                            transition-colors text-left
                            ${isActive ? 'bg-primary/10 hover:bg-primary/10' : ''}`}
              >
                {/* Avatar */}
                <div className="relative flex-shrink-0">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold ${
                    isActive ? 'bg-primary text-white' : 'bg-surface-2 text-text-secondary'
                  }`}>
                    {initial}
                  </div>
                  {isOnline && (
                    <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-white" />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <p className={`text-sm font-medium truncate ${isActive ? 'text-primary' : 'text-text-primary'}`}>
                      {name}
                    </p>
                    <div className="flex items-center gap-0.5 flex-shrink-0">
                      {is_pinned   && <Pin     size={10} className="text-text-tertiary" />}
                      {is_favorite && <Star    size={10} className="text-yellow-400 fill-yellow-400" />}
                      {isMutedConv && <BellOff size={10} className="text-text-tertiary" />}
                      {unread_count > 0 && (
                        <span className="bg-primary text-white text-[10px] rounded-full px-1.5 py-0.5 font-medium">
                          {unread_count > 99 ? '99+' : unread_count}
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-text-tertiary truncate">
                    {new Date(conv.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </button>
            )
          })
        )}
      </div>

      {/* Confirmation dialogs */}
      {confirmState && (
        <ConfirmDialog
          {...confirmState}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}

      {/* Menu contextuel */}
      {ctxMenu && ctxSummary && (
        <MenuDropdown
          pos={{ top: ctxMenu.y, left: ctxMenu.x }}
          onClose={closeMenu}
          items={buildItems(ctxMenu.convId, ctxSummary)}
        />
      )}
    </>
  )
}
