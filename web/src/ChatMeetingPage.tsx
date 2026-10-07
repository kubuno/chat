import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarClock } from 'lucide-react'
import ChatPage from './ChatPage'
import { chatApi, isMeetingEnded, isKnockRequired } from './api'
import MeetingKnockView from './MeetingKnockView'
import { useChatStore } from './chatStore'

// Deep-link target for a scheduled meeting (/chat/meet/:id). Joins the meeting
// room (open join), opens it, and starts/joins the video call automatically.
/** Thrown to leave the join chain without it being read as a failure. */
class Knocked extends Error {}

export default function ChatMeetingPage() {
  const { t } = useTranslation('chat')
  const [over, setOver] = useState(false)
  // A restricted meeting refuses the link and says so with its own code: the
  // reader is offered to ask rather than shown a dead end.
  const [knockRoom, setKnockRoom] = useState<string | null>(null)
  // Kept so being admitted walks the very same path the link walked.
  const enterRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const id = decodeURIComponent(location.pathname.split('/chat/meet/')[1]?.split(/[/?#]/)[0] ?? '')
    if (!id) return
    let cancelled = false
    const enter = () => chatApi.joinMeeting(id)
      .catch(e => {
        // A meeting that has been ended is closed: say so rather than open an
        // empty room. A restricted one sends the reader to ask. Any other
        // refusal is harmless — being a member already is a success.
        if (isMeetingEnded(e)) throw e
        if (isKnockRequired(e)) { if (!cancelled) setKnockRoom(id); throw new Knocked() }
      })
      .then(() => {
        if (cancelled) return
        const st = useChatStore.getState()
        st.fetchConversations()
        st.setActiveConv(id)
        // Name the meeting from the room itself when the list already holds it.
        const summary = st.conversations.find(c => c.conversation.id === id)
        const title = summary?.conversation.name ?? ''
        // The lobby (camera/mic check) always precedes the call — even when the
        // meeting is opened from its shared link.
        if (!cancelled) st.setMeetingLobby({ room: id, title })
      })
      .catch(e => { if (!cancelled && !(e instanceof Knocked)) setOver(true) })
    enterRef.current = enter
    void enter()
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (knockRoom) {
    return (
      <MeetingKnockView
        roomId={knockRoom}
        onAdmitted={() => { setKnockRoom(null); void enterRef.current?.() }}
        onCancel={() => useChatStore.getState().setHomeView('meetings')}
      />
    )
  }

  if (over) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center gap-4 px-6" data-module="chat">
        <div className="w-16 h-16 rounded-full bg-surface-1 flex items-center justify-center">
          <CalendarClock className="w-7 h-7 text-text-tertiary" />
        </div>
        <h1 className="text-2xl text-gray-900">{t('chat_meeting_over_title')}</h1>
        <p className="text-sm text-text-secondary max-w-md">{t('chat_meeting_over')}</p>
        <button
          onClick={() => { setOver(false); useChatStore.getState().setHomeView('meetings') }}
          className="mt-2 rounded-full bg-primary text-white px-6 py-2.5 hover:opacity-90 transition-opacity"
        >
          {t('chat_meetings')}
        </button>
      </div>
    )
  }

  return <ChatPage />
}
