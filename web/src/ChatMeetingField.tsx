/**
 * The video call of a calendar event, when THIS module hosts calls.
 *
 * Calendar ships a plain link field and declares a place where whoever hosts
 * meetings may replace it (`video-meeting-field`). This is that replacement.
 * It follows the documented behaviour of the reference calendar's own
 * conferencing field, without ever naming it:
 *
 * - no call yet: one button creates the room and attaches its link;
 * - a call: a card that names it, shows its link, copies it, and takes it
 *   away with a single ✕ — an event holds one call at a time;
 * - a link that is not ours (pasted from somewhere else): the same card,
 *   without the pretence that we host it.
 *
 * The room is a chat conversation that anyone holding the link may join.
 * Calendar never sees a room, only a link.
 *
 * ## The room exists before the event does
 *
 * A link can only be saved if it already points somewhere, so pressing the
 * button creates a real room while the event is still a draft. Which means the
 * room can easily outlive the intention that made it: the call is taken back
 * off the event, the form is closed without saving, the tab is reloaded.
 *
 * So a room made here is born PROVISIONAL — it belongs to the draft, not to
 * anyone — and exactly one of three things happens to it:
 *
 * - the event is saved: the form confirms it and it becomes an ordinary room;
 * - the call is removed, or the form is closed without saving: it is deleted;
 * - nothing at all is said (a reload, a crash, a lost network): it carries its
 *   own deadline and the server sweeps it away.
 *
 * The third case is why the state lives on the server rather than in a list
 * kept here. A browser that goes away mid-sentence cannot clean up after
 * itself, and a room nobody meant to create must not survive on that.
 *
 * A room that is no longer provisional is never touched: once the event is
 * saved, the link has been shared and a room is cheap where a broken call link
 * is not.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Check, X, Settings } from 'lucide-react'
import { Button, Input } from '@ui'
import { chatApi, dropProvisionalOnUnload, type Conversation, type MeetingSettings } from './api'
import ChatLogo from './ChatLogo'
import MeetingSettingsDialog, { DEFAULT_MEETING_SETTINGS } from './MeetingSettingsDialog'

const OWN_LINK_RE = /^\/chat\/meet\/[\w-]+$/

/** How often a draft room is told its form is still open. Well inside the
 *  deadline the server gives it, so a missed beat is not fatal. */
const KEEPALIVE_MS = 5 * 60_000

/** What the host form is handed once this field has created something that
 *  only exists for it. Mirrors calendar's `VideoMeetingDraft`. */
interface DraftHandle {
  commit: () => Promise<void>
  discard: () => void
}

/** The props calendar hands to whoever takes `video-meeting-field`. Copied,
 *  not imported: a module never imports another module's source. */
interface Props {
  /** Calendar draws the row's icon and its field separately; absent = field. */
  part?: 'field' | 'icon'
  url: string
  title: string
  disabled?: boolean
  onChange: (url: string) => void
  /** Told when this field is holding something that belongs to the unsaved
   *  form, and told `null` when it no longer is. */
  onDraft?: (draft: DraftHandle | null) => void
}

export default function ChatMeetingField({ part, url, title, disabled, onChange, onDraft }: Props) {
  const { t } = useTranslation('chat')
  const [creating, setCreating] = useState(false)
  const [pasting,  setPasting]  = useState(false)
  const [copied,   setCopied]   = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // The room as the server holds it, for the ⚙: its current settings, and
  // whether this person is its host. Only fetched for a room of OURS.
  const [room, setRoom] = useState<Conversation | null>(null)
  // The room THIS field created for a form that has not been saved yet — the
  // only room it is ever allowed to destroy.
  const [draftRoom, setDraftRoom] = useState<string | null>(null)

  const link = url.trim()
  const ours = OWN_LINK_RE.test(link)
  const roomId = ours ? link.split('/').pop() ?? '' : ''
  const isField = part !== 'icon'

  useEffect(() => {
    if (!isField || !roomId) { setRoom(null); return }
    let alive = true
    chatApi.getConversation(roomId)
      .then(r => {
        if (!alive) return
        setRoom(r.conversation)
        // A room that is STILL a draft belongs to the form showing it, whoever
        // created it. That is what carries the lifecycle across a handover —
        // the quick card makes the room, the full editor inherits the link, and
        // without this the second form would not know it is holding a draft and
        // nobody would take it back.
        if (r.conversation.provisional_until) setDraftRoom(r.conversation.id)
      })
      .catch(() => { if (alive) setRoom(null) })
    return () => { alive = false }
  }, [isField, roomId])

  // The form is still open, so the room's deadline moves. Without this a long
  // afternoon spent on one event would end with its room already swept away.
  useEffect(() => {
    if (!draftRoom) return
    const h = setInterval(() => { chatApi.keepProvisional(draftRoom).catch(() => { /* one missed beat is not the deadline */ }) }, KEEPALIVE_MS)
    return () => clearInterval(h)
  }, [draftRoom])

  // The page is going away with the draft unsaved. `pagehide` rather than
  // `beforeunload`: it is the one that also fires when a tab is put away on
  // mobile, and it asks nothing of the person leaving.
  useEffect(() => {
    if (!draftRoom) return
    const h = () => dropProvisionalOnUnload(draftRoom)
    window.addEventListener('pagehide', h)
    return () => window.removeEventListener('pagehide', h)
  }, [draftRoom])

  /** Take back the draft room, if the link being dropped is that room. */
  const dropDraft = useCallback((id: string | null) => {
    if (!id) return
    chatApi.dropProvisional(id).catch(() => { /* the deadline is the backstop */ })
    setDraftRoom(null)
  }, [])

  // Hand the form what it needs to end the draft either way. Kept in a ref so
  // the handle is rebuilt when the room changes and not when the form happens
  // to re-render.
  const onDraftRef = useRef(onDraft)
  onDraftRef.current = onDraft
  useEffect(() => {
    const tell = onDraftRef.current
    if (!tell) return
    if (!draftRoom) { tell(null); return }
    const id = draftRoom
    tell({
      // Confirmed BEFORE the event is written, and retried once: the one thing
      // that must not happen is a saved event pointing at a room that is still
      // counting down. A failure is not raised — losing the event because its
      // room could not be confirmed would be the worse of the two outcomes.
      commit: async () => {
        for (let attempt = 0; attempt < 2; attempt++) {
          try { await chatApi.confirmProvisional(id); break }
          catch { if (attempt === 1) console.error('confirmProvisional', id) }
        }
        setDraftRoom(null)
      },
      discard: () => { chatApi.dropProvisional(id).catch(() => { /* idem */ }); setDraftRoom(null) },
    })
  }, [draftRoom])

  // The row's mark, and ONLY that one: this module's own logo, not a generic
  // camera — the field beside it names the host, and the gutter must not
  // contradict it. The card carries no glyph of its own: it says who hosts the call
  // in words, and a logo repeated an inch away is decoration, not information.
  // After every hook, so both parts call the same ones in the same order.
  if (part === 'icon') return <ChatLogo size={18} />

  // What is shown and what is copied: a link into this instance is only a
  // path in the event, and a path is not something a guest can paste in a
  // browser — the full address is.
  const absolute = ours ? `${window.location.origin}${link}` : link
  const host = (() => { try { return new URL(absolute).host } catch { return absolute } })()

  const create = async () => {
    setCreating(true); setError(null)
    try {
      // Provisional: the event does not exist yet, so neither does the reason
      // for this room to. It earns its place when the event is saved.
      const conv = await chatApi.createMeeting(title.trim() || t('meeting_default_name', { defaultValue: 'Réunion' }), [], true)
      setDraftRoom(conv.id)
      onChange(`/chat/meet/${conv.id}`)
    } catch {
      setError(t('meeting_create_failed', { defaultValue: 'La salle n’a pas pu être créée — réessayez.' }))
    } finally { setCreating(false) }
  }

  const copy = async () => {
    try { await navigator.clipboard.writeText(absolute); setCopied(true); setTimeout(() => setCopied(false), 1800) }
    catch { /* the clipboard may be refused; the link is still on screen */ }
  }

  // ── No call yet ─────────────────────────────────────────────────────────
  if (!link) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          {/* The label alone: the row's gutter already carries this module's
              mark, and a glyph repeating it on the button beside it is
              decoration. */}
          <Button type="button" variant="secondary" disabled={disabled || creating} loading={creating} onClick={create}>
            {t('meeting_add', { defaultValue: 'Ajouter une visioconférence Kubuno' })}
          </Button>
          {/* A call held elsewhere is still a call: the plain link field is
              one click away rather than gone. */}
          {!pasting && (
            <button type="button" disabled={disabled} onClick={() => setPasting(true)}
              className="text-sm text-text-secondary hover:text-text-primary hover:underline">
              {t('meeting_paste_link', { defaultValue: 'ou coller un lien' })}
            </button>
          )}
        </div>
        {pasting && (
          <Input type="url" inputMode="url" autoComplete="off" spellCheck={false} autoFocus
            placeholder={t('meeting_link_placeholder', { defaultValue: 'https://…' })}
            value={url} onChange={e => onChange(e.target.value)}
            onBlur={() => { if (!url.trim()) setPasting(false) }}
            className="w-full" />
        )}
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    )
  }

  // ── A call ──────────────────────────────────────────────────────────────
  return (
    /* No glyph of its own at the head of the card: the row's gutter already
       carries this module's mark, and the line below says in words who hosts
       the call. A camera repeated an inch away is decoration, not information —
       the same reason the button has none. */
    <div className="flex items-start gap-3 rounded-md px-3 py-2" style={{ background: 'var(--kb-field-bg, var(--color-surface-1))' }}>
      <div className="min-w-0 flex-1">
        {/* A new tab, for a room of ours as much as for anyone else's: this
            link sits inside a form that is being filled in, and following it in
            place would throw that form away to join a call. The meeting also
            outlives the visit to the event — leaving it open in its own tab is
            what you want. */}
        <a href={absolute} target="_blank" rel="noopener noreferrer"
          className="block truncate text-sm font-medium text-primary hover:underline">
          {ours
            ? t('meeting_join_with', { defaultValue: 'Participer avec Kubuno Réunions' })
            : t('meeting_join_external', { host, defaultValue: 'Participer via {{host}}' })}
        </a>
        <div className="truncate text-xs text-text-secondary">
          {absolute.replace(/^https?:\/\//, '')}
          {ours && <> · {t('meeting_open_join', { defaultValue: 'Ouverte à toute personne disposant du lien' })}</>}
        </div>
      </div>
      <span className="flex shrink-0 items-center gap-0.5">
        {/* The host's settings for this room. Absent for a link we do not
            host, and for anyone who is not its host — there is nothing for
            them to change. */}
        {ours && room && (
          <button type="button" onClick={() => setSettingsOpen(true)} disabled={disabled}
            title={t('meeting_settings_open', { defaultValue: 'Options d’appel vidéo' })}
            className="grid h-8 w-8 place-items-center rounded-full text-text-secondary hover:bg-surface-2 hover:text-text-primary">
            <Settings size={16} />
          </button>
        )}
        {settingsOpen && room && (
          <MeetingSettingsDialog
            conversationId={room.id}
            roomCode={room.id.slice(0, 8)}
            /* Merged, not defaulted: a room that has never been configured
               comes back as `{}`, and reading that as "everything off" would
               show a wide-open meeting as fully locked down. Absent means the
               permissive default, exactly as the server reads it. */
            initial={{ ...DEFAULT_MEETING_SETTINGS, ...(room.meeting_settings ?? {}) }}
            onClose={() => setSettingsOpen(false)}
            onSaved={(ms: MeetingSettings) => setRoom(r => (r ? { ...r, meeting_settings: ms } : r))}
          />
        )}
        <button type="button" onClick={copy} disabled={disabled}
          title={t('meeting_copy_link', { defaultValue: 'Copier le lien' })}
          className="grid h-8 w-8 place-items-center rounded-full text-text-secondary hover:bg-surface-2 hover:text-text-primary">
          {copied ? <Check size={16} className="text-success" /> : <Copy size={16} />}
        </button>
        {/* Taking the call off the event. A room made for THIS unsaved form
            goes with it — it was never anybody's. A room the event already
            carried stays: its link has been shared, and breaking it is not
            what "remove from this event" asks for. */}
        <button type="button" onClick={() => { const id = draftRoom; onChange(''); if (id && id === roomId) dropDraft(id) }} disabled={disabled}
          title={t('meeting_remove', { defaultValue: 'Retirer la visioconférence' })}
          className="grid h-8 w-8 place-items-center rounded-full text-text-secondary hover:bg-surface-2 hover:text-text-primary">
          <X size={16} />
        </button>
      </span>
    </div>
  )
}
