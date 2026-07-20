/**
 * Presence picker injected into the host's top bar (slot `topbar-actions`):
 * Active / Do not disturb / Away, plus a free-text status.
 *
 * The status is pushed to the module (PATCH /chat/presence), which broadcasts it
 * over the WebSocket to everyone holding a direct conversation with the user.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Pencil, X } from 'lucide-react'
import { MenuDropdown, useMenuDropdown, type MenuItem, Input, Button } from '@ui'
import { useAuthStore } from '@kubuno/sdk'
import { useChatStore, type PresenceStatus } from './chatStore'
import { chatApi } from './api'

const DOT: Record<PresenceStatus, string> = {
  online:  'bg-green-500',
  dnd:     'bg-red-500',
  away:    'bg-amber-400',
  offline: 'bg-gray-300',
}

export default function ChatStatusMenu() {
  const { t } = useTranslation('chat')
  const user = useAuthStore(s => s.user)
  const myStatus = useChatStore(s => s.myStatus)
  const myCustomStatus = useChatStore(s => s.myCustomStatus)
  const setMyStatus = useChatStore(s => s.setMyStatus)
  const menu = useMenuDropdown()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  // Load the status the server already knows about (survives a reload).
  useEffect(() => {
    if (!user?.id) return
    let alive = true
    chatApi.getPresence(user.id)
      .then(p => {
        if (!alive || !p) return
        // `manual_status` wins: the presence row may still read 'offline' when the
        // WebSocket hasn't reconnected yet, which would silently drop a chosen DND.
        const manual = p.manual_status as PresenceStatus | null | undefined
        const status = manual ?? ((p.status as PresenceStatus) ?? 'online')
        useChatStore.setState({
          myStatus: status === 'offline' ? 'online' : status,
          myCustomStatus: p.custom_status ?? null,
        })
      })
      .catch(() => { /* presence is best-effort */ })
    return () => { alive = false }
  }, [user?.id])

  if (!user) return null

  const label: Record<PresenceStatus, string> = {
    online:  t('chat_status_active',  { defaultValue: 'Actif' }),
    dnd:     t('chat_status_dnd',     { defaultValue: 'Ne pas déranger' }),
    away:    t('chat_status_away',    { defaultValue: 'Absent' }),
    offline: t('chat_status_offline', { defaultValue: 'Hors ligne' }),
  }

  const items = (): MenuItem[] => [
    {
      type: 'action',
      icon: <span className={`w-2.5 h-2.5 rounded-full ${DOT.online}`} />,
      label: label.online,
      checked: myStatus === 'online',
      onClick: () => setMyStatus('online', myCustomStatus),
    },
    {
      type: 'action',
      icon: <span className={`w-2.5 h-2.5 rounded-full ${DOT.dnd}`} />,
      label: label.dnd,
      checked: myStatus === 'dnd',
      onClick: () => setMyStatus('dnd', myCustomStatus),
    },
    {
      type: 'action',
      icon: <span className={`w-2.5 h-2.5 rounded-full ${DOT.away}`} />,
      label: label.away,
      checked: myStatus === 'away',
      onClick: () => setMyStatus('away', myCustomStatus),
    },
    { type: 'separator' },
    {
      type: 'action',
      icon: <Pencil className="w-4 h-4" />,
      label: myCustomStatus
        ? t('chat_status_edit', { defaultValue: 'Modifier l’état' })
        : t('chat_status_add', { defaultValue: 'Ajouter un état' }),
      onClick: () => { setDraft(myCustomStatus ?? ''); setEditing(true) },
    },
    ...(myCustomStatus ? [{
      type: 'action' as const,
      icon: <X className="w-4 h-4" />,
      label: t('chat_status_clear', { defaultValue: 'Effacer l’état' }),
      onClick: () => setMyStatus(myStatus, null),
    }] : []),
  ]

  return (
    <>
      <button
        onClick={e => menu.open(e)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full hover:bg-black/5 transition-colors"
        title={myCustomStatus ?? label[myStatus]}
        aria-haspopup="menu"
      >
        <span className={`w-2.5 h-2.5 rounded-full ${DOT[myStatus]}`} />
        {/* No responsive variant here: `md:` utilities emitted by a module land
            in the kubuno-module cascade layer and lose against the host shell. */}
        <span className="text-sm text-text-primary max-w-[140px] truncate">
          {myCustomStatus ?? label[myStatus]}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-text-tertiary" />
      </button>

      {menu.pos && <MenuDropdown pos={menu.pos} onClose={menu.close} items={items()} />}

      {editing && (
        <div className="fixed inset-0 z-[2147483100] bg-black/40 flex items-center justify-center p-4" onClick={() => setEditing(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-[340px] max-w-full p-4 flex flex-col gap-3" onClick={e => e.stopPropagation()}>
            <h2 className="text-sm font-semibold text-gray-900">{t('chat_status_add', { defaultValue: 'Ajouter un état' })}</h2>
            <Input
              autoFocus
              type="text"
              maxLength={100}
              placeholder={t('chat_status_placeholder', { defaultValue: 'En réunion, en congés…' })}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { setMyStatus(myStatus, draft.trim() || null); setEditing(false) }
              }}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(false)}>{t('common_cancel')}</Button>
              <Button onClick={() => { setMyStatus(myStatus, draft.trim() || null); setEditing(false) }}>
                {t('common_save', { defaultValue: 'Enregistrer' })}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
