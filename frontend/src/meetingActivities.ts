/**
 * Activities a meeting can run — a file put in front of everyone, a board, a
 * poll — contributed by whichever modules the instance happens to have.
 *
 * ## Why a registry and not a list
 *
 * A meeting is the wrong place to know what a spreadsheet is. This module owns
 * the room and the moment; another module owns the thing being shared. So the
 * room offers a hole and anyone may fill it, exactly as calendar offers a hole
 * for the video call itself. Nothing here names a module.
 *
 * An activity is LAUNCHED by one person and SHARED with the room: that is what
 * separates it from something you do alone in a tab, and it is why a host may
 * want to decide who gets to launch one (`allow_participant_activities`).
 *
 * ## Discovery goes the other way too
 *
 * Chat registers one activity of its own — putting a file in front of the
 * room — and it only appears when a module that can pick a file is installed.
 * It asks the service registry, never an import: modules do not import each
 * other, and an instance without that module simply has one activity fewer.
 */
import type { ReactNode } from 'react'

export interface MeetingActivity {
  id: string
  /** Shown in the room's menu. Already translated by whoever registers it. */
  label: string
  icon?: ReactNode
  /**
   * Run it. `room` is the meeting's conversation id, so the activity can put
   * what it produces where everyone will see it. Resolve with a short line to
   * announce ("Marie a partagé Budget.xlsx"), or nothing to stay silent.
   */
  run: (room: string) => Promise<string | void>
}

const activities = new Map<string, MeetingActivity>()

/** Offer an activity to every meeting. Idempotent: registering twice replaces. */
export function registerMeetingActivity(a: MeetingActivity): void {
  activities.set(a.id, a)
}

export function listMeetingActivities(): MeetingActivity[] {
  return [...activities.values()]
}

/**
 * The one activity this module contributes: put a file in front of the room.
 *
 * It exists only when a module that can pick a file is installed — asked of
 * the service registry, never imported. On an instance without one there is
 * simply one activity fewer, and if nothing registers anything the room shows
 * no activities menu at all rather than an empty one.
 */
export function registerBuiltinActivities(
  t: (key: string, opts?: Record<string, unknown>) => string,
  services: { get: <T>(module: string, name: string) => T | undefined },
  post: (room: string, text: string) => Promise<void>,
): void {
  const picker = services.get<(opts?: object) => Promise<{ id: string; name?: string } | null>>('drive', 'openFilePicker')
  if (!picker) return

  registerMeetingActivity({
    id: 'share-file',
    label: t('activity_share_file', { defaultValue: 'Partager un fichier' }),
    run: async room => {
      const file = await picker()
      if (!file) return
      const name = file.name ?? t('activity_a_file', { defaultValue: 'un fichier' })
      // Put it where the room will see it: the meeting's own conversation.
      await post(room, `${name} — ${window.location.origin}/drive?file=${encodeURIComponent(file.id)}`)
      return name
    },
  })
}
