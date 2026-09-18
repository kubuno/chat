import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CalendarClock, ChevronLeft, ChevronRight, Video, ArrowRight,
  MoreVertical, Trash2, Info, Link as LinkIcon, Link2, Check, X, Copy,
} from 'lucide-react'
import { ConfirmDialog, MenuDropdown, useMenuDropdown, type MenuItem } from '@ui'
import { useAuthStore } from '@kubuno/sdk'
import { useChatStore, getConvName } from './chatStore'
import { useMeetingActions } from './useMeetingActions'
import MeetingDetailPanel from './MeetingDetailPanel'

// ── Small date helpers (Intl only — no date library, per the platform's deps) ──
function startOfWeek(d: Date): Date {
  const x = new Date(d); x.setHours(0, 0, 0, 0)
  const dow = (x.getDay() + 6) % 7 // Monday = 0
  x.setDate(x.getDate() - dow)
  return x
}
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x }
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
const fmt = (d: Date, lang: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(lang, opts).format(d)

interface MeetingItem { id: string; title: string; at: Date; linked: boolean }

export default function MeetingsView() {
  const { t, i18n } = useTranslation('chat')
  const lang = i18n.language
  const user = useAuthStore(s => s.user)
  const myId = user?.id ?? ''
  const conversations = useChatStore(s => s.conversations)
  const meeting = useMeetingActions()

  const [selected, setSelected] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d })
  const [joinValue, setJoinValue] = useState('')
  // The meeting whose details are shown in the right pane (a plain click opens
  // this, never the call — joining is an explicit action).
  const [openId, setOpenId] = useState<string | null>(null)

  // Context / row menu shared across rows: which meeting it targets is tracked
  // separately so the same MenuDropdown instance serves every row.
  const rowMenu = useMenuDropdown()
  const [menuMeeting, setMenuMeeting] = useState<MeetingItem | null>(null)

  // Multi-selection for bulk actions (checkboxes + a toolbar). The last clicked
  // row anchors shift-click range selection.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [anchorId, setAnchorId] = useState<string | null>(null)

  // The detail card is aligned with the top of the first list row (below the
  // header and week strip), and kept there. We measure the offset rather than
  // hard-code it, so it survives header/strip height changes.
  const rootRef = useRef<HTMLDivElement>(null)
  const listAreaRef = useRef<HTMLDivElement>(null)
  const [panelTop, setPanelTop] = useState(0)

  const weekStart = useMemo(() => startOfWeek(selected), [selected])
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])

  // Meetings = the user's meeting rooms. Their creation time stands in for the
  // meeting time until calendar-scheduled meetings are wired in.
  const dayMeetings = useMemo<MeetingItem[]>(() => {
    return conversations
      .filter(c => c.conversation.is_meeting && !c.is_archived)
      .map(c => ({
        id: c.conversation.id,
        title: getConvName(c.conversation, myId, c.other_user),
        at: new Date(c.conversation.created_at),
        // Attached to something that owns its title — an event, a task. Renaming
        // it here renames that too, which the reader deserves to be told BEFORE
        // typing rather than after.
        linked: Boolean(c.conversation.linked_ref),
      }))
      .filter(m => sameDay(m.at, selected))
      .sort((a, b) => a.at.getTime() - b.at.getTime())
  }, [conversations, selected, myId])

  const now = new Date()
  const upcoming = dayMeetings.filter(m => m.at.getTime() >= now.getTime())
  const past = dayMeetings.filter(m => m.at.getTime() < now.getTime())

  // Visible order (upcoming then past) — the sequence shift-click ranges follow.
  const orderedIds = useMemo(() => [...upcoming, ...past].map(m => m.id), [upcoming, past])
  // Drop selections for meetings no longer shown (e.g. after switching day).
  const selectedList = useMemo(() => {
    const shown = new Set(orderedIds)
    return [...selectedIds].filter(id => shown.has(id))
  }, [selectedIds, orderedIds])
  const selectionActive = selectedList.length > 0
  const allSelected = orderedIds.length > 0 && selectedList.length === orderedIds.length

  const clearSelection = () => { setSelectedIds(new Set()); setAnchorId(null) }
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
    setAnchorId(id)
  }
  const selectRangeTo = (id: string) => {
    const from = anchorId ? orderedIds.indexOf(anchorId) : -1
    const to = orderedIds.indexOf(id)
    if (from === -1 || to === -1) { toggleSelect(id); return }
    const [lo, hi] = from <= to ? [from, to] : [to, from]
    setSelectedIds(prev => { const next = new Set(prev); for (let k = lo; k <= hi; k++) next.add(orderedIds[k]); return next })
  }
  const toggleSelectAll = () => {
    if (allSelected) clearSelection()
    else { setSelectedIds(new Set(orderedIds)); setAnchorId(orderedIds[orderedIds.length - 1] ?? null) }
  }

  const openMeeting = (m: MeetingItem) => setOpenId(m.id)
  const deleteMeeting = (id: string) => { meeting.deleteMeeting(id); if (openId === id) setOpenId(null) }

  const bulkDelete = async () => {
    const ids = selectedList
    if (openId && ids.includes(openId)) setOpenId(null)
    await meeting.deleteMeetings(ids)
    clearSelection()
  }
  const bulkCopyLinks = () => meeting.copyMeetingLinks(selectedList)

  // A plain click opens the details pane; Ctrl/Cmd-click toggles a selection and
  // Shift-click extends a range — so both flows share the row body.
  const activateRow = (m: MeetingItem, e: React.MouseEvent | React.KeyboardEvent) => {
    if ('shiftKey' in e && e.shiftKey && (selectionActive || anchorId)) { selectRangeTo(m.id); return }
    if ('metaKey' in e && (e.metaKey || e.ctrlKey)) { toggleSelect(m.id); return }
    openMeeting(m)
  }

  // Keep the detail card's top aligned with the first list row.
  useLayoutEffect(() => {
    if (!openId) return
    const measure = () => {
      const root = rootRef.current
      const firstRow = listAreaRef.current?.querySelector('section [role="button"]')
      if (!root || !firstRow) return
      const offset = firstRow.getBoundingClientRect().top - root.getBoundingClientRect().top
      setPanelTop(Math.max(0, Math.round(offset)))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [openId, dayMeetings, selected])

  // The row's context menu. Kept small and self-contained so new actions can be
  // slotted in progressively.
  const buildMenuItems = (m: MeetingItem): MenuItem[] => [
    {
      type: 'action',
      icon: <Video className="w-4 h-4" />,
      label: t('chat_meeting_join', { defaultValue: 'Rejoindre' }),
      onClick: () => meeting.enterMeeting(m.id),
    },
    {
      type: 'action',
      icon: <Info className="w-4 h-4" />,
      label: t('chat_meeting_details', { defaultValue: 'Détails de la réunion' }),
      onClick: () => setOpenId(m.id),
    },
    {
      type: 'action',
      icon: <LinkIcon className="w-4 h-4" />,
      label: t('chat_meeting_copy_link', { defaultValue: 'Copier le lien' }),
      onClick: () => meeting.copyMeetingLink(m.id),
    },
    { type: 'separator' },
    {
      type: 'action',
      icon: <Trash2 className="w-4 h-4" />,
      label: t('chat_meeting_delete', { defaultValue: 'Supprimer la réunion' }),
      onClick: () => deleteMeeting(m.id),
      danger: true,
    },
  ]

  const openRowMenu = (m: MeetingItem, e: React.MouseEvent) => { setMenuMeeting(m); rowMenu.open(e) }

  return (
    <div ref={rootRef} className="flex-1 flex min-h-0" data-module="chat">
      {/* Left column hugs the list (capped) once the detail pane is open, so the
          pane sits right after it; any leftover width stays on the far right. */}
      <div className={`flex-1 flex flex-col min-h-0 ${openId ? 'max-w-3xl' : ''}`}>
        {/* Header: title + join-by-link (creating a meeting lives on the sidebar "New" button) */}
        <header className="flex items-center gap-3 px-6 pt-5 pb-3">
          <CalendarClock className="w-6 h-6 text-primary" />
          <h1 className="text-2xl text-gray-900">{t('chat_meetings', { defaultValue: 'Réunions' })}</h1>
          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center rounded-full border border-border bg-surface-1 focus-within:border-primary overflow-hidden">
              <input
                value={joinValue}
                onChange={e => setJoinValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && joinValue.trim()) { meeting.joinByLink(joinValue); setJoinValue('') } }}
                placeholder={t('chat_meeting_join_placeholder', { defaultValue: 'Saisir un lien de réunion' })}
                className="bg-transparent px-4 py-2 text-sm outline-none w-56"
              />
              <button
                disabled={!joinValue.trim()}
                onClick={() => { meeting.joinByLink(joinValue); setJoinValue('') }}
                className="px-3 py-2 text-primary hover:bg-primary/10 disabled:opacity-40 transition-colors"
                title={t('chat_meeting_join', { defaultValue: 'Rejoindre' })}
              >
                <ArrowRight size={18} />
              </button>
            </div>
          </div>
        </header>

        {/* Day label + week strip */}
        <div className="px-6 pb-3 flex items-center gap-4">
          <div className="flex items-center gap-2 min-w-[190px]">
            <span className="text-lg text-gray-900 capitalize">
              {fmt(selected, lang, { weekday: 'short', day: 'numeric', month: 'short' })}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setSelected(addDays(selected, -1))} className="p-1.5 rounded-full text-text-secondary hover:bg-surface-1" title={t('common_previous', { defaultValue: 'Précédent' })}>
              <ChevronLeft size={18} />
            </button>
            <div className="flex items-center gap-1">
              {weekDays.map(d => {
                const isSel = sameDay(d, selected)
                const isToday = sameDay(d, now)
                return (
                  <button
                    key={d.toISOString()}
                    onClick={() => setSelected(d)}
                    className="flex flex-col items-center w-11 py-1 rounded-xl hover:bg-surface-1 transition-colors"
                    aria-current={isSel ? 'date' : undefined}
                  >
                    <span className="text-[11px] uppercase text-text-tertiary">{fmt(d, lang, { weekday: 'short' }).replace('.', '')}</span>
                    <span className={`mt-0.5 w-8 h-8 flex items-center justify-center rounded-full text-sm
                      ${isSel ? 'bg-primary text-white' : isToday ? 'text-primary font-semibold' : 'text-gray-800'}`}>
                      {d.getDate()}
                    </span>
                  </button>
                )
              })}
            </div>
            <button onClick={() => setSelected(addDays(selected, 1))} className="p-1.5 rounded-full text-text-secondary hover:bg-surface-1" title={t('common_next', { defaultValue: 'Suivant' })}>
              <ChevronRight size={18} />
            </button>
          </div>
        </div>

        {/* Bulk-action toolbar — appears once at least one meeting is selected */}
        {selectionActive && (
          <div className="mx-6 mb-2 flex items-center gap-3 px-4 py-2 rounded-xl bg-primary/10">
            <button
              onClick={toggleSelectAll}
              className="flex items-center gap-2 text-sm text-primary"
              title={allSelected ? t('common_deselect_all', { defaultValue: 'Tout désélectionner' }) : t('common_select_all', { defaultValue: 'Tout sélectionner' })}
            >
              <Checkbox checked={allSelected} />
              <span>{t('chat_meeting_selected_count', { count: selectedList.length, defaultValue: '{{count}} sélectionnée(s)' })}</span>
            </button>
            <div className="ml-auto flex items-center gap-1">
              <button onClick={bulkCopyLinks} className="flex items-center gap-1.5 text-sm text-text-secondary px-3 py-1.5 rounded-full hover:bg-surface-2">
                <Copy size={15} />
                {t('chat_meeting_copy_links', { defaultValue: 'Copier les liens' })}
              </button>
              <button onClick={bulkDelete} className="flex items-center gap-1.5 text-sm text-danger px-3 py-1.5 rounded-full hover:bg-danger/10">
                <Trash2 size={15} />
                {t('common_delete', { defaultValue: 'Supprimer' })}
              </button>
              <button onClick={clearSelection} className="p-1.5 rounded-full text-text-secondary hover:bg-surface-2" title={t('common_cancel', { defaultValue: 'Annuler' })}>
                <X size={16} />
              </button>
            </div>
          </div>
        )}

        {/* Agenda for the selected day */}
        <div ref={listAreaRef} className="flex-1 overflow-y-auto px-6 py-4">
          {dayMeetings.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center gap-3 text-text-tertiary">
              <div className="w-20 h-20 rounded-full bg-surface-1 flex items-center justify-center">
                <CalendarClock className="w-9 h-9 text-text-tertiary" />
              </div>
              <p className="text-sm">{t('chat_meeting_none_day', { defaultValue: 'Aucune réunion ce jour.' })}</p>
              <button onClick={() => meeting.createMeeting(true)} className="text-sm text-primary hover:underline">
                {t('chat_meeting_start_now', { defaultValue: 'Démarrer une réunion maintenant' })}
              </button>
            </div>
          ) : (
            <div className="max-w-3xl">
              <MeetingSection title={t('chat_meeting_upcoming', { defaultValue: 'À venir' })} items={upcoming} lang={lang} activeId={openId} selectedIds={selectedIds} selectionActive={selectionActive} onActivate={activateRow} onToggleSelect={toggleSelect} onJoin={meeting.enterMeeting} onDelete={deleteMeeting} onMenu={openRowMenu} t={t} />
              <MeetingSection title={t('chat_meeting_past', { defaultValue: 'Passées' })} items={past} lang={lang} activeId={openId} selectedIds={selectedIds} selectionActive={selectionActive} onActivate={activateRow} onToggleSelect={toggleSelect} onJoin={meeting.enterMeeting} onDelete={deleteMeeting} onMenu={openRowMenu} t={t} />
            </div>
          )}
        </div>
      </div>

      {/* Right pane: details + transcript of the clicked meeting */}
      {openId && (() => {
        const m = dayMeetings.find(x => x.id === openId)
        if (!m) return null
        return (
          <MeetingDetailPanel
            key={m.id}
            meetingId={m.id}
            title={m.title}
            at={m.at}
            lang={lang}
            topOffset={panelTop}
            onClose={() => setOpenId(null)}
            onJoin={meeting.enterMeeting}
            onDelete={deleteMeeting}
          />
        )
      })()}

      {rowMenu.pos && menuMeeting && (
        <MenuDropdown pos={rowMenu.pos} onClose={() => { rowMenu.close(); setMenuMeeting(null) }} items={buildMenuItems(menuMeeting)} />
      )}

      {meeting.confirmState && (
        <ConfirmDialog {...meeting.confirmState} onConfirm={meeting.handleConfirm} onCancel={meeting.handleCancel} />
      )}
    </div>
  )
}

/** A small controlled checkbox that matches the module's accent. */
function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span
      className={`w-[18px] h-[18px] rounded flex items-center justify-center border transition-colors
        ${checked ? 'bg-primary border-primary text-white' : 'border-border bg-surface-0'}`}
    >
      {checked && <Check size={13} strokeWidth={3} />}
    </span>
  )
}

function MeetingSection({ title, items, lang, activeId, selectedIds, selectionActive, onActivate, onToggleSelect, onJoin, onDelete, onMenu, t }: {
  title: string
  items: MeetingItem[]
  lang: string
  activeId: string | null
  selectedIds: Set<string>
  selectionActive: boolean
  onActivate: (m: MeetingItem, e: React.MouseEvent | React.KeyboardEvent) => void
  onToggleSelect: (id: string) => void
  onJoin: (id: string) => void
  onDelete: (id: string) => void
  onMenu: (m: MeetingItem, e: React.MouseEvent) => void
  t: (k: string, o?: Record<string, unknown>) => string
}) {
  // Row actions reveal on hover. Driven by React state + an inline opacity
  // rather than Tailwind `group-hover` utilities: a module's utilities live in
  // the `kubuno-module` cascade layer, which loses to the host's `utilities`
  // layer, so `opacity-0`/`group-hover:opacity-100` behave inconsistently here.
  const [hoverId, setHoverId] = useState<string | null>(null)
  if (items.length === 0) return null
  return (
    <section className="mb-6">
      <h2 className="text-xs font-medium uppercase tracking-wide text-text-tertiary mb-2">{title}</h2>
      <div className="flex flex-col gap-2">
        {items.map(m => {
          const isActive = m.id === activeId
          const isSelected = selectedIds.has(m.id)
          const hovered = hoverId === m.id
          const revealed = hovered || isActive
          // The checkbox shows on hover, or whenever a selection is in progress.
          const showCheck = hovered || selectionActive
          return (
            <div
              key={m.id}
              onClick={e => onActivate(m, e)}
              onContextMenu={e => { e.preventDefault(); onMenu(m, e) }}
              onMouseEnter={() => setHoverId(m.id)}
              onMouseLeave={() => setHoverId(h => (h === m.id ? null : h))}
              role="button"
              tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter') onActivate(m, e) }}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition-colors
                ${isSelected || isActive ? 'bg-primary/10' : 'bg-surface-1 hover:bg-surface-2'}`}
            >
              {/* Selection checkbox (keeps the row layout stable when hidden) */}
              <button
                onClick={e => { e.stopPropagation(); onToggleSelect(m.id) }}
                className="flex-shrink-0 flex items-center"
                style={{ opacity: showCheck || isSelected ? 1 : 0, pointerEvents: showCheck || isSelected ? 'auto' : 'none', transition: 'opacity .15s ease' }}
                title={t('common_select', { defaultValue: 'Sélectionner' })}
                aria-pressed={isSelected}
              >
                <Checkbox checked={isSelected} />
              </button>
              <div className="text-sm text-text-secondary tabular-nums w-14 flex-shrink-0">
                {fmt(m.at, lang, { hour: '2-digit', minute: '2-digit' })}
              </div>
              <div className="flex-1 min-w-0">
                <p className="flex min-w-0 items-center gap-1.5 text-[15px] text-gray-900">
                  <span className="truncate">{m.title}</span>
                  {m.linked && (
                    <span className="shrink-0 text-text-tertiary"
                      aria-label={t('chat_meeting_title_linked', { defaultValue: 'Titre lié' })}
                      title={t('chat_meeting_title_linked_hint', { defaultValue: 'Ce nom est celui de l’élément auquel la réunion est rattachée : le changer ici le change là aussi.' })}>
                      <Link2 size={13} />
                    </span>
                  )}
                </p>
              </div>
              <div
                className="flex items-center gap-1 flex-shrink-0"
                style={{ opacity: revealed ? 1 : 0, pointerEvents: revealed ? 'auto' : 'none', transition: 'opacity .15s ease' }}
              >
                <button
                  onClick={e => { e.stopPropagation(); onJoin(m.id) }}
                  className="flex items-center gap-1.5 bg-primary text-white text-sm px-3 py-1.5 rounded-full hover:opacity-90"
                >
                  <Video size={15} />
                  {t('chat_meeting_join', { defaultValue: 'Rejoindre' })}
                </button>
                <button
                  onClick={e => { e.stopPropagation(); onDelete(m.id) }}
                  className="p-1.5 rounded-full text-danger hover:bg-danger/10"
                  title={t('chat_meeting_delete', { defaultValue: 'Supprimer la réunion' })}
                >
                  <Trash2 size={16} />
                </button>
                <button
                  onClick={e => { e.stopPropagation(); onMenu(m, e) }}
                  className="p-1.5 rounded-full text-text-secondary hover:bg-surface-2"
                  title={t('common_more', { defaultValue: 'Plus d’actions' })}
                >
                  <MoreVertical size={16} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
