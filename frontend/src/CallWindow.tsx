// Façade for the meeting/call feature. The window itself, the tiles, the
// panels and the shared helpers live in their own files; this module keeps
// the call manager (the app-level orchestrator) and the public entry points
// the rest of chat imports — so those imports never had to change.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Video, X } from 'lucide-react'
import { useChatStore, CallParticipant } from './chatStore'
import MeetingLobby from './MeetingLobby'
import MeetingLeftView from './MeetingLeftView'
import { IncomingCallOverlay } from './IncomingCallOverlay'
import { ActiveCallWindow } from './ActiveCallWindow'


// ── Root call manager ─────────────────────────────────────────────────────────
/** The meeting this tab was in, remembered across a reload (F5) but not across
 *  closing the tab — which is exactly the lifetime a "come back" offer wants. */
const MEETING_KEY = 'kubuno.chat.meeting'
type RememberedMeeting = { room: string; title: string }

function rememberMeeting(m: RememberedMeeting | null) {
  try {
    if (m) sessionStorage.setItem(MEETING_KEY, JSON.stringify(m))
    else sessionStorage.removeItem(MEETING_KEY)
  } catch { /* private mode: the offer is simply not made */ }
}
function recallMeeting(): RememberedMeeting | null {
  try {
    const raw = sessionStorage.getItem(MEETING_KEY)
    const m = raw ? JSON.parse(raw) as RememberedMeeting : null
    return m && typeof m.room === 'string' ? m : null
  } catch { return null }
}

export default function CallManager() {
  const incomingCall = useChatStore(s => s.incomingCall)
  const activeCall   = useChatStore(s => s.activeCall)
  const meetingLobby = useChatStore(s => s.meetingLobby)
  const setMeetingLobby = useChatStore(s => s.setMeetingLobby)
  const startCall = useInitiateCall()
  const { setIncomingCall, setActiveCall, sendCallSignal } = useChatStore()
  const { t } = useTranslation('chat')
  // A meeting left behind by a reload: offered, never rejoined silently — the
  // camera and microphone only start when the person says so, in the lobby.
  const [resume, setResume] = useState<RememberedMeeting | null>(() => recallMeeting())
  // The meeting one has just left: the page that follows offers a way back in.
  const [left, setLeft] = useState<{ room: string; title: string; reason: 'left' | 'ended' | 'removed' } | null>(null)

  function acceptCall() {
    if (!incomingCall) return
    // A meeting is always entered through its lobby, however one got there.
    if (incomingCall.meeting) {
      setMeetingLobby({ room: incomingCall.room, title: incomingCall.meetingTitle ?? '' })
      setIncomingCall(null)
      return
    }
    setActiveCall({
      room:        incomingCall.room,
      title:       incomingCall.fromName,
      type:        incomingCall.type,
      isInitiator: false,
      ring:        [],
    })
    setIncomingCall(null)
  }
  // Declining tells the caller, so their window closes instead of ringing
  // on: to them it is the callee leaving the call.
  function rejectCall() {
    if (incomingCall) sendCallSignal(incomingCall.fromUserId, { type: 'call_leave', room: incomingCall.room })
    setIncomingCall(null)
  }

  return (
    <>
      {incomingCall && !activeCall && (
        <IncomingCallOverlay call={incomingCall} onAccept={acceptCall} onReject={rejectCall} />
      )}
      {/* The lobby (camera/mic check) always precedes joining a meeting. */}
      {meetingLobby && !activeCall && (
        <MeetingLobby
          title={meetingLobby.title}
          onJoin={(muted, camOff) => {
            const l = meetingLobby
            setMeetingLobby(null)
            // Remember it under the room's real name when the list holds it:
            // a meeting opened straight from its link starts before that.
            const named = useChatStore.getState().conversations.find(c => c.conversation.id === l.room)
            rememberMeeting({ room: l.room, title: named?.conversation.name || l.title })
            setResume(null)
            startCall(l.room, l.title, 'video', [], { muted, camOff })
          }}
          onCancel={() => setMeetingLobby(null)}
        />
      )}
      {activeCall && (
        <ActiveCallWindow
          call={activeCall}
          onEnd={reason => {
            // Leaving a meeting leads to a page of its own; a plain call just
            // closes its window.
            const conv = useChatStore.getState().conversations.find(c => c.conversation.id === activeCall.room)
            if (conv?.conversation.is_meeting) {
              setLeft({ room: activeCall.room, title: conv.conversation.name || activeCall.title, reason: reason ?? 'left' })
            }
            rememberMeeting(null); setResume(null); setActiveCall(null)
          }}
        />
      )}

      {/* Left the meeting: back in, back home, and how the call went. */}
      {left && !activeCall && !meetingLobby && (
        <MeetingLeftView
          room={left.room}
          title={left.title}
          reason={left.reason}
          onRejoin={() => { setMeetingLobby({ room: left.room, title: left.title }); setLeft(null) }}
          onHome={() => { setLeft(null); useChatStore.getState().setHomeView('meetings') }}
        />
      )}

      {/* After a reload: one click back into the meeting, through the lobby. */}
      {resume && !activeCall && !meetingLobby && (
        <div className="fixed bottom-5 left-5 z-[9989] flex items-center gap-3 rounded-full bg-[#2a2b2e] text-gray-100 pl-4 pr-2 py-2 shadow-2xl">
          <Video size={16} className="text-primary" />
          <span className="text-sm truncate max-w-[220px]">
            {t('chat_call_resume', { title: resume.title || t('chat_meeting_default_name') })}
          </span>
          <button
            onClick={() => setMeetingLobby({ room: resume.room, title: resume.title })}
            className="rounded-full bg-primary text-white text-sm px-3 py-1.5 hover:opacity-90"
          >
            {t('chat_call_resume_action')}
          </button>
          <button
            onClick={() => { rememberMeeting(null); setResume(null) }}
            className="p-1.5 rounded-full text-gray-400 hover:bg-white/10"
            title={t('common_cancel')}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </>
  )
}


// ── Hook for initiating calls ─────────────────────────────────────────────────
export function useInitiateCall() {
  const setActiveCall = useChatStore(s => s.setActiveCall)
  return function startCall(
    room: string, title: string, type: 'audio' | 'video', ring: CallParticipant[],
    opts?: { muted?: boolean; camOff?: boolean },
  ) {
    setActiveCall({ room, title, type, isInitiator: true, ring, initialMuted: opts?.muted, initialCamOff: opts?.camOff })
  }
}
