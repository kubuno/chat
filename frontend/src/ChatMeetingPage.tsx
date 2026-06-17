import { useEffect } from 'react'
import ChatPage from './ChatPage'
import { chatApi } from './api'
import { useChatStore } from './chatStore'
import { useInitiateCall } from './CallWindow'

// Deep-link target for a scheduled meeting (/chat/meet/:id). Joins the meeting
// room (open join), opens it, and starts/joins the video call automatically.
export default function ChatMeetingPage() {
  const startCall = useInitiateCall()

  useEffect(() => {
    const id = decodeURIComponent(location.pathname.split('/chat/meet/')[1]?.split(/[/?#]/)[0] ?? '')
    if (!id) return
    let cancelled = false
    chatApi.joinMeeting(id)
      .catch(() => { /* already a member, or not a meeting — try anyway */ })
      .then(() => {
        if (cancelled) return
        useChatStore.getState().fetchConversations()
        useChatStore.getState().setActiveConv(id)
        // Give the WebSocket a moment to connect before announcing into the call.
        setTimeout(() => { if (!cancelled) startCall(id, 'Réunion', 'video', []) }, 1200)
      })
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return <ChatPage />
}
