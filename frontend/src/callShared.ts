// Types, constants and small helpers shared across the meeting UI. No JSX,
// no components — just what several call modules need in common.
import { useState, useRef, useCallback, useEffect } from 'react'
import { chatConfigNow } from './chatConfig'

// ICE servers come from the instance settings (STUN/TURN chosen by the
// administrator, typically a self-hosted coturn) — never from a third party.
export function iceServers(): RTCIceServer[] {
  return chatConfigNow().ice_servers ?? []
}


/**
 * A stable tint per participant, derived from their id: the tile of someone
 * with their camera off is a coloured card behind a big round avatar, not a
 * uniform grey block.
 */
export function tileHue(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360
  return h
}


/**
 * Tracks the size of an element, so a layout can be computed from it. The ref
 * is a callback, so the observer follows the element across the mounts and
 * unmounts of the area it watches — a plain ref would keep measuring a node
 * that has been detached, and report zero for ever.
 */
export function useMeasuredBox() {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null)
  const obs = useRef<ResizeObserver | null>(null)
  const ref = useCallback((el: HTMLDivElement | null) => {
    obs.current?.disconnect()
    obs.current = null
    if (!el) return
    // Publish only a real change: an equal-but-new object would render again,
    // and the render would re-run the measurement, for ever.
    const measure = () => setBox(prev => {
      const w = el.clientWidth, h = el.clientHeight
      return prev && prev.w === w && prev.h === h ? prev : { w, h }
    })
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    obs.current = ro
    measure()
  }, [])
  useEffect(() => () => obs.current?.disconnect(), [])
  return { ref, box }
}


export const CALL_REACTIONS = ['👍', '❤️', '😂', '🎉', '👏', '😮']


// Signal envelope relayed peer-to-peer through the chat WebSocket hub. Every
// signal carries the `room` (conversation id) so a client in several rooms can
// disambiguate. SDP/ICE are targeted; ring/join/leave/reactions are broadcast.
export interface CallSignal {
  type: 'call_ring' | 'call_join' | 'call_present' | 'call_offer' | 'call_answer'
      | 'call_ice' | 'call_leave' | 'call_state' | 'call_reaction'
      // Host actions: end the meeting for everyone, mute someone, remove someone.
      | 'call_end' | 'call_mute' | 'call_kick'
      // Someone launched an activity and shared it with the room.
      | 'call_activity'
  room: string
  call_type?: 'audio' | 'video'
  from_name?: string
  sdp?: string
  candidate?: RTCIceCandidateInit
  hand?: boolean
  muted?: boolean
  cam_off?: boolean
  sharing?: boolean   // this participant is presenting their screen
  recording?: boolean // this participant started or stopped recording
  emoji?: string
  /** What was shared, for `call_activity` — already a readable line. */
  activity?: string
}


// A single participant tile (local or remote).
export interface Tile {
  userId:    string
  name:      string
  /** True while this person is speaking. */
  speaking?: boolean
  /** When their share started, on this machine's clock. */
  sharingAt?: number
  /** Profile picture, shown large and centred when the camera is off. */
  avatarUrl?: string | null
  stream:    MediaStream | null
  isLocal:   boolean
  connected: boolean
  hand:      boolean
  muted:     boolean
  camOff:    boolean
  sharing?:  boolean
  screenStream?: MediaStream | null
}
