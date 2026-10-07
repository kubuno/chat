/**
 * What the host decides about a meeting, before it happens.
 *
 * Reached from the ⚙ on the event's meeting card, and laid out like the
 * reference: a rail on the left naming the sections, the switches on the
 * right under grey section bands, and one Save for the lot.
 *
 * ## Only switches that bite
 *
 * Nothing here is ever greyed out. Greying said "you may not" where the truth
 * was "not yet in force", and the host reading it quite reasonably asked why
 * they were forbidden their own meeting. The settings are always editable; a
 * line under the master switch says when they take effect.
 *
 * Every switch here is enforced somewhere, and where is stated under it:
 *
 * - who may WRITE and whether the host must arrive first are refused by the
 *   SERVER, so a modified client changes nothing;
 * - who may SHARE A SCREEN or SEND A REACTION is enforced by the meeting page,
 *   because the media never touches a server — it is peer-to-peer, and there
 *   is nothing in the path to refuse it. That is a real limit and it is
 *   written on screen rather than glossed over.
 *
 * Access is the third kind: `trusted` is refused by the server, and the people
 * it refuses may ASK — the host sees them waiting inside the meeting and lets
 * them in or not. Activities and media capture are the fourth: each governs a
 * door this module owns — the room's activity menu, and the single function
 * that hands the meeting's media to another module.
 *
 * The reference's other sections — activity add-ons, third-party capture,
 * automatic recording, a language for transcripts — are deliberately absent:
 * this product has no add-ons, no transcripts, and its recording is started by
 * a person in the room after a consent dialog. A switch for any of them would
 * tell a host their meeting is governed when it is not.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ShieldCheck, FileDown } from 'lucide-react'
import { FloatingWindow, Toggle, Radio, Checkbox } from '@ui'
import { chatApi, type MeetingSettings } from './api'
import ChatLogo from './ChatLogo'

export const DEFAULT_MEETING_SETTINGS: MeetingSettings = {
  host_management:    false,
  allow_screen_share: true,
  allow_reactions:    true,
  allow_messages:     true,
  host_joins_first:   false,
  access_type:        'open',
  allow_knocking:     true,
  allow_participant_activities: true,
  allow_media_capture:          true,
  auto_record:                  false,
}

export default function MeetingSettingsDialog({ conversationId, roomCode, initial, hostName, onClose, onSaved }: {
  conversationId: string
  /** Shown under the title, as the reference shows the meeting code. */
  roomCode: string
  initial: MeetingSettings
  hostName?: string
  onClose: () => void
  onSaved?: (s: MeetingSettings) => void
}) {
  const { t } = useTranslation('chat')
  const [s, setS] = useState<MeetingSettings>(initial)
  const [section, setSection] = useState<'controls' | 'recordings'>('controls')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof MeetingSettings) => (v: boolean) => setS(p => ({ ...p, [k]: v }))
  const setAccess = (v: 'open' | 'trusted') => setS(p => ({ ...p, access_type: v }))

  const save = async () => {
    setSaving(true); setError(null)
    try { const saved = await chatApi.updateMeetingSettings(conversationId, s); onSaved?.(saved); onClose() }
    catch { setError(t('meeting_settings_failed', { defaultValue: 'Les réglages n’ont pas pu être enregistrés — réessayez.' })) }
    finally { setSaving(false) }
  }

  /** A grey band naming a group, as the reference separates them. */
  const band = (text: string) => (
    <div className="bg-surface-1 px-5 py-3 text-sm font-medium text-text-primary">{text}</div>
  )
  /** One switch and, under it, what it does and WHERE it is enforced. */
  const sw = (
    key: keyof MeetingSettings,
    label: string,
    description: string,
    opts: { indent?: boolean; disabled?: boolean } = {},
  ) => (
    <div className={`flex items-start gap-4 px-5 py-3 ${opts.indent ? 'ps-12' : ''} ${opts.disabled ? 'opacity-50' : ''}`}>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-text-primary">{label}</div>
        <p className="mt-0.5 text-xs text-text-secondary">{description}</p>
      </div>
      <Toggle checked={Boolean(s[key])} disabled={opts.disabled || saving}
        onChange={e => set(key)(e.target.checked)} />
    </div>
  )

  const moderated = s.host_management

  return (
    <FloatingWindow
      t={t}
      onClose={onClose}
      backdrop
      resizable
      defaultWidth={860}
      /* A definite height so the rail can stay still while the settings
         scroll: without one the window grows to its cap and the whole content
         area becomes the scroller, rail included. */
      defaultHeight={620}
      minWidth={360}
      className="kb-window-form-canvas"
      icon={<ChatLogo size={20} />}
      title={t('meeting_settings_title', { defaultValue: 'Options d’appel vidéo' })}
      actions={{
        confirm: { label: t('save', { defaultValue: 'Enregistrer' }), onClick: save, loading: saving },
        cancel:  { label: t('cancel', { defaultValue: 'Annuler' }) },
        extra: (
          <p className="text-xs text-text-secondary">
            {t('meeting_settings_who', { defaultValue: 'Seul l’organisateur peut modifier ces paramètres.' })}
            {hostName && <><br />{t('meeting_settings_host', { name: hostName, defaultValue: 'Organisateur : {{name}}' })}</>}
          </p>
        ),
      }}
    >
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* The rail. It names where you are, so it must still be there when you
            have scrolled — it does not move; the settings beside it do. */}
        <div className="w-56 shrink-0 overflow-y-auto p-3">
          {([
            ['controls',   <ShieldCheck size={16} key="c" />, t('meeting_settings_host_controls', { defaultValue: 'Commandes de l’organisateur' })],
            ['recordings', <FileDown   size={16} key="r" />, t('meeting_settings_recordings',    { defaultValue: 'Enregistrements de réunions' })],
          ] as const).map(([id, icon, label]) => (
            <button key={id} type="button" onClick={() => setSection(id)}
              className={`mb-1 flex w-full items-center gap-2 rounded-full px-4 py-2 text-start text-sm ${
                section === id ? 'bg-primary/10 text-primary' : 'text-text-secondary hover:bg-surface-1'}`}>
              {icon}
              <span className="min-w-0 flex-1">{label}</span>
            </button>
          ))}
          <p className="px-4 py-3 text-xs text-text-secondary">{roomCode}</p>
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto bg-surface-0">
        {section === 'recordings' ? (
          <div className="space-y-4 px-5 py-4">
            <h3 className="text-sm text-text-primary">
              {t('meeting_rec_title', { defaultValue: 'Capturer automatiquement ce qui se passe' })}
            </h3>
            <p className="text-xs text-text-secondary">
              {t('meeting_rec_intro', { defaultValue: 'Gardez une trace de la réunion. La salle peut lancer l’enregistrement dès qu’une personne autorisée à enregistrer y entre.' })}
            </p>
            {/* The legal warning belongs HERE, where the decision is made. It is
                what lets the room start recording without asking again: the
                acknowledgement has already happened, at scheduling time — the
                same bargain the reference strikes. */}
            <p className="rounded-md bg-warning-light px-3 py-2 text-xs text-text-primary">
              <strong>{t('meeting_rec_important', { defaultValue: 'Important' })} : </strong>
              {t('meeting_rec_consent', { defaultValue: 'Enregistrer une réunion sans l’autorisation de tous les participants peut être illégal. Obtenez leur accord, y compris celui des personnes qui arrivent en retard.' })}
            </p>
            <div className="border-t border-border pt-4">
              <Checkbox checked={s.auto_record} disabled={saving}
                onChange={v => set('auto_record')(v)}
                label={t('meeting_rec_auto', { defaultValue: 'Enregistrer la réunion' })} />
              <p className="ps-7 pt-1 text-xs text-text-secondary">
                {t('meeting_rec_auto_desc', { defaultValue: 'Démarre l’enregistrement dès qu’une personne autorisée à enregistrer rejoint la réunion. Tout le monde en est averti dans la salle. L’enregistrement est déposé dans vos fichiers et publié dans la conversation de la réunion.' })}
              </p>
            </div>
            <p className="text-xs text-text-tertiary">
              {t('meeting_rec_no_transcript', { defaultValue: 'Cette instance ne produit ni transcription ni notes automatiques : il n’y a donc pas de langue à choisir.' })}
            </p>
          </div>
        ) : (
        <>
          {band(t('meeting_settings_moderation', { defaultValue: 'Modération de la réunion' }))}
          {sw('host_management',
            t('meeting_settings_management', { defaultValue: 'Gestion par l’organisateur' }),
            t('meeting_settings_management_desc', { defaultValue: 'Limite ce que les participants peuvent faire. Désactivée, la réunion est ouverte et les réglages ci-dessous ne s’appliquent pas.' }))}
          {!moderated && (
            <p className="px-5 pb-3 text-xs text-text-secondary">
              {t('meeting_settings_inactive_hint', { defaultValue: 'Vous pouvez régler ce qui suit dès maintenant : rien ne s’appliquera tant que la gestion par l’organisateur est désactivée.' })}
            </p>
          )}
          {sw('allow_screen_share',
            t('meeting_settings_share', { defaultValue: 'Partager leur écran' }),
            t('meeting_settings_share_desc', { defaultValue: 'Appliqué par la salle : les flux sont échangés directement entre les participants, aucun serveur ne peut les refuser.' }),
            { indent: true })}
          {sw('allow_reactions',
            t('meeting_settings_reactions', { defaultValue: 'Envoyer des réactions' }),
            t('meeting_settings_reactions_desc', { defaultValue: 'Appliqué par la salle, pour la même raison.' }),
            { indent: true })}

          {band(t('meeting_settings_chat', { defaultValue: 'Modération du chat' }))}
          {sw('allow_messages',
            t('meeting_settings_messages', { defaultValue: 'Autoriser les participants à envoyer des messages' }),
            t('meeting_settings_messages_desc', { defaultValue: 'Refusé par le serveur lorsque c’est désactivé : seul l’organisateur écrit.' }),
          )}

          {band(t('meeting_settings_access', { defaultValue: 'Accès à la réunion' }))}
          {sw('host_joins_first',
            t('meeting_settings_host_first', { defaultValue: 'L’organisateur doit rejoindre la réunion avant tout le monde' }),
            t('meeting_settings_host_first_desc', { defaultValue: 'Refusé par le serveur : tant qu’aucun organisateur n’est présent, le lien n’ouvre pas la salle.' }),
          )}

          {/* What the link is worth. Two answers, and the second carries the
              only question it raises: may a stranger holding it ask? */}
          <div className="px-5 pb-4">
            <div className="py-2 text-sm text-text-primary">
              {t('meeting_settings_access_type', { defaultValue: 'Type d’accès à la réunion' })}
            </div>
            <div className="space-y-3 ps-4">
              <div>
                <Radio checked={s.access_type === 'open'} disabled={saving}
                  onChange={() => setAccess('open')}
                  label={t('meeting_settings_access_open', { defaultValue: 'Ouvrir' })} />
                <p className="ps-7 text-xs text-text-secondary">
                  {t('meeting_settings_access_open_desc', { defaultValue: 'Personne n’a à demander à rejoindre la réunion : le lien suffit.' })}
                </p>
              </div>
              <div>
                <Radio checked={s.access_type === 'trusted'} disabled={saving}
                  onChange={() => setAccess('trusted')}
                  label={t('meeting_settings_access_trusted', { defaultValue: 'Ouvrir aux personnes de confiance' })} />
                <p className="ps-7 text-xs text-text-secondary">
                  {t('meeting_settings_access_trusted_desc', { defaultValue: 'Seules les personnes que vous avez ajoutées à la salle entrent directement. Refusé par le serveur pour les autres.' })}
                </p>
                <div className="ps-7 pt-2">
                  <Checkbox checked={s.allow_knocking} disabled={s.access_type !== 'trusted' || saving}
                    onChange={v => set('allow_knocking')(v)}
                    label={t('meeting_settings_knock', { defaultValue: 'Toute personne disposant du lien peut demander à y participer' })} />
                </div>
              </div>
            </div>
          </div>

          {band(t('meeting_settings_activities', { defaultValue: 'Activités pendant la réunion' }))}
          {sw('allow_participant_activities',
            t('meeting_settings_activities_share', { defaultValue: 'Autoriser les participants à lancer des activités' }),
            t('meeting_settings_activities_share_desc', { defaultValue: 'Désactivé, seules les activités lancées par l’organisateur sont partagées. Appliqué par la salle : une activité s’exécute dans le navigateur qui la lance.' }),
          )}
          {sw('allow_media_capture',
            t('meeting_settings_capture', { defaultValue: 'Autoriser les autres applications à collecter l’audio et la vidéo' }),
            t('meeting_settings_capture_desc', { defaultValue: 'Désactivé, aucune autre application de cette instance n’obtient le son ni l’image de la réunion, même si quelqu’un le lui demande.' }),
          )}

        </>
        )}
          {error && <p className="px-5 py-3 text-xs text-danger">{error}</p>}
        </div>
      </div>
    </FloatingWindow>
  )
}
