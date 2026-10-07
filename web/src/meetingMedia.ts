/**
 * The meeting's own audio and video, handed to another module — or refused.
 *
 * ## Why this file exists at all
 *
 * A meeting's media never touches a server here: it is exchanged directly
 * between the participants' browsers. So there is exactly one way for anything
 * else in this product to get at it, and this is it. That makes the host's
 * "may other apps collect the audio and video" a real switch rather than a
 * statement of intent: the door it governs is this function, and nothing else
 * opens.
 *
 * The check is done HERE, at the door, not by whoever knocks. A permission
 * that the caller verifies is not a permission.
 */
import { useChatStore } from './chatStore'

/** Set by the room while a call is live, cleared when it ends. */
let liveStream: { room: string; stream: MediaStream } | null = null

/** Called by the room. Not exported to other modules — only the getter is. */
export function publishMeetingMedia(room: string, stream: MediaStream | null): void {
  liveStream = stream ? { room, stream } : null
}

/**
 * The live media of `room`, or `null`.
 *
 * `null` for three different reasons, deliberately not distinguished: the
 * meeting is not running, it is not the room you asked for, or the host says
 * no. A caller that could tell "refused" from "absent" would learn whether a
 * meeting is running in a room it has no business knowing about.
 */
export function meetingMediaFor(room: string): MediaStream | null {
  if (!liveStream || liveStream.room !== room) return null
  const settings = useChatStore.getState()
    .conversations.find(c => c.conversation.id === room)?.conversation.meeting_settings
  const moderated = Boolean(settings?.host_management)
  if (moderated && settings?.allow_media_capture === false) return null
  return liveStream.stream
}
