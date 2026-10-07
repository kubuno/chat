import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Phone, Video, X } from 'lucide-react'
import { Button, Checkbox } from '@ui'
import { CallParticipant, PreCallState } from './chatStore'

interface Props {
  state:    PreCallState
  onStart:  (participants: CallParticipant[], type: 'audio' | 'video') => void
  onCancel: () => void
}

export default function PreCallModal({ state, onStart, onCancel }: Props) {
  const { t } = useTranslation('chat')
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(state.candidates.map(c => c.userId))
  )
  const [callType, setCallType] = useState<'audio' | 'video'>(state.type)

  function toggle(userId: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  function handleStart() {
    const participants = state.candidates.filter(c => selected.has(c.userId))
    if (participants.length === 0) return
    onStart(participants, callType)
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-text-primary">{t('chat_precall_title')}</h3>
          <button onClick={onCancel} className="p-1.5 rounded-full hover:bg-gray-100 text-gray-500">
            <X size={16} />
          </button>
        </div>

        {/* Call type toggle */}
        <div className="flex gap-2 px-5 py-3 border-b border-gray-100 bg-gray-50">
          <button
            onClick={() => setCallType('audio')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-colors ${
              callType === 'audio'
                ? 'bg-blue-600 text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            <Phone size={15} /> {t('chat_call_type_audio')}
          </button>
          <button
            onClick={() => setCallType('video')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-colors ${
              callType === 'video'
                ? 'bg-blue-600 text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            <Video size={15} /> {t('chat_call_type_video')}
          </button>
        </div>

        {/* Participant list */}
        <div className="px-5 py-3">
          <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-2">
            {t('chat_precall_invite', { selected: selected.size, total: state.candidates.length })}
          </p>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {state.candidates.map(c => {
              const isChecked = selected.has(c.userId)
              return (
                <label
                  key={c.userId}
                  className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-gray-50 cursor-pointer select-none"
                >
                  <Checkbox
                    checked={isChecked}
                    onChange={() => toggle(c.userId)}
                  />
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 text-sm font-semibold flex-shrink-0">
                    {c.name[0]?.toUpperCase()}
                  </div>
                  <span className="text-sm text-text-primary">{c.name}</span>
                </label>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-5 pb-5 pt-2">
          <Button
            onClick={onCancel}
            variant="secondary"
            className="flex-1"
          >
            {t('common_cancel')}
          </Button>
          <Button
            onClick={handleStart}
            disabled={selected.size === 0}
            icon={callType === 'video' ? <Video size={15} /> : <Phone size={15} />}
            className="flex-1"
          >
            {t('chat_precall_call')}
          </Button>
        </div>
      </div>
    </div>
  )
}
