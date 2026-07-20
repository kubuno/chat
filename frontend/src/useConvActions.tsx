/**
 * Shared conversation actions (archive, mute, pin, mark unread, favorite,
 * clear, delete…) and the MenuDropdown items built from them. Used by the
 * sidebar rows, the home list rows and the conversation header menu, so the
 * three menus can never drift apart.
 */
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Archive, Bell, BellOff, Pin, MailOpen, Star, X, Ban, Eraser, Trash2, List, PictureInPicture2,
  Users, Link as LinkIcon, LogOut,
} from 'lucide-react'
import { useChatStore, getConvName } from './chatStore'
import { useAuthStore, useConfirm } from '@kubuno/sdk'
import { chatApi, type ConversationSummary } from './api'
import type { MenuItem } from '@ui'

export function useConvActions() {
  const { t } = useTranslation('chat')
  const user = useAuthStore(s => s.user)
  const conversations = useChatStore(s => s.conversations)
  const setActiveConv = useChatStore(s => s.setActiveConv)
  const fetchConvs = useChatStore(s => s.fetchConversations)
  const { confirm, confirmState, handleConfirm, handleCancel } = useConfirm()
  const myId = user?.id ?? ''

  const action = useCallback(async (fn: () => Promise<unknown>, refresh = true) => {
    try {
      await fn()
      if (refresh) await fetchConvs()
    } catch (e) {
      console.error(e)
    }
  }, [fetchConvs])

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

  const handleMarkUnread = (convId: string) => {
    // An open conversation is re-read on every render — close it, or the flag
    // we just set would be wiped before the user ever sees it.
    if (useChatStore.getState().activeConvId === convId) setActiveConv(null)
    action(() => chatApi.updateMemberSettings(convId, { mark_unread: true }))
  }

  const handleFavorite = (convId: string) => {
    const s = conversations.find(c => c.conversation.id === convId)
    action(() => chatApi.updateMemberSettings(convId, { favorite: !s?.is_favorite }))
  }

  const handleClose = (convId: string) => {
    if (useChatStore.getState().activeConvId === convId) setActiveConv(null)
  }

  const handleClear = async (convId: string) => {
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
    const summary = conversations.find(c => c.conversation.id === convId)
    const label = summary ? `"${getConvName(summary.conversation, myId, summary.other_user)}"` : t('chat_this_conversation')
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

  const handleLeaveSpace = async (convId: string) => {
    const summary = conversations.find(c => c.conversation.id === convId)
    const label = summary ? `"${getConvName(summary.conversation, myId, summary.other_user)}"` : t('chat_this_conversation')
    const ok = await confirm({
      title:        t('chat_leave_space_title', { defaultValue: 'Quitter l’espace' }),
      message:      t('chat_leave_space_message', { label, defaultValue: 'Quitter {{label}} ? Vous ne recevrez plus ses messages.' }),
      confirmLabel: t('chat_leave_space_confirm', { defaultValue: 'Quitter' }),
      cancelLabel:  t('common_cancel'),
      variant:      'warning',
    })
    if (!ok) return
    try {
      await chatApi.leaveConversation(convId)
      if (useChatStore.getState().activeConvId === convId) setActiveConv(null)
      await fetchConvs()
    } catch (e) { console.error(e) }
  }

  const handleCopyLink = async (convId: string) => {
    const link = `${location.origin}/chat?conv=${convId}`
    try { await navigator.clipboard.writeText(link) } catch (e) { console.error(e) }
  }

  /**
   * `onManageMembers` is only supplied by callers that can show the info panel
   * (the conversation header) — the item is dropped elsewhere.
   */
  function buildItems(summary: ConversationSummary, opts?: { onManageMembers?: () => void }): MenuItem[] {
    const convId = summary.conversation.id
    const isMuted = summary.muted_until ? new Date(summary.muted_until) > new Date() : false
    const isSpace = summary.conversation.conv_type !== 'direct'
    return [
      ...(isSpace ? [
        ...(opts?.onManageMembers ? [{
          type: 'action' as const,
          icon: <Users className="w-4 h-4" />,
          label: t('chat_manage_members', { defaultValue: 'Gérer les membres' }),
          onClick: opts.onManageMembers,
        }] : []),
        {
          type: 'action' as const,
          icon: <LinkIcon className="w-4 h-4" />,
          label: t('chat_copy_space_link', { defaultValue: 'Copier le lien menant à cet espace' }),
          onClick: () => handleCopyLink(convId),
        },
        { type: 'separator' as const },
      ] : []),
      {
        type: 'action',
        icon: <MailOpen className="w-4 h-4" />,
        label: t('chat_mark_unread'),
        onClick: () => handleMarkUnread(convId),
      },
      {
        type: 'action',
        icon: <PictureInPicture2 className="w-4 h-4" />,
        label: t('chat_open_popup', { defaultValue: 'Ouvrir dans une fenêtre pop-up' }),
        onClick: () => useChatStore.getState().openPopup(convId),
      },
      {
        type: 'action',
        icon: <Pin className="w-4 h-4" />,
        label: summary.is_pinned ? t('chat_unpin') : t('chat_pin'),
        onClick: () => handlePin(convId),
        checked: summary.is_pinned,
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
        icon: <Star className="w-4 h-4" />,
        label: summary.is_favorite ? t('chat_remove_favorite') : t('chat_add_favorite'),
        onClick: () => handleFavorite(convId),
        checked: summary.is_favorite,
      },
      {
        type: 'action',
        icon: <Archive className="w-4 h-4" />,
        label: summary.is_archived ? t('chat_unarchive') : t('chat_archive'),
        onClick: () => handleArchive(convId),
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
      ...(isSpace ? [{
        type: 'action' as const,
        icon: <LogOut className="w-4 h-4" />,
        label: t('chat_leave_space', { defaultValue: 'Quitter l’espace' }),
        onClick: () => handleLeaveSpace(convId),
      }] : []),
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
  }

  return { buildItems, confirmState, handleConfirm, handleCancel }
}
