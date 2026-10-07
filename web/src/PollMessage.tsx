import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { BarChart3, Check } from 'lucide-react'
import { DecodedMessage, chatApi } from './api'

export default function PollMessage({ msg, isOwn }: { msg: DecodedMessage; isOwn: boolean }) {
  const { t } = useTranslation('chat')
  const poll = msg.poll!
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [myVote, setMyVote] = useState<number | null>(null)

  const refresh = useCallback(async () => {
    try {
      const r = await chatApi.getPoll(msg.id)
      setCounts(r.counts ?? {})
      setMyVote(r.my_vote)
    } catch { /* noop */ }
  }, [msg.id])

  useEffect(() => { refresh() }, [refresh])

  // Live updates: another participant voted.
  useEffect(() => {
    const h = (e: Event) => { if ((e as CustomEvent).detail?.messageId === msg.id) refresh() }
    window.addEventListener('chat:poll_update', h)
    return () => window.removeEventListener('chat:poll_update', h)
  }, [msg.id, refresh])

  async function vote(i: number) {
    setMyVote(i) // optimistic
    try {
      const r = await chatApi.votePoll(msg.id, i)
      setCounts(r.counts ?? {})
      setMyVote(r.my_vote)
    } catch { refresh() }
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  const txtCol = isOwn ? 'text-white' : 'text-gray-900'
  const subCol = isOwn ? 'text-blue-100' : 'text-gray-400'

  return (
    <div className="min-w-[220px] max-w-[300px]">
      <div className={`flex items-center gap-1.5 text-xs font-medium mb-2 ${subCol}`}>
        <BarChart3 className="w-3.5 h-3.5" /> {t('chat_poll', { defaultValue: 'Sondage' })}
      </div>
      <div className={`font-medium text-sm mb-2 ${txtCol}`}>{poll.question}</div>
      <div className="flex flex-col gap-1.5">
        {poll.options.map((opt, i) => {
          const n = counts[i.toString()] ?? 0
          const pct = total > 0 ? Math.round((n / total) * 100) : 0
          const mine = myVote === i
          return (
            <button
              key={i}
              onClick={() => vote(i)}
              className={`relative overflow-hidden text-left px-2.5 py-1.5 rounded-lg border text-sm transition-colors ${
                isOwn ? 'border-white/30 hover:bg-white/10' : 'border-gray-200 hover:bg-gray-50'
              } ${mine ? (isOwn ? 'bg-white/15' : 'bg-blue-50 border-blue-300') : ''}`}
            >
              <div className={`absolute inset-y-0 left-0 ${isOwn ? 'bg-white/20' : 'bg-blue-100'}`} style={{ width: `${pct}%` }} />
              <div className="relative flex items-center justify-between gap-2">
                <span className={`flex items-center gap-1 truncate ${txtCol}`}>
                  {mine && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
                  {opt}
                </span>
                <span className={`text-xs flex-shrink-0 ${subCol}`}>{pct}%</span>
              </div>
            </button>
          )
        })}
      </div>
      <div className={`text-[11px] mt-1.5 ${subCol}`}>
        {t('chat_poll_votes', { defaultValue: '{{count}} vote(s)', count: total })}
      </div>
    </div>
  )
}
