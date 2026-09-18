import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Star } from 'lucide-react'
import { chatApi } from './api'

interface Props {
  /** The meeting that was just left, so it can be rejoined in one click. */
  room:     string
  title:    string
  /** Why the meeting closed — a host ending it is not the same as leaving. */
  reason:   'left' | 'ended' | 'removed'
  onRejoin: () => void
  onHome:   () => void
}

/** How long the page waits before going home on its own. */
const COUNTDOWN = 60

/**
 * The page shown after leaving a meeting: a way straight back in, a way home,
 * and a question about how the call went. It returns home on its own after a
 * minute, so a forgotten tab does not sit here for ever.
 */
export default function MeetingLeftView({ room, title, reason, onRejoin, onHome }: Props) {
  const { t } = useTranslation('chat')
  const [left, setLeft] = useState(COUNTDOWN)
  const [rating, setRating] = useState(0)
  const [hover, setHover] = useState(0)
  const [thanks, setThanks] = useState(false)

  useEffect(() => {
    const id = window.setInterval(() => setLeft(v => v - 1), 1000)
    return () => window.clearInterval(id)
  }, [])
  useEffect(() => { if (left <= 0) onHome() }, [left, onHome])

  async function rate(value: number) {
    setRating(value)
    setThanks(true)
    try { await chatApi.rateCall(room, value) } catch (e) { console.error('rateCall', e) }
  }

  // The ring empties as the countdown runs down.
  const circumference = 2 * Math.PI * 18
  const progress = circumference * (1 - left / COUNTDOWN)

  return (
    <div className="fixed inset-0 z-[9992] bg-surface-0 text-text-primary overflow-y-auto" data-module="chat">
      {/* Going home on its own, and saying so */}
      <div className="flex items-center gap-3 px-6 pt-5">
        <div className="relative w-11 h-11 flex-shrink-0">
          <svg viewBox="0 0 40 40" className="w-11 h-11 -rotate-90">
            <circle cx="20" cy="20" r="18" fill="none" stroke="currentColor" className="text-border" strokeWidth="2" />
            <circle
              cx="20" cy="20" r="18" fill="none" stroke="currentColor" className="text-primary"
              strokeWidth="2" strokeLinecap="round"
              strokeDasharray={circumference} strokeDashoffset={progress}
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-sm tabular-nums text-primary">
            {Math.max(0, left)}
          </span>
        </div>
        <span className="text-sm text-text-secondary">{t('chat_left_returning')}</span>
      </div>

      <div className="max-w-3xl mx-auto px-6 pb-16 pt-10 flex flex-col items-center text-center">
        <h1 className="text-3xl sm:text-4xl">
          {reason === 'ended' ? t('chat_left_title_ended') : reason === 'removed' ? t('chat_left_title_removed') : t('chat_left_title')}
        </h1>
        {title && <p className="mt-2 text-text-secondary">{title}</p>}

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {reason === 'left' && (
            <button
              onClick={onRejoin}
              className="rounded-full border border-border px-6 py-2.5 text-primary hover:bg-primary/5 transition-colors"
            >
              {t('chat_left_rejoin')}
            </button>
          )}
          <button
            onClick={onHome}
            className="rounded-full bg-primary text-white px-6 py-2.5 hover:opacity-90 transition-opacity"
          >
            {t('chat_left_home')}
          </button>
        </div>

        {/* How the call went */}
        <div className="mt-14 w-full max-w-xl rounded-2xl bg-surface-1 px-6 py-7">
          <p className="text-[15px] font-medium">{t('chat_left_quality_question')}</p>
          <div className="mt-5 flex items-start justify-center gap-6 sm:gap-10">
            {[1, 2, 3, 4, 5].map(value => (
              <button
                key={value}
                onClick={() => { void rate(value) }}
                onMouseEnter={() => setHover(value)}
                onMouseLeave={() => setHover(0)}
                aria-label={String(value)}
                aria-pressed={rating === value}
                className="flex flex-col items-center gap-2 group"
              >
                <Star
                  size={34}
                  className={`transition-colors ${(hover || rating) >= value ? 'text-primary fill-primary' : 'text-text-tertiary group-hover:text-primary'}`}
                />
                <span className="text-xs text-text-secondary h-4">
                  {value === 1 ? t('chat_left_quality_worst') : value === 5 ? t('chat_left_quality_best') : ''}
                </span>
              </button>
            ))}
          </div>
          {thanks && <p className="mt-4 text-sm text-text-secondary">{t('chat_left_quality_thanks')}</p>}
        </div>
      </div>
    </div>
  )
}
