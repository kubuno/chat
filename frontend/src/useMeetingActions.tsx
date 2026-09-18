import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useConfirm } from '@kubuno/sdk'
import { useChatStore, getConvName } from './chatStore'
import { chatApi, isMeetingEnded } from './api'

/**
 * Shared meeting actions, used by the "New" button and the Meetings page.
 *
 * A meeting is a group conversation flagged `is_meeting` (open join by link).
 * Starting one enters its room and opens the video call directly — never via
 * the `/chat/meet` deep link, so the call is not cancelled by that page
 * unmounting mid-start.
 */
export function useMeetingActions() {
  const { t } = useTranslation('chat')
  const fetchConvs = useChatStore(s => s.fetchConversations)
  const { confirm, confirmState, handleConfirm, handleCancel } = useConfirm()

  // Opening a meeting always goes through the lobby (camera/mic check); the
  // call itself starts only when the user clicks "Join" there.
  const enterMeeting = useCallback((id: string) => {
    const st = useChatStore.getState()
    st.setActiveConv(id)
    const summary = st.conversations.find(c => c.conversation.id === id)
    const title = summary ? getConvName(summary.conversation, '', summary.other_user) : t('chat_meeting_default_name')
    st.setMeetingLobby({ room: id, title })
  }, [t])

  /** `join` true → start an instant meeting; false → create it and hand back a link. */
  const createMeeting = useCallback(async (join: boolean) => {
    try {
      const conv = await chatApi.createMeeting(t('chat_meeting_default_name'))
      await fetchConvs()
      if (join) { enterMeeting(conv.id); return }
      const link = `${location.origin}/chat/meet/${conv.id}`
      try { await navigator.clipboard.writeText(link) } catch { /* clipboard may be blocked */ }
      const done = await confirm({
        title:        t('chat_meeting_ready_title'),
        message:      `${t('chat_meeting_ready_msg')}\n\n${link}`,
        confirmLabel: t('chat_meeting_done'),
        cancelLabel:  t('chat_meeting_open_now'),
      })
      if (!done) enterMeeting(conv.id)
    } catch (e) { console.error('createMeeting', e) }
  }, [fetchConvs, enterMeeting, confirm, t])

  /** Copy a meeting's join link to the clipboard. */
  const copyMeetingLink = useCallback(async (id: string) => {
    const link = `${location.origin}/chat/meet/${id}`
    try { await navigator.clipboard.writeText(link) } catch { /* clipboard may be blocked */ }
  }, [])

  /** Copy several meetings' join links, one per line. */
  const copyMeetingLinks = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return
    const text = ids.map(id => `${location.origin}/chat/meet/${id}`).join('\n')
    try { await navigator.clipboard.writeText(text) } catch { /* clipboard may be blocked */ }
  }, [])

  /**
   * Remove a meeting from the user's list. Like every other conversation the
   * platform treats "delete" as leaving it — the room drops out of the caller's
   * meetings, and its selection is cleared if it was open in the detail pane.
   */
  const deleteMeeting = useCallback(async (id: string) => {
    const st = useChatStore.getState()
    const summary = st.conversations.find(c => c.conversation.id === id)
    const label = summary
      ? `"${getConvName(summary.conversation, '', summary.other_user)}"`
      : t('chat_this_meeting', { defaultValue: 'cette réunion' })
    const ok = await confirm({
      title:        t('chat_meeting_delete_title', { defaultValue: 'Supprimer la réunion' }),
      message:      t('chat_meeting_delete_message', { label, defaultValue: 'Supprimer {{label}} ? Elle disparaîtra de vos réunions.' }),
      confirmLabel: t('common_delete', { defaultValue: 'Supprimer' }),
      cancelLabel:  t('common_cancel', { defaultValue: 'Annuler' }),
      variant:      'danger',
    })
    if (!ok) return
    try {
      await chatApi.leaveConversation(id)
      if (useChatStore.getState().activeConvId === id) useChatStore.getState().setActiveConv(null)
      await fetchConvs()
    } catch (e) { console.error('deleteMeeting', e) }
  }, [confirm, fetchConvs, t])

  /**
   * Bulk-delete meetings under a single confirmation. A one-item list defers to
   * the named single-meeting confirmation; two or more ask once with a count.
   */
  const deleteMeetings = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return
    if (ids.length === 1) { await deleteMeeting(ids[0]); return }
    const ok = await confirm({
      title:        t('chat_meeting_delete_many_title', { defaultValue: 'Supprimer les réunions' }),
      message:      t('chat_meeting_delete_many_message', { count: ids.length, defaultValue: 'Supprimer {{count}} réunions ? Elles disparaîtront de vos réunions.' }),
      confirmLabel: t('common_delete', { defaultValue: 'Supprimer' }),
      cancelLabel:  t('common_cancel', { defaultValue: 'Annuler' }),
      variant:      'danger',
    })
    if (!ok) return
    try {
      await Promise.all(ids.map(id => chatApi.leaveConversation(id)))
      const active = useChatStore.getState().activeConvId
      if (active && ids.includes(active)) useChatStore.getState().setActiveConv(null)
      await fetchConvs()
    } catch (e) { console.error('deleteMeetings', e) }
  }, [confirm, fetchConvs, t, deleteMeeting])

  /** Join a meeting from a pasted link or a bare room id, then enter its call. */
  const joinByLink = useCallback(async (raw: string) => {
    const id = (raw.match(/chat\/meet\/([0-9a-fA-F-]{36})/)?.[1]
      ?? raw.match(/[0-9a-fA-F-]{36}/)?.[0]
      ?? '').trim()
    if (!id) return
    try {
      await chatApi.joinMeeting(id)
    } catch (e) {
      // A meeting that has been ended is closed: say so instead of walking
      // into an empty room. Any other refusal is harmless — being a member
      // already is a success, so it never lands here.
      if (isMeetingEnded(e)) {
        await confirm({ title: t('chat_meeting_over_title'), message: t('chat_meeting_over'), hideCancel: true })
        return
      }
    }
    try {
      await fetchConvs()
      enterMeeting(id)
    } catch (e) { console.error('joinByLink', e) }
  }, [confirm, fetchConvs, enterMeeting, t])

  return { createMeeting, joinByLink, enterMeeting, deleteMeeting, deleteMeetings, copyMeetingLink, copyMeetingLinks, confirmState, handleConfirm, handleCancel }
}
