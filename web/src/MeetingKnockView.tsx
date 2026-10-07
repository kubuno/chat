/**
 * "Let me in" — the page someone sees when a meeting's link is not enough.
 *
 * A restricted meeting refuses the link and says so with its own code, which
 * is what brings the reader here rather than to a flat "access denied". They
 * ask once; the request is idempotent, so a reload or an impatient second
 * press does not put them in the host's list twice.
 *
 * Then they wait. The answer arrives by polling their own request — a socket
 * would be nicer, but this page exists for at most a minute or two and a poll
 * every three seconds costs one tiny query; a channel opened for that would be
 * more machinery than the moment deserves.
 *
 * Refused twice, they may not ask again: a host who has said no twice has said
 * no, and a door that can be knocked on forever is a way to keep knocking until
 * someone gives in. From there only the host adding them opens it, which is the
 * deliberate act the rule is asking for.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DoorOpen, Loader2 } from 'lucide-react'
import { Button } from '@ui'
import { chatApi } from './api'

type Phase = 'idle' | 'asking' | 'waiting' | 'denied' | 'failed' | 'exhausted'

export default function MeetingKnockView({ roomId, title, onAdmitted, onCancel }: {
  roomId: string
  title?: string
  /** The host said yes: the caller joins as it would have from the link. */
  onAdmitted: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation('chat')
  const [phase, setPhase] = useState<Phase>('idle')
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  // Perhaps they were already admitted a moment ago and simply came back.
  useEffect(() => {
    let alive = true
    chatApi.myKnock(roomId)
      .then(r => {
        if (!alive) return
        if (r.status === 'admitted') onAdmitted()
        else if (r.exhausted) setPhase('exhausted')
        else if (r.status === 'pending') setPhase('waiting')
        else if (r.status === 'denied') setPhase('denied')
      })
      .catch(() => { /* never asked: the button below is the way */ })
    return () => { alive = false }
  }, [roomId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase !== 'waiting') return
    timer.current = setInterval(() => {
      chatApi.myKnock(roomId)
        .then(r => {
          if (r.status === 'admitted') { setPhase('idle'); onAdmitted() }
          else if (r.exhausted) setPhase('exhausted')
          else if (r.status === 'denied') setPhase('denied')
        })
        .catch(() => { /* a hiccup is not an answer: keep waiting */ })
    }, 3000)
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [phase, roomId]) // eslint-disable-line react-hooks/exhaustive-deps

  /** A refusal of the ASK itself means the two refusals are spent. */
  const stillAllowed = async () => {
    try { return !(await chatApi.myKnock(roomId)).exhausted } catch { return true }
  }

  const ask = async () => {
    setPhase('asking')
    try { const st = await chatApi.knock(roomId); setPhase(st === 'admitted' ? 'idle' : 'waiting'); if (st === 'admitted') onAdmitted() }
    catch { setPhase(await stillAllowed() ? 'failed' : 'exhausted') }
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center" data-module="chat">
      <div className="grid h-16 w-16 place-items-center rounded-full bg-surface-1">
        {phase === 'waiting'
          ? <Loader2 className="h-7 w-7 animate-spin text-text-tertiary" />
          : <DoorOpen className="h-7 w-7 text-text-tertiary" />}
      </div>
      <h1 className="text-2xl text-text-primary">{title || t('knock_title', { defaultValue: 'Réunion restreinte' })}</h1>

      {phase === 'waiting' ? (
        <p className="max-w-md text-sm text-text-secondary">
          {t('knock_waiting', { defaultValue: 'Votre demande a été envoyée. Vous entrerez dès que l’organisateur l’aura acceptée.' })}
        </p>
      ) : phase === 'denied' ? (
        <p className="max-w-md text-sm text-text-secondary">
          {t('knock_denied', { defaultValue: 'L’organisateur n’a pas accepté votre demande.' })}
        </p>
      ) : phase === 'exhausted' ? (
        <p className="max-w-md text-sm text-text-secondary">
          {t('knock_exhausted', { defaultValue: 'Votre demande a été refusée deux fois : vous ne pouvez plus en envoyer. L’organisateur peut encore vous ajouter à la réunion.' })}
        </p>
      ) : phase === 'failed' ? (
        <p className="max-w-md text-sm text-danger">
          {t('knock_failed', { defaultValue: 'La demande n’a pas pu être envoyée — réessayez.' })}
        </p>
      ) : (
        <p className="max-w-md text-sm text-text-secondary">
          {t('knock_intro', { defaultValue: 'Cette réunion n’est ouverte qu’aux personnes que l’organisateur y a ajoutées. Vous pouvez demander à y participer.' })}
        </p>
      )}

      <div className="mt-2 flex items-center gap-2">
        {phase !== 'waiting' && phase !== 'exhausted' && (
          <Button onClick={ask} loading={phase === 'asking'}>
            {phase === 'denied' || phase === 'failed'
              ? t('knock_ask_again', { defaultValue: 'Demander à nouveau' })
              : t('knock_ask', { defaultValue: 'Demander à participer' })}
          </Button>
        )}
        <Button variant="ghost" onClick={onCancel}>{t('cancel', { defaultValue: 'Annuler' })}</Button>
      </div>
    </div>
  )
}
