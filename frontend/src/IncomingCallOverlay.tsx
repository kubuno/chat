import { useTranslation } from 'react-i18next'
import { Phone, PhoneOff } from 'lucide-react'
import { IncomingCall } from './chatStore'


// ── Incoming call overlay ─────────────────────────────────────────────────────
export function IncomingCallOverlay({ call, onAccept, onReject }: {
  call: IncomingCall
  onAccept: () => void
  onReject: () => void
}) {
  const { t } = useTranslation('chat')
  return (
    <div className="fixed inset-0 z-[2147483200] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl p-8 flex flex-col items-center gap-6 min-w-[280px]">
        <div className="w-20 h-20 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 text-3xl font-bold animate-pulse">
          {call.fromName[0]?.toUpperCase()}
        </div>
        <div className="text-center">
          <p className="font-semibold text-text-primary text-lg">{call.fromName}</p>
          <p className="text-text-secondary text-sm">
            {call.meeting
              ? t('chat_incoming_meeting', { title: call.meetingTitle || t('chat_meeting_default_name') })
              : call.type === 'video' ? t('chat_incoming_video_call') : t('chat_incoming_audio_call')}
          </p>
        </div>
        <div className="flex gap-6">
          <button onClick={onReject} className="w-14 h-14 rounded-full bg-danger flex items-center justify-center hover:bg-red-700 transition-colors" title={t('chat_call_reject')}>
            <PhoneOff size={24} className="text-white" />
          </button>
          <button onClick={onAccept} className="w-14 h-14 rounded-full bg-green-500 flex items-center justify-center hover:bg-green-600 transition-colors" title={t('chat_call_accept')}>
            <Phone size={24} className="text-white" />
          </button>
        </div>
      </div>
    </div>
  )
}
