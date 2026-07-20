/**
 * Every clickable element here is an anchor carrying a real link (never a
 * <button>): navigation uses <Link>, and in-place actions use an href="#"
 * anchor with role="button". Views without a route of their own (shortcut
 * views, open conversation) are addressed through the module's query-string
 * scheme — see chatRoute.ts.
 *
 * Chat sidebar, organized in sections:
 *   Raccourcis        — Accueil / Mentions / Suivis (switch the main-area view)
 *   Messages privés   — direct conversations
 *   Espaces           — groups & public channels, plus "browse spaces"
 *
 * Each section header carries a ⋮ menu (sort by recency/alphabetical, quick
 * actions); each conversation row shows a ⋮ button on hover with the shared
 * conversation actions (useConvActions). The "new chat" panel offers a person
 * search, space creation and browsing, and frequent contacts.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router-dom'
import {
  MessageSquarePlus, Home, AtSign, Star, Pin, BellOff, ChevronDown,
  MoreVertical, Users, Compass, Plus, History, ArrowDownAZ, X, ArrowUp, ArrowDown,
} from 'lucide-react'
import { useChatStore, getConvName, type HomeView } from './chatStore'
import { useAuthStore, useUiStore, api } from '@kubuno/sdk'
import { chatApi, type ConversationSummary } from './api'
import { ConfirmDialog, MenuDropdown, useMenuDropdown, type MenuItem, Input, Button, AnchoredPopover } from '@ui'
import { useConvActions } from './useConvActions'
import { chatTo, chatFromLocation } from './chatRoute'

interface UserSuggestion {
  id: string
  username: string
  display_name: string
  avatar_url: string | null
}

/**
 * Hover background driven from JS instead of a `hover:bg-*` utility.
 *
 * A module bundle ships its own Tailwind build into the `kubuno-module` cascade
 * layer, which loses the race against the host's `utilities` layer: inside the
 * host sidebar, `hover:bg-*` coming from a module simply never paints (the
 * computed background stays transparent). Static background classes still win,
 * so only the hover variants have to be replaced. An inline style is immune to
 * the layer race. Same approach as the core's SidebarNavItem / LeftRail.
 *
 * Clearing the inline value on mouse leave (empty string, not 'transparent')
 * hands the element back to whatever `rowStyle` set — an active row keeps its
 * highlight.
 */
const hoverBg = (color: string) => ({
  onMouseEnter: (e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.backgroundColor = color },
  onMouseLeave: (e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.backgroundColor = '' },
})

/**
 * Row hover tint. Same value as the core's SidebarNavItem so this module's rows
 * highlight exactly like mail's — the left panel must feel like ONE sidebar.
 */
const ROW_HOVER = 'color-mix(in srgb, var(--color-primary) 12%, white)'

/**
 * Row metrics, shape and colours shared with the core's SidebarNavItem, so a
 * chat row and a mail row are visually identical. Active background is applied
 * inline for the same cascade-layer reason as the hover tint.
 */
const ROW_BASE = `relative flex items-center gap-3 w-full h-10 px-3 rounded-full text-sm text-left
  transition-colors no-underline outline-none focus-visible:ring-2 focus-visible:ring-primary`
const ROW_ACTIVE_BG = 'var(--color-primary-light, #d3e3fd)'
const rowCls = (active: boolean) =>
  `${ROW_BASE} cursor-pointer ${active ? 'text-primary font-medium' : 'text-text-secondary'}`
const rowStyle = (active: boolean) => ({ backgroundColor: active ? ROW_ACTIVE_BG : undefined })


type SectionSort = 'recent' | 'alpha'
const SORT_KEY = 'kubuno.chat.sectionSort'

function readSorts(): Record<string, SectionSort> {
  try { return JSON.parse(localStorage.getItem(SORT_KEY) ?? '{}') } catch { return {} }
}

/** Order of the two movable sections; "Raccourcis" always stays on top. */
type SectionId = 'dm' | 'spaces'
const ORDER_KEY = 'kubuno.chat.sectionOrder'
const DEFAULT_ORDER: SectionId[] = ['dm', 'spaces']

function readOrder(): SectionId[] {
  try {
    const raw = JSON.parse(localStorage.getItem(ORDER_KEY) ?? 'null')
    if (Array.isArray(raw) && raw.length === 2 && raw.every(id => DEFAULT_ORDER.includes(id))) return raw
  } catch { /* fall through */ }
  return DEFAULT_ORDER
}

export default function ChatSidebarBody({ collapsed = false }: { collapsed?: boolean }) {
  const { t } = useTranslation('chat')
  const setSidebarCollapsed = useUiStore(s => s.setSidebarCollapsed)
  const user = useAuthStore(s => s.user)
  const conversations = useChatStore(s => s.conversations)
  const onlineUsers = useChatStore(s => s.onlineUsers)
  const activeConvId = useChatStore(s => s.activeConvId)
  const setActiveConv = useChatStore(s => s.setActiveConv)
  const homeView = useChatStore(s => s.homeView)
  const setHomeView = useChatStore(s => s.setHomeView)
  const fetchConvs = useChatStore(s => s.fetchConversations)

  const [showNewChat, setShowNewChat] = useState(false)
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})
  const [sorts, setSorts] = useState<Record<string, SectionSort>>(readSorts)
  const [order, setOrder] = useState<SectionId[]>(readOrder)
  const [showNewSpace, setShowNewSpace] = useState(false)
  const newChatBtnRef = useRef<HTMLAnchorElement>(null)

  // The sidebar links are real links: read the selection back from the URL so a
  // pasted link, a reload and the browser Back button all land on the right view.
  const { pathname, search } = useLocation()
  useEffect(() => {
    if (pathname !== '/chat') return
    const { view, convId } = chatFromLocation(search)
    const store = useChatStore.getState()
    // setHomeView also clears the active conversation, hence the ordering.
    if (store.homeView !== view) store.setHomeView(view)
    if (useChatStore.getState().activeConvId !== convId) store.setActiveConv(convId)
  }, [pathname, search])

  // Row / section menus (one MenuDropdown at a time).
  const rowMenu = useMenuDropdown()
  const [menuConvId, setMenuConvId] = useState<string | null>(null)
  const sectionMenu = useMenuDropdown()
  const [menuSection, setMenuSection] = useState<'dm' | 'spaces' | null>(null)

  const { buildItems, confirmState, handleConfirm, handleCancel } = useConvActions()
  const myId = user?.id ?? ''

  function moveSection(section: SectionId, dir: -1 | 1) {
    const i = order.indexOf(section)
    const j = i + dir
    if (i < 0 || j < 0 || j >= order.length) return
    const next = [...order]
    next[i] = next[j]
    next[j] = section
    setOrder(next)
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(next)) } catch { /* best effort */ }
  }

  function setSort(section: string, sort: SectionSort) {
    const next = { ...sorts, [section]: sort }
    setSorts(next)
    try { localStorage.setItem(SORT_KEY, JSON.stringify(next)) } catch { /* best effort */ }
  }

  const sortRows = useCallback((rows: ConversationSummary[], section: string) => {
    const mode = sorts[section] ?? 'recent'
    return [...rows].sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1
      if (mode === 'alpha') {
        return getConvName(a.conversation, myId, a.other_user)
          .localeCompare(getConvName(b.conversation, myId, b.other_user))
      }
      return new Date(b.conversation.updated_at).getTime() - new Date(a.conversation.updated_at).getTime()
    })
  }, [sorts, myId])

  const visible = conversations.filter(c => !c.is_archived)
  const directs = sortRows(visible.filter(c => c.conversation.conv_type === 'direct'), 'dm')
  const spaces  = sortRows(
    visible.filter(c => c.conversation.conv_type !== 'direct' && !c.conversation.is_meeting),
    'spaces',
  )

  function openConv(convId: string) {
    setActiveConv(convId)
  }

  const shortcuts: { view: HomeView; icon: typeof Home; label: string }[] = [
    { view: 'home',     icon: Home,   label: t('chat_home',     { defaultValue: 'Accueil' }) },
    { view: 'mentions', icon: AtSign, label: t('chat_mentions', { defaultValue: 'Mentions' }) },
    { view: 'starred',  icon: Star,   label: t('chat_followed', { defaultValue: 'Suivis' }) },
  ]

  const sectionItems = (section: 'dm' | 'spaces'): MenuItem[] => {
    const mode = sorts[section] ?? 'recent'
    const head: MenuItem[] = section === 'dm'
      ? [{ type: 'action', icon: <MessageSquarePlus className="w-4 h-4" />, label: t('chat_new_dm'), onClick: () => setShowNewChat(true) }]
      : [
          { type: 'action', icon: <Plus className="w-4 h-4" />, label: t('chat_create_space', { defaultValue: 'Créer un espace' }), onClick: () => setShowNewSpace(true) },
          { type: 'action', icon: <Compass className="w-4 h-4" />, label: t('chat_browse_spaces', { defaultValue: 'Parcourir les espaces' }), onClick: () => setHomeView('browse') },
        ]
    return [
      ...head,
      { type: 'separator' },
      { type: 'action', icon: <History className="w-4 h-4" />, label: t('chat_sort_recent', { defaultValue: 'Trier par récence' }), checked: mode === 'recent', onClick: () => setSort(section, 'recent') },
      { type: 'action', icon: <ArrowDownAZ className="w-4 h-4" />, label: t('chat_sort_alpha', { defaultValue: 'Trier par ordre alphabétique' }), checked: mode === 'alpha', onClick: () => setSort(section, 'alpha') },
      { type: 'separator' },
      { type: 'action', icon: <ArrowUp className="w-4 h-4" />, label: t('chat_section_up', { defaultValue: 'Déplacer la section vers le haut' }), disabled: order.indexOf(section) === 0, onClick: () => moveSection(section, -1) },
      { type: 'action', icon: <ArrowDown className="w-4 h-4" />, label: t('chat_section_down', { defaultValue: 'Déplacer la section vers le bas' }), disabled: order.indexOf(section) === order.length - 1, onClick: () => moveSection(section, 1) },
    ]
  }

  // Collapsed sidebar: a single "new chat" shortcut.
  if (collapsed) {
    const expandAndCompose = () => { setSidebarCollapsed(false); setShowNewChat(true) }
    return (
      <nav className="flex flex-col items-center px-2 py-2 gap-1">
        <a
          href="#"
          role="button"
          onClick={e => { e.preventDefault(); expandAndCompose() }}
          onKeyDown={e => { if (e.key === ' ') { e.preventDefault(); expandAndCompose() } }}
          title={t('chat_new_message')}
          className="w-10 h-10 flex items-center justify-center bg-white rounded-full transition-shadow
                     cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary"
          style={{ boxShadow: '0 1px 3px rgba(60,64,67,0.3), 0 4px 8px rgba(60,64,67,0.15)' }}
        >
          <MessageSquarePlus size={20} className="text-text-secondary" />
        </a>
      </nav>
    )
  }

  const menuSummary = menuConvId ? conversations.find(c => c.conversation.id === menuConvId) : null

  return (
    <>
      {/* Nouveau chat */}
      <div className="px-3 mb-3">
        <a
          ref={newChatBtnRef}
          href="#"
          role="button"
          aria-expanded={showNewChat}
          onClick={e => { e.preventDefault(); setShowNewChat(v => !v) }}
          onKeyDown={e => { if (e.key === ' ') { e.preventDefault(); setShowNewChat(v => !v) } }}
          className="flex items-center gap-2 bg-white text-sm font-medium text-text-primary
                     cursor-pointer w-full hover:shadow-md transition-shadow
                     outline-none focus-visible:ring-2 focus-visible:ring-primary"
          style={{
            padding:      '20px 25px',
            border:       '1px solid #e0e0e0',
            borderRadius: '20px',
            boxShadow:    '0 1px 3px rgba(0,0,0,0.12)',
          }}
        >
          <MessageSquarePlus size={20} className="text-text-secondary" />
          {t('chat_new_message')}
        </a>

        {showNewChat && (
          <NewChatPanel
            anchorRef={newChatBtnRef}
            myId={myId}
            directs={directs}
            onlineUsers={onlineUsers}
            onClose={() => setShowNewChat(false)}
            onOpenConv={openConv}
            onCreateSpace={() => { setShowNewChat(false); setShowNewSpace(true) }}
          />
        )}
      </div>

      <div className="flex-1 overflow-y-auto pb-4 px-3 space-y-0.5">
        {/* ── Raccourcis ─────────────────────────────────────────────────────── */}
        <SectionHeader
          label={t('chat_shortcuts', { defaultValue: 'Raccourcis' })}
          collapsed={!!collapsedSections.shortcuts}
          onToggle={() => setCollapsedSections(s => ({ ...s, shortcuts: !s.shortcuts }))}
        />
        {!collapsedSections.shortcuts && shortcuts.map(({ view, icon: Icon, label }) => {
          const active = homeView === view && !activeConvId
          return (
            <Link
              key={view}
              to={chatTo('view', view)}
              aria-current={active ? 'page' : undefined}
              className={rowCls(active)}
              style={rowStyle(active)}
              {...(active ? {} : hoverBg(ROW_HOVER))}
            >
              <Icon size={17} className={active ? 'text-primary' : 'text-text-secondary'} />
              {label}
            </Link>
          )
        })}

        {/* Movable sections, in the order the user chose. */}
        {order.map(section => section === 'dm' ? (
          <div key="dm" className="space-y-0.5">
            <SectionHeader
              label={t('chat_direct_messages', { defaultValue: 'Messages privés' })}
              collapsed={!!collapsedSections.dm}
              onToggle={() => setCollapsedSections(s => ({ ...s, dm: !s.dm }))}
              onMenu={e => { setMenuSection('dm'); sectionMenu.open(e) }}
            />
            {!collapsedSections.dm && directs.map(summary => (
              <ConvRow
                key={summary.conversation.id}
                summary={summary}
                myId={myId}
                active={summary.conversation.id === activeConvId}
                online={isOnline(summary, myId, onlineUsers)}
                onMenu={e => { setMenuConvId(summary.conversation.id); rowMenu.open(e) }}
              />
            ))}
            {!collapsedSections.dm && directs.length === 0 && (
              <p className="px-3 py-1.5 text-xs text-text-tertiary">{t('chat_no_conversation')}</p>
            )}
          </div>
        ) : (
          <div key="spaces" className="space-y-0.5">
            <SectionHeader
              label={t('chat_spaces', { defaultValue: 'Espaces' })}
              collapsed={!!collapsedSections.spaces}
              onToggle={() => setCollapsedSections(s => ({ ...s, spaces: !s.spaces }))}
              onMenu={e => { setMenuSection('spaces'); sectionMenu.open(e) }}
            />
            {!collapsedSections.spaces && (
              <>
                {spaces.map(summary => (
                  <ConvRow
                    key={summary.conversation.id}
                    summary={summary}
                    myId={myId}
                    active={summary.conversation.id === activeConvId}
                    online={false}
                    square
                    onMenu={e => { setMenuConvId(summary.conversation.id); rowMenu.open(e) }}
                  />
                ))}
                <Link
                  to={chatTo('view', 'browse')}
                  aria-current={homeView === 'browse' && !activeConvId ? 'page' : undefined}
                  className={rowCls(homeView === 'browse' && !activeConvId)}
                  style={rowStyle(homeView === 'browse' && !activeConvId)}
                  {...(homeView === 'browse' && !activeConvId ? {} : hoverBg(ROW_HOVER))}
                >
                  <Compass size={17} />
                  {t('chat_browse_spaces', { defaultValue: 'Parcourir les espaces' })}
                </Link>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Dialog: create a space */}
      {showNewSpace && (
        <NewSpaceDialog
          onClose={() => setShowNewSpace(false)}
          onCreated={async convId => {
            setShowNewSpace(false)
            await fetchConvs()
            openConv(convId)
          }}
        />
      )}

      {confirmState && (
        <ConfirmDialog {...confirmState} onConfirm={handleConfirm} onCancel={handleCancel} />
      )}

      {rowMenu.pos && menuSummary && (
        <MenuDropdown pos={rowMenu.pos} onClose={() => { rowMenu.close(); setMenuConvId(null) }} items={buildItems(menuSummary)} />
      )}
      {sectionMenu.pos && menuSection && (
        <MenuDropdown pos={sectionMenu.pos} onClose={() => { sectionMenu.close(); setMenuSection(null) }} items={sectionItems(menuSection)} />
      )}
    </>
  )
}

function isOnline(summary: ConversationSummary, myId: string, onlineUsers: Set<string>): boolean {
  const conv = summary.conversation
  if (conv.conv_type !== 'direct') return false
  const otherId = conv.user_a_id === myId ? conv.user_b_id : conv.user_a_id
  return otherId ? onlineUsers.has(otherId) : false
}

function SectionHeader({ label, collapsed, onToggle, onMenu }: {
  label: string
  collapsed: boolean
  onToggle: () => void
  onMenu?: (e: React.MouseEvent) => void
}) {
  return (
    <div className="group flex items-center gap-1 pt-4 pb-1">
      {/* In-place actions (fold the section, open its menu): anchors, never buttons.
          Header typography matches the other modules' sidebar section headers. */}
      <a
        href="#"
        role="button"
        aria-expanded={!collapsed}
        onClick={e => { e.preventDefault(); onToggle() }}
        onKeyDown={e => { if (e.key === ' ') { e.preventDefault(); onToggle() } }}
        className="flex items-center gap-2 text-[10px] font-bold text-text-tertiary uppercase tracking-widest
                   hover:text-text-secondary cursor-pointer outline-none
                   focus-visible:ring-2 focus-visible:ring-primary rounded"
      >
        <ChevronDown size={13} className={`transition-transform ${collapsed ? '-rotate-90' : ''}`} />
        {label}
      </a>
      {onMenu && (
        <a
          href="#"
          role="button"
          onClick={e => { e.preventDefault(); onMenu(e) }}
          onKeyDown={e => { if (e.key === ' ') { e.preventDefault(); onMenu(e as unknown as React.MouseEvent) } }}
          className="ml-auto p-1 rounded-full text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity
                     cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary"
          {...hoverBg('var(--color-surface-2)')}
        >
          <MoreVertical size={14} />
        </a>
      )}
    </div>
  )
}

function ConvRow({ summary, myId, active, online, square = false, onMenu }: {
  summary: ConversationSummary
  myId: string
  active: boolean
  online: boolean
  square?: boolean
  onMenu: (e: React.MouseEvent) => void
}) {
  const conv = summary.conversation
  const name = getConvName(conv, myId, summary.other_user)
  const initial = name[0]?.toUpperCase() ?? '?'
  const isMuted = summary.muted_until ? new Date(summary.muted_until) > new Date() : false

  return (
    // The ⋮ trigger is a SIBLING of the row link: an anchor must never nest
    // inside another anchor.
    <div
      className={`group ${ROW_BASE} cursor-pointer`}
      style={rowStyle(active)}
      {...(active ? {} : hoverBg(ROW_HOVER))}
      onContextMenu={e => { e.preventDefault(); onMenu(e) }}
    >
      <Link
        to={chatTo('conv', conv.id)}
        aria-current={active ? 'page' : undefined}
        className="flex-1 min-w-0 flex items-center gap-3 self-stretch pr-2 -mr-2 cursor-pointer rounded-full
                   no-underline outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <div className="relative flex-shrink-0">
          <div className={`w-7 h-7 ${square ? 'rounded-lg' : 'rounded-full'} flex items-center justify-center text-xs font-semibold ${
            active ? 'bg-primary text-white' : 'bg-surface-2 text-text-secondary'
          }`}>
            {initial}
          </div>
          {online && <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-white" />}
        </div>

        <span className={`flex-1 min-w-0 truncate text-sm ${active ? 'text-primary font-medium' : 'text-text-primary'}`}>
          {name}
        </span>
      </Link>

      <span className="flex items-center gap-1 flex-shrink-0">
        {isMuted && <BellOff size={11} className="text-text-tertiary" />}
        {summary.is_pinned && <Pin size={11} className="text-text-tertiary group-hover:hidden" />}
        {(summary.unread_count > 0 || summary.is_unread) && (
          <span className="bg-primary text-white text-[10px] rounded-full px-1.5 py-0.5 font-medium group-hover:hidden min-w-[16px] text-center">
            {summary.unread_count > 0 ? (summary.unread_count > 99 ? '99+' : summary.unread_count) : ''}
          </span>
        )}
        <a
          href="#"
          role="button"
          onClick={e => { e.preventDefault(); e.stopPropagation(); onMenu(e) }}
          onKeyDown={e => { if (e.key === ' ') { e.preventDefault(); onMenu(e as unknown as React.MouseEvent) } }}
          className="p-1 rounded-full text-text-tertiary hidden group-hover:block
                     cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary"
          {...hoverBg('var(--color-surface-2)')}
        >
          <MoreVertical size={14} />
        </a>
      </span>
    </div>
  )
}

// ── Nouveau chat: person search + quick actions + frequent contacts ──────────

function NewChatPanel({ anchorRef, myId, directs, onlineUsers, onClose, onOpenConv, onCreateSpace }: {
  anchorRef: React.RefObject<HTMLElement | null>
  myId: string
  directs: ConversationSummary[]
  onlineUsers: Set<string>
  onClose: () => void
  onOpenConv: (convId: string) => void
  onCreateSpace: () => void
}) {
  const { t } = useTranslation('chat')
  const fetchConvs = useChatStore(s => s.fetchConversations)
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<UserSuggestion[]>([])
  const [searching, setSearching] = useState(false)
  const [creating, setCreating] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 50) }, [])

  function search(q: string) {
    setQuery(q)
    if (timer.current) clearTimeout(timer.current)
    if (!q.trim()) { setSuggestions([]); return }
    setSearching(true)
    timer.current = setTimeout(async () => {
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
    if (creating) return
    setCreating(true)
    try {
      const conv = await chatApi.createDirect(targetUserId)
      await fetchConvs()
      onOpenConv(conv.id)
      onClose()
    } catch (e) {
      console.error('startDm', e)
    } finally {
      setCreating(false)
    }
  }

  // Frequent contacts: most recently active direct conversations.
  const frequent = directs.slice(0, 5)

  // AnchoredPopover (core primitive) portals the panel out of the sidebar, which
  // would otherwise clip it and stack it under the main area.
  return (
    <AnchoredPopover anchorRef={anchorRef} open onClose={onClose}>
    <div className="w-[300px] max-w-[85vw] bg-white border border-border rounded-2xl shadow-2xl overflow-hidden">
      <div className="p-2">
        <Input
          ref={inputRef}
          type="text"
          placeholder={t('chat_add_people', { defaultValue: 'Ajouter une personne ou plus' })}
          value={query}
          onChange={e => search(e.target.value)}
          disabled={creating}
        />
      </div>

      {query.trim() ? (
        <div className="max-h-64 overflow-y-auto pb-2">
          {searching && <p className="px-4 py-2 text-xs text-text-tertiary">{t('chat_searching')}</p>}
          {!searching && suggestions.length === 0 && (
            <p className="px-4 py-2 text-xs text-text-tertiary">{t('chat_no_user_found')}</p>
          )}
          {suggestions.map(u => (
            <PersonRow key={u.id} name={u.display_name || u.username} sub={`@${u.username}`} avatarUrl={u.avatar_url} onClick={() => startDm(u.id)} />
          ))}
        </div>
      ) : (
        <>
          <a
            href="#"
            role="button"
            onClick={e => { e.preventDefault(); onCreateSpace() }}
            onKeyDown={e => { if (e.key === ' ') { e.preventDefault(); onCreateSpace() } }}
            className={rowCls(false)}
            {...hoverBg(ROW_HOVER)}
          >
            <Users size={17} className="text-text-secondary" />
            {t('chat_create_space', { defaultValue: 'Créer un espace' })}
          </a>
          <Link
            to={chatTo('view', 'browse')}
            onClick={onClose}
            className={rowCls(false)}
            {...hoverBg(ROW_HOVER)}
          >
            <Compass size={17} className="text-text-secondary" />
            {t('chat_browse_spaces', { defaultValue: 'Parcourir les espaces' })}
          </Link>

          {frequent.length > 0 && (
            <>
              <p className="px-4 pt-3 pb-1 text-xs font-medium text-text-secondary">
                {t('chat_frequent', { defaultValue: 'Fréquents' })}
              </p>
              <div className="pb-2">
                {frequent.map(s => {
                  const name = getConvName(s.conversation, myId, s.other_user)
                  return (
                    <PersonRow
                      key={s.conversation.id}
                      name={name}
                      sub={s.other_user ? `@${s.other_user.username}` : ''}
                      avatarUrl={s.other_user?.avatar_url ?? null}
                      online={isOnline(s, myId, onlineUsers)}
                      to={chatTo('conv', s.conversation.id)}
                      onClick={onClose}
                    />
                  )
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
    </AnchoredPopover>
  )
}

/**
 * A person / conversation row. `to` makes it a real navigation link; without it
 * the row is a pure action (starting a new DM), so an href="#" anchor.
 */
function PersonRow({ name, sub, avatarUrl, online = false, to, onClick }: {
  name: string
  sub: string
  avatarUrl: string | null
  online?: boolean
  to?: string
  onClick: () => void
}) {
  const cls = rowCls(false)
  const hover = hoverBg(ROW_HOVER)

  const body = (
    <>
      <div className="relative flex-shrink-0">
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm overflow-hidden">
          {avatarUrl
            ? <img src={avatarUrl} className="w-full h-full object-cover" alt="" />
            : (name[0] ?? '?').toUpperCase()}
        </div>
        {online && <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-white" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-primary truncate">{name}</p>
        {sub && <p className="text-xs text-text-tertiary truncate">{sub}</p>}
      </div>
    </>
  )

  if (to) return <Link to={to} onClick={onClick} className={cls} {...hover}>{body}</Link>

  return (
    <a
      href="#"
      role="button"
      onClick={e => { e.preventDefault(); onClick() }}
      onKeyDown={e => { if (e.key === ' ') { e.preventDefault(); onClick() } }}
      className={cls}
      {...hover}
    >
      {body}
    </a>
  )
}

// ── Create-space dialog ───────────────────────────────────────────────────────

function NewSpaceDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (convId: string) => void }) {
  const { t } = useTranslation('chat')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  async function create() {
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    try {
      const conv = await chatApi.createSpace(trimmed)
      onCreated(conv.id)
    } catch (e) {
      console.error('createSpace', e)
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[2147483100] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-[360px] max-w-full" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">{t('chat_create_space', { defaultValue: 'Créer un espace' })}</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4">
          <Input
            autoFocus
            type="text"
            placeholder={t('chat_space_name', { defaultValue: "Nom de l'espace" })}
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') create() }}
            disabled={busy}
          />
          <p className="mt-2 text-xs text-gray-400">
            {t('chat_space_hint', { defaultValue: 'Un espace est public : tout le monde peut le trouver et le rejoindre.' })}
          </p>
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t('common_cancel')}</Button>
          <Button onClick={create} disabled={busy || !name.trim()}>{t('common_create')}</Button>
        </div>
      </div>
    </div>
  )
}
