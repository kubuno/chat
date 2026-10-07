import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { MenuDropdown, useMenuDropdown, type MenuItem } from '@ui'
import { Mic, MicOff, Monitor, X, ChevronUp, MoreVertical, Pin, PinOff, UserPlus, Search, UserMinus } from 'lucide-react'
import { api } from '@kubuno/sdk'
import { useChatStore } from './chatStore'
import { chatApi } from './api'
import { Tile } from './callShared'




/**
 * The meeting's people panel: who is in the room, a search over them, a way to
 * invite someone else, and a per-person menu. Contacts offered when inviting
 * come from the caller's own organizational unit, like every people search in
 * chat.
 */
export function PeoplePanel({ room, meetingTitle, tiles, myId, isHost, pinnedId, onPin, onMute, onRemove, onClose }: {
  room: string
  meetingTitle: string
  tiles: Tile[]
  myId: string
  /** Hosting the meeting unlocks muting and removing people. */
  isHost: boolean
  pinnedId: string | null
  onPin: (userId: string) => void
  onMute: (userId: string) => void
  onRemove: (userId: string, name: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation('chat')
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [candidates, setCandidates] = useState<{ id: string; display_name: string; username: string }[]>([])
  const [collapsed, setCollapsed] = useState(false)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const rowMenu = useMenuDropdown()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // In "add" mode the field searches the directory; otherwise it filters the room.
  useEffect(() => {
    if (!adding) { setCandidates([]); return }
    if (timer.current) clearTimeout(timer.current)
    const q = query.trim()
    if (!q) { setCandidates([]); return }
    timer.current = setTimeout(async () => {
      try {
        const res = await api.get<{ users: { id: string; display_name: string; username: string }[] }>(
          '/users/search', { params: { q, limit: 8, scope: 'unit' } },
        )
        const present = new Set(tiles.map(tl => tl.userId))
        setCandidates(res.data.users.filter(u => !present.has(u.id)))
      } catch { setCandidates([]) }
    }, 200)
  }, [query, adding, tiles])

  const shown = adding
    ? tiles
    : tiles.filter(tl => tl.name.toLowerCase().includes(query.trim().toLowerCase()))

  async function invite(userId: string) {
    try { await chatApi.addMembers(room, [userId]) } catch { /* already a member */ }
    // Being added to a meeting should feel like being called: ring the person
    // so they get the incoming overlay rather than discovering it later.
    const me = tiles.find(tl => tl.userId === myId)
    useChatStore.getState().sendCallSignal(userId, {
      type: 'call_ring',
      room,
      call_type: 'video',
      from_name: me?.name ?? '',
      is_meeting: true,
      meeting_title: meetingTitle,
    })
    setAdding(false); setQuery('')
  }

  const menuTile = tiles.find(tl => tl.userId === menuFor)
  const rowItems: MenuItem[] = menuTile
    ? [
        {
          type: 'action',
          icon: pinnedId === menuTile.userId ? <PinOff size={16} /> : <Pin size={16} />,
          label: pinnedId === menuTile.userId ? t('chat_call_unpin') : t('chat_call_pin'),
          onClick: () => onPin(menuTile.userId),
        },
        // A host may quieten and remove; nobody may turn someone else's
        // microphone back on, which stays that person's own decision.
        ...(isHost && !menuTile.isLocal
          ? [
              { type: 'separator' as const },
              {
                type: 'action' as const,
                icon: <MicOff size={16} />,
                label: t('chat_call_mute_participant'),
                disabled: menuTile.muted,
                onClick: () => onMute(menuTile.userId),
              },
              {
                type: 'action' as const,
                icon: <UserMinus size={16} />,
                label: t('chat_call_remove'),
                danger: true,
                onClick: () => onRemove(menuTile.userId, menuTile.name),
              },
            ]
          : []),
      ]
    : []

  return (
    // A side panel keeps its width until the window gets narrow, then follows
    // it: it stays visible at any size instead of being pushed off-screen.
    <div className="relative z-10 flex-shrink-0 bg-[#2a2b2e] text-gray-100 flex flex-col rounded-2xl overflow-hidden mr-3 mb-1" style={{ width: 'min(20rem, 70vw)' }}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <span className="text-sm font-medium">{t('chat_call_people')}</span>
        <button onClick={onClose} className="p-1 rounded hover:bg-white/10"><X className="w-4 h-4" /></button>
      </div>

      <div className="px-4 pt-3 pb-2 flex flex-col gap-3">
        <button
          onClick={() => { setAdding(a => !a); setQuery('') }}
          className={`self-start flex items-center gap-2 rounded-full px-4 py-2 text-sm transition-colors ${adding ? 'bg-primary text-white' : 'bg-white/10 hover:bg-white/20'}`}
        >
          <UserPlus size={16} />
          {t('chat_call_add_people')}
        </button>
        <div className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-2">
          <Search size={15} className="text-gray-400 flex-shrink-0" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={adding ? t('chat_call_search_contacts') : t('chat_call_search_people')}
            className="bg-transparent text-sm outline-none w-full placeholder:text-gray-400"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-3">
        {adding && (
          <div className="px-2 pb-2">
            {candidates.map(u => (
              <button key={u.id} onClick={() => invite(u.id)} className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-white/10 text-left">
                <span className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-sm font-semibold flex-shrink-0">
                  {(u.display_name || u.username)[0]?.toUpperCase()}
                </span>
                <span className="flex-1 min-w-0 truncate text-sm">{u.display_name || u.username}</span>
                <UserPlus size={15} className="text-gray-400" />
              </button>
            ))}
            {query.trim() !== '' && candidates.length === 0 && (
              <p className="px-2 py-2 text-xs text-gray-400">{t('chat_no_user_found')}</p>
            )}
          </div>
        )}

        <p className="px-4 pt-1 pb-1 text-[11px] uppercase tracking-wide text-gray-400">
          {t('chat_call_in_meeting')}
        </p>
        <button
          onClick={() => setCollapsed(c => !c)}
          className="w-full flex items-center gap-2 px-4 py-2 text-sm hover:bg-white/5"
        >
          <span className="flex-1 text-left">{t('chat_call_contributors')}</span>
          <span className="tabular-nums text-gray-300">{tiles.length}</span>
          <ChevronUp size={16} className={`text-gray-400 transition-transform ${collapsed ? 'rotate-180' : ''}`} />
        </button>

        {!collapsed && shown.map(tl => (
          <div key={tl.userId} className="group flex items-center gap-3 px-4 py-2 hover:bg-white/5">
            <div className="w-9 h-9 rounded-full bg-white/10 text-gray-100 flex items-center justify-center text-sm font-semibold flex-shrink-0">
              {tl.name[0]?.toUpperCase()}
            </div>
            <span className="flex-1 min-w-0 truncate text-sm">
              {tl.name}{tl.userId === myId ? ` (${t('chat_call_you')})` : ''}
            </span>
            {tl.hand && <span className="text-base">✋</span>}
            {tl.muted
              ? <MicOff className="w-4 h-4 text-gray-400 flex-shrink-0" />
              : <Mic className="w-4 h-4 text-gray-400 flex-shrink-0" />}
            <button
              onClick={e => { setMenuFor(tl.userId); rowMenu.open(e) }}
              className="p-1 rounded hover:bg-white/10 opacity-0 group-hover:opacity-100 flex-shrink-0"
              title={t('chat_more', { defaultValue: 'Plus' })}
            >
              <MoreVertical className="w-4 h-4" />
            </button>
          </div>
        ))}
        {/* A presentation is listed under its author, as a second entry. */}
        {!collapsed && shown.filter(tl => tl.sharing).map(tl => (
          <div key={`${tl.userId}-share`} className="flex items-center gap-3 px-4 py-2">
            <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
              <Monitor className="w-4 h-4 text-gray-300" />
            </div>
            <span className="flex-1 min-w-0 truncate text-sm">
              {tl.name}
              <span className="block text-xs text-gray-400">{t('chat_call_presentation')}</span>
            </span>
          </div>
        ))}
      </div>

      {rowMenu.pos && (
        <MenuDropdown pos={rowMenu.pos} onClose={() => { rowMenu.close(); setMenuFor(null) }} items={rowItems} theme="dark" />
      )}
    </div>
  )
}
