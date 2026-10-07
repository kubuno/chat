import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { PhoneOff, Video, VideoOff, Mic, MicOff, Square, PictureInPicture2, Monitor, MonitorOff, Hand, Smile, MessageSquare, Send, ChevronUp, MoreVertical, Users, LayoutGrid, Settings, Maximize2, Info, Sparkles, PhoneForwarded, MinusCircle, Disc, CircleStop } from 'lucide-react'
import { useChatStore, ActiveCall, encodeTextMessage } from './chatStore'
import { chatApi, type MeetingKnock } from './api'
import { listMeetingActivities } from './meetingActivities'
import { publishMeetingMedia } from './meetingMedia'
import { chatConfigNow, refreshChatConfig } from './chatConfig'
import { useAuthStore, api, useConfirm } from '@kubuno/sdk'
import { FloatingWindow, MenuDropdown, useMenuDropdown, ConfirmDialog, type MenuItem } from '@ui'
import { meetingLayout, type Slot } from './meetingLayout'
import { startMeetingRecording, canRecordMeeting, type MeetingRecording } from './meetingRecorder'
import { pushMediaToConversation } from './sendMedia'
import { saveToFiles } from './saveToFiles'
import { watchSpeaking } from './activeSpeaker'
import { CALL_REACTIONS, iceServers, useMeasuredBox, type Tile, type CallSignal } from './callShared'
import { VideoTile } from './VideoTile'
import { CtrlButton } from './callControls'
import { PresentationStage } from './PresentationStage'
import { CallChatPanel } from './CallChatPanel'
import { PeoplePanel } from './PeoplePanel'
import { SettingsPanel, EffectsPanel } from './CallSidePanels'

/** Where meeting recordings are filed, created on first use. */
const RECORDING_FOLDER = 'Chat'


// ── Active call window (full mesh) ────────────────────────────────────────────
export function ActiveCallWindow({ call, onEnd }: { call: ActiveCall; onEnd: (reason?: 'ended' | 'removed') => void }) {
  const { t } = useTranslation('chat')
  const sendCallSignal = useChatStore(s => s.sendCallSignal)
  const myId   = useAuthStore(s => s.user?.id) ?? ''
  const myName = useAuthStore(s => s.user?.display_name || s.user?.username) ?? 'Moi'
  const myAvatar = useAuthStore(s => s.user?.avatar_url) ?? null

  const localStreamRef  = useRef<MediaStream | null>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const fsContainerRef  = useRef<HTMLDivElement>(null)
  const membersRef      = useRef<string[]>([])         // other conv members (for broadcast)
  // Profile pictures of the room, by user id — a tile with the camera off
  // shows the person, not just an initial.
  const [avatars, setAvatars] = useState<Record<string, string | null>>({})
  // Whether the call shows video: true from the start for a video call, and
  // becomes true for an audio call as soon as anyone — us or a peer — turns
  // a camera on. It never goes back: the layout stays, only the tiles change.
  const [isVideo, setIsVideo] = useState(call.type === 'video')

  // Mesh peer table. Kept in a ref (mutable), mirrored into `tiles` for render.
  interface Peer {
  pc: RTCPeerConnection; name: string; stream: MediaStream | null; screen: MediaStream | null
  pendingIce: RTCIceCandidateInit[]; hand: boolean; muted: boolean; camOff: boolean; connected: boolean
  sharing: boolean
  /** When this share started, on THIS machine's clock — the latest one takes
   *  the stage, and clocks are never compared across machines. */
  sharingAt: number
}
  const peersRef = useRef<Map<string, Peer>>(new Map())

  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [tiles,       setTiles]       = useState<Tile[]>([])
  const [isMuted,     setIsMuted]     = useState(false)
  const [isCamOff,    setIsCamOff]    = useState(call.type === 'audio')
  const [handUp,      setHandUp]      = useState(false)
  const [duration,    setDuration]    = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isMinimized, setIsMinimized]  = useState(false)
  const [isSharing,   setIsSharing]    = useState(false)
  // When our own share started, on the same clock as the others'.
  const [mySharingAt, setMySharingAt]  = useState(0)
  const [micError,    setMicError]     = useState(false)
  const [showChat,    setShowChat]     = useState(false)
  const [reactions,   setReactions]    = useState<{ id: number; emoji: string; name: string }[]>([])
  const [showPeople,  setShowPeople]   = useState(false)
  // Menus are the platform primitive (@ui MenuDropdown), never a hand-rolled
  // floating div: mic devices, camera devices, and the "more options" menu.
  const micMenu  = useMenuDropdown()
  const camMenu  = useMenuDropdown()
  const moreMenu = useMenuDropdown()
  const leaveMenu = useMenuDropdown()
  // Right-hand panel opened from the "more" menu, like a meeting's side panels.
  const [sidePanel,   setSidePanel]    = useState<'settings' | 'effects' | null>(null)
  const [viewMode,    setViewMode]     = useState<'grid' | 'spotlight'>('grid')
  // Recording. `recordedBy` names whoever is recording — everyone in the
  // meeting sees it, which is the point of the indicator.
  const recorderRef = useRef<MeetingRecording | null>(null)
  const [recordedBy,   setRecordedBy]   = useState<string | null>(null)
  const [recordElapsed, setRecordElapsed] = useState(0)
  const [recordSaving, setRecordSaving] = useState(false)
  const [recordNotice, setRecordNotice] = useState<'started' | 'stopped' | null>(null)
  // Where the finished recording landed: the folder name, or '' when it had to
  // stay in the conversation. Told once, then forgotten.
  const [recordSavedIn, setRecordSavedIn] = useState<string | null>(null)
  // Who currently has the floor, heard from the audio itself.
  const [speaking, setSpeaking] = useState<Set<string>>(() => new Set())
  const { confirm, confirmState, handleConfirm, handleCancel } = useConfirm()
  // Whoever owns or administers the room hosts the meeting: only they can end
  // it for everyone, mute someone else, or remove a participant.
  const [roleIsHost, setRoleIsHost] = useState(false)
  const [hostNotice, setHostNotice] = useState<string | null>(null)
  const [pinnedId,    setPinnedId]     = useState<string | null>(null)
  // A presentation can be dismissed locally ("don't show"), and un-dismissed
  // when a new one starts.
  const [hidePresentation, setHidePresentation] = useState(false)
  // Presentation controls: pinned to the stage or shown as a tile, its audio,
  // and a zoom that can be dragged around once engaged.
  const [presentationPinned, setPresentationPinned] = useState(true)
  const [presentationMuted,  setPresentationMuted]  = useState(false)
  const presentMenu = useMenuDropdown()
  const [devices,     setDevices]      = useState<{ mics: MediaDeviceInfo[]; cams: MediaDeviceInfo[]; speakers: MediaDeviceInfo[] }>({ mics: [], cams: [], speakers: [] })
  const [micId,       setMicId]        = useState('')
  const [camId,       setCamId]        = useState('')
  const [speakerId,   setSpeakerId]    = useState('')

  // A meeting fills the screen like a meeting room; a plain call stays a
  // floating window over the conversation.
  const isMeeting = useChatStore(
    s => s.conversations.find(c => c.conversation.id === call.room)?.conversation.is_meeting ?? false,
  )
  // Whoever opened the room holds the meeting. Read from the conversation, so
  // the host's own actions do not hang on the members request succeeding.
  const createdByMe = useChatStore(
    s => s.conversations.find(c => c.conversation.id === call.room)?.conversation.created_by === myId,
  )
  const isHost = createdByMe || roleIsHost
  // What the host decided BEFORE the meeting (see MeetingSettingsDialog).
  // Screen sharing and reactions are enforced here and nowhere else: the media
  // is exchanged peer to peer, so no server stands in the path to refuse it.
  // A host is never restricted by their own rules.
  const meetingSettings = useChatStore(
    s => s.conversations.find(c => c.conversation.id === call.room)?.conversation.meeting_settings,
  )
  const moderated  = Boolean(meetingSettings?.host_management) && !isHost
  const mayShare   = !moderated || meetingSettings?.allow_screen_share !== false
  const mayReact   = !moderated || meetingSettings?.allow_reactions   !== false

  // People asking to be let into a restricted meeting. Only a host is shown
  // them, and only while the room is restricted — there is nothing to wait for
  // otherwise. Polled: the wait lasts a minute, a channel would be machinery.
  const restricted = Boolean(meetingSettings?.host_management)
    && meetingSettings?.access_type === 'trusted'
    && meetingSettings?.allow_knocking !== false
  const [knocks, setKnocks] = useState<MeetingKnock[]>([])
  const [deciding, setDeciding] = useState<string | null>(null)
  useEffect(() => {
    if (!isHost || !restricted) { setKnocks([]); return }
    let alive = true
    const poll = () => chatApi.listKnocks(call.room)
      .then(k => { if (alive) setKnocks(k) })
      .catch(() => { /* a hiccup is not an empty queue: keep the last list */ })
    void poll()
    const timer = setInterval(poll, 4000)
    return () => { alive = false; clearInterval(timer) }
  }, [isHost, restricted, call.room])

  // Who is asking, by name. A row saying "a person" is an answer nobody can
  // give, so the directory is asked for the few ids in the queue.
  const [knockNames, setKnockNames] = useState<Record<string, string>>({})
  useEffect(() => {
    const missing = knocks.map(k => k.user_id).filter(id => !knockNames[id])
    if (!missing.length) return
    api.get<{ users: { id: string; display_name: string | null; username: string }[] }>(
      `/users/lookup?ids=${missing.join(',')}`,
    )
      .then(r => setKnockNames(n => ({
        ...n,
        ...Object.fromEntries(r.data.users.map(u => [u.id, u.display_name || u.username])),
      })))
      .catch(() => { /* the row falls back to "a person" */ })
  }, [knocks]) // eslint-disable-line react-hooks/exhaustive-deps

  const decide = async (userId: string, admit: boolean) => {
    setDeciding(userId)
    try { await chatApi.decideKnock(call.room, userId, admit); setKnocks(k => k.filter(x => x.user_id !== userId)) }
    catch { /* the list refreshes on the next poll */ }
    finally { setDeciding(null) }
  }
  // Read inside callbacks that must not be rebuilt when the room's nature is
  // finally known — a meeting joined by its link starts before the list arrives.
  const isMeetingRef = useRef(isMeeting)
  isMeetingRef.current = isMeeting
  // The room's own name, once the conversation list holds it — a meeting joined
  // straight from its link starts before that list has arrived.
  const roomName = useChatStore(
    s => s.conversations.find(c => c.conversation.id === call.room)?.conversation.name ?? '',
  )
  const [showReactionBar, setShowReactionBar] = useState(false)

  const amOfferer = useCallback((other: string) => myId < other, [myId])

  // Rebuild the render tiles from the peer table + local stream.
  const syncTiles = useCallback(() => {
    const remote: Tile[] = Array.from(peersRef.current.entries()).map(([uid, p]) => ({
      userId: uid, name: p.name, stream: p.stream, screenStream: p.screen, isLocal: false, connected: p.connected, hand: p.hand, muted: p.muted, camOff: p.camOff, sharing: p.sharing, sharingAt: p.sharingAt,
    }))
    setTiles(remote)
  }, [])

  // Targeted + broadcast signal helpers.
  const send = useCallback((to: string, sig: Omit<CallSignal, 'room'>) => {
    sendCallSignal(to, { ...sig, room: call.room })
  }, [sendCallSignal, call.room])
  const broadcast = useCallback((sig: Omit<CallSignal, 'room'>) => {
    membersRef.current.forEach(u => send(u, sig))
  }, [send])

  // Create (or fetch) a peer connection for `uid`, wiring tracks + ICE.
  const ensurePeer = useCallback((uid: string, name: string): Peer => {
    const existing = peersRef.current.get(uid)
    if (existing) { if (name && existing.name !== name) existing.name = name; return existing }
    const pc = new RTCPeerConnection({ iceServers: iceServers() })
    const peer: Peer = { pc, name: name || uid.slice(0, 6), stream: null, screen: null, pendingIce: [], hand: false, muted: false, camOff: false, connected: false, sharing: false, sharingAt: 0 }
    localStreamRef.current?.getTracks().forEach(tr => pc.addTrack(tr, localStreamRef.current!))
    pc.ontrack = ev => {
      // A participant sends their camera and, while presenting, their screen as
      // a SECOND stream. The first stream is the person; any other one carrying
      // video is their presentation — so the camera keeps showing throughout.
      const incoming = ev.streams[0] ?? new MediaStream([ev.track])
      if (!peer.stream || peer.stream.id === incoming.id) peer.stream = incoming
      else if (ev.track.kind === 'video') peer.screen = incoming
      if (ev.track.kind === 'video') setIsVideo(true)
      syncTiles()
    }
    pc.onicecandidate = ev => { if (ev.candidate) send(uid, { type: 'call_ice', candidate: ev.candidate.toJSON() }) }
    pc.onconnectionstatechange = () => {
      peer.connected = pc.connectionState === 'connected'
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') removePeer(uid)
      else syncTiles()
    }
    peersRef.current.set(uid, peer)
    syncTiles()
    return peer
  }, [send, syncTiles]) // eslint-disable-line react-hooks/exhaustive-deps

  // A peer left (hung up, or its connection died). When nobody is left, the
  // call is over and the window closes by itself — but only once someone was
  // actually part of it: the initiator of a meeting room may still be alone,
  // waiting, and a ring nobody has answered yet is not a finished call. A
  // rung participant who leaves (declines) counts as the call ending too.
  const removePeer = useCallback((uid: string) => {
    const p = peersRef.current.get(uid)
    if (p) { try { p.pc.close() } catch { /* noop */ } peersRef.current.delete(uid) }
    syncTiles()
    const wasRung = call.ring.some(r => r.userId === uid)
    // A meeting is a room, not a conversation between two people: it stays open
    // when the last other participant leaves, whoever opened it, so someone can
    // wait there alone. Only the host ending it closes it for everyone. A plain
    // call, on the other hand, is over once nobody is left on the line.
    if (isMeetingRef.current) return
    if (peersRef.current.size === 0 && (p || wasRung)) {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
      onEnd()
    }
  }, [syncTiles, call.ring, onEnd])

  const makeOffer = useCallback(async (uid: string, name: string) => {
    const peer = ensurePeer(uid, name)
    try {
      const offer = await peer.pc.createOffer()
      await peer.pc.setLocalDescription(offer)
      send(uid, { type: 'call_offer', sdp: offer.sdp, call_type: call.type, from_name: myName })
    } catch { /* noop */ }
  }, [ensurePeer, send, call.type, myName])

  // ── Signaling handler ──────────────────────────────────────────────────────
  useEffect(() => {
    const onSignal = async (e: Event) => {
      const { signal, fromUserId } = (e as CustomEvent).detail as { signal: CallSignal; fromUserId: string }
      if (!signal || signal.room !== call.room || fromUserId === myId) return
      const name = signal.from_name || fromUserId.slice(0, 6)
      // The member list was read once, when we joined: somebody who arrived
      // after that would never receive anything we broadcast. Anyone who
      // signals to us is in the room, so remember them.
      if (!membersRef.current.includes(fromUserId)) membersRef.current.push(fromUserId)

      switch (signal.type) {
        case 'call_join': {
          // A newcomer announced themselves: tell them we're here, then connect.
          send(fromUserId, { type: 'call_present', from_name: myName })
          // Someone joining a meeting being recorded must know it straight away.
          if (recorderRef.current) send(fromUserId, { type: 'call_state', recording: true, from_name: myName })
          if (amOfferer(fromUserId)) makeOffer(fromUserId, name)
          else ensurePeer(fromUserId, name)
          break
        }
        case 'call_present': {
          if (amOfferer(fromUserId)) makeOffer(fromUserId, name)
          else ensurePeer(fromUserId, name)
          break
        }
        case 'call_offer': {
          const peer = ensurePeer(fromUserId, name)
          try {
            await peer.pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp })
            for (const c of peer.pendingIce.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {})
            const answer = await peer.pc.createAnswer()
            await peer.pc.setLocalDescription(answer)
            send(fromUserId, { type: 'call_answer', sdp: answer.sdp })
          } catch { /* noop */ }
          break
        }
        case 'call_answer': {
          const peer = peersRef.current.get(fromUserId)
          if (peer) {
            try {
              await peer.pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp })
              for (const c of peer.pendingIce.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {})
            } catch { /* noop */ }
          }
          break
        }
        case 'call_ice': {
          const peer = peersRef.current.get(fromUserId)
          if (peer && signal.candidate) {
            if (peer.pc.remoteDescription) peer.pc.addIceCandidate(signal.candidate).catch(() => {})
            else peer.pendingIce.push(signal.candidate)
          }
          break
        }
        case 'call_leave': removePeer(fromUserId); break
        // The host ended the meeting: it is over for everyone at once.
        case 'call_end': onEnd('ended'); break
        // The host removed this participant.
        case 'call_kick': onEnd('removed'); break
        // The host muted this participant. A host can mute, never unmute:
        // turning the microphone back on stays the person's own decision.
        case 'call_mute': {
          const track = localStreamRef.current?.getAudioTracks()[0]
          if (track?.enabled) {
            track.enabled = false
            setIsMuted(true)
            broadcast({ type: 'call_state', muted: true })
          }
          setHostNotice(t('chat_call_muted_by', { name }))
          break
        }
        case 'call_state': {
          const peer = peersRef.current.get(fromUserId)
          if (peer) {
            if (signal.hand    !== undefined) peer.hand   = signal.hand
            if (signal.muted   !== undefined) peer.muted  = signal.muted
            if (signal.cam_off !== undefined) peer.camOff = signal.cam_off
            if (signal.sharing !== undefined) {
              peer.sharing = signal.sharing
              // Stamped on arrival: whoever starts sharing last takes the stage,
              // replacing the presentation that was there.
              peer.sharingAt = signal.sharing ? Date.now() : 0
              if (!signal.sharing) peer.screen = null
            }
            syncTiles()
          }
          // Everyone is told, whoever they are: a recording is never silent.
          if (signal.recording !== undefined) {
            setRecordedBy(signal.recording ? name : null)
            setRecordNotice(signal.recording ? 'started' : 'stopped')
          }
          break
        }
        case 'call_activity': {
          // Announced like a reaction: a passing line, not a dialog — the
          // thing itself is already in the room's conversation.
          const who = signal.from_name || t('chat_call_someone', { defaultValue: 'Quelqu’un' })
          setHostNotice(t('chat_call_activity_shared', { name: who, what: signal.activity ?? '',
            defaultValue: '{{name}} a partagé {{what}}' }))
          break
        }
        case 'call_reaction': {
          const id = Date.now() + Math.floor(performance.now())
          setReactions(r => [...r, { id, emoji: signal.emoji ?? '👍', name }])
          setTimeout(() => setReactions(r => r.filter(x => x.id !== id)), 4000)
          break
        }
      }
    }
    window.addEventListener('chat:call_signal', onSignal)
    return () => window.removeEventListener('chat:call_signal', onSignal)
  }, [call.room, myId, myName, amOfferer, makeOffer, ensurePeer, removePeer, send, syncTiles])

  // ── Media + join ───────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function setup() {
      // Fresh ICE servers first: the TURN credential is short-lived.
      await refreshChatConfig().catch(() => undefined)
      if (cancelled) return
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: isVideo })
      } catch {
        try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }) }
        catch { setMicError(true); setTimeout(onEnd, 2500); return }
      }
      if (cancelled) { stream.getTracks().forEach(tr => tr.stop()); return }
      // Honour the choices made in the meeting lobby (mic/camera off).
      if (call.initialMuted) { const a = stream.getAudioTracks()[0]; if (a) { a.enabled = false; setIsMuted(true) } }
      if (call.initialCamOff) { const v = stream.getVideoTracks()[0]; if (v) { v.enabled = false; setIsCamOff(true) } }
      localStreamRef.current = stream
      // The single door another module may knock on (see meetingMedia.ts).
      publishMeetingMedia(call.room, stream)
      setLocalStream(stream)

      // A peer connection built before the camera and microphone opened carries
      // no outgoing track, and nothing would ever add one: the others would
      // hear and see nothing from us for the whole meeting. Attach the tracks
      // to every such connection and renegotiate — the side that changes its
      // media is the one that re-offers.
      peersRef.current.forEach((peer, uid) => {
        const sent = new Set(peer.pc.getSenders().map(sender => sender.track).filter(Boolean))
        let added = false
        stream.getTracks().forEach(tr => { if (!sent.has(tr)) { peer.pc.addTrack(tr, stream); added = true } })
        if (added) void makeOffer(uid, peer.name)
      })

      // Fetch the room members so we can ring/announce to everyone.
      try {
        const res = await chatApi.getConversation(call.room)
        membersRef.current = (res.members ?? []).map(m => m.user_id).filter(id => id !== myId)
        const mine = (res.members ?? []).find(m => m.user_id === myId)?.role
        setRoleIsHost(mine === 'owner' || mine === 'admin')
        const pics: Record<string, string | null> = {}
        ;(res.members ?? []).forEach(m => { pics[m.user_id] = m.avatar_url ?? null })
        setAvatars(pics)
      } catch { membersRef.current = call.ring.map(p => p.userId) }

      // Ring the chosen participants (initiator only), then announce our presence.
      if (call.isInitiator) {
        call.ring.forEach(p => send(p.userId, { type: 'call_ring', call_type: call.type, from_name: myName }))
      }
      broadcast({ type: 'call_join', call_type: call.type, from_name: myName })
    }
    setup()
    return () => {
      cancelled = true
      broadcast({ type: 'call_leave' })
      peersRef.current.forEach(p => { try { p.pc.close() } catch { /* noop */ } })
      peersRef.current.clear()
      screenStreamRef.current?.getTracks().forEach(tr => tr.stop())
      localStreamRef.current?.getTracks().forEach(tr => tr.stop())
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Connected as soon as at least one peer is up (drives the call timer).
  const anyConnected = tiles.some(tl => tl.connected)
  useEffect(() => {
    if (!anyConnected) return
    const id = setInterval(() => setDuration(d => d + 1), 1000)
    return () => clearInterval(id)
  }, [anyConnected])

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  const formatDuration = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  // ── Recording ───────────────────────────────────────────────────────────────
  // What the recorder paints and mixes, read from the live refs on every frame
  // so late arrivals and a presentation started midway are picked up.
  const recorderSources = useCallback(() => ({
    screen: () => {
      if (screenStreamRef.current) return screenStreamRef.current
      for (const p of peersRef.current.values()) if (p.sharing && p.screen) return p.screen
      return null
    },
    tiles: () => {
      const dark = (st: MediaStream | null) => !st?.getVideoTracks().some(tr => tr.enabled && tr.readyState === 'live')
      const list = [{ name: myName, stream: localStreamRef.current, camOff: dark(localStreamRef.current) }]
      for (const p of peersRef.current.values()) list.push({ name: p.name, stream: p.stream, camOff: p.camOff || dark(p.stream) })
      return list
    },
    audio: () => {
      const out: MediaStream[] = []
      if (localStreamRef.current) out.push(localStreamRef.current)
      for (const p of peersRef.current.values()) { if (p.stream) out.push(p.stream); if (p.screen) out.push(p.screen) }
      return out
    },
  }), [myName])

  const stopRecording = useCallback(async (announce = true) => {
    const rec = recorderRef.current
    if (!rec) return
    recorderRef.current = null
    setRecordedBy(null)
    setRecordSaving(true)
    if (announce) { setRecordNotice('stopped'); broadcast({ type: 'call_state', recording: false, from_name: myName }) }
    try {
      const { blob, mime, durationMs } = await rec.stop()
      if (blob.size > 0) {
        const ext = mime.includes('mp4') ? 'mp4' : 'webm'
        const stamp = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' })
          .format(new Date()).replace(/[/:\\]/g, '-')
        const name = `${t('chat_call_recording_file')} ${stamp}.${ext}`
        // The recording belongs to whoever made it: it goes to their own space,
        // in a folder created on first use. Without a files module it stays in
        // the meeting's conversation rather than being lost.
        try {
          const saved = await saveToFiles(RECORDING_FOLDER, blob, name)
          setRecordSavedIn(saved.folder)
        } catch (e) {
          console.error('recording to files', e)
          await pushMediaToConversation(call.room, blob, {
            mime, kind: 'video', name,
            width: 1280, height: 720, duration: Math.round(durationMs / 1000),
          }, t('chat_call_recording_caption'))
          setRecordSavedIn('')
        }
      }
    } catch (e) {
      console.error('meeting recording', e)
    }
    setRecordSaving(false)
  }, [broadcast, call.room, myName, t])

  // Listening starts with the window and follows the room as people join.
  const speakWatch = useRef<ReturnType<typeof watchSpeaking> | null>(null)
  useEffect(() => {
    const watch = watchSpeaking(setSpeaking)
    speakWatch.current = watch
    const refresh = () => {
      const entries: { id: string; stream: MediaStream | null }[] = [{ id: myId, stream: localStreamRef.current }]
      for (const [uid, p] of peersRef.current) entries.push({ id: uid, stream: p.stream })
      watch.update(entries)
    }
    refresh()
    const id = window.setInterval(refresh, 1500)
    return () => { window.clearInterval(id); watch.close(); speakWatch.current = null }
  }, [myId])
  // Given to a tile so its badge can follow the voice on its own.
  const levelOf = useCallback((uid: string) => () => speakWatch.current?.levels.get(uid) ?? 0, [])

  // The recording is finished even when the meeting ends abruptly, so the file
  // is never lost.
  const finalize = useRef<() => void>(() => {})
  useEffect(() => { finalize.current = () => { void stopRecording(false) } })
  useEffect(() => () => { finalize.current() }, [])

  // Its own clock, shown next to the indicator.
  useEffect(() => {
    if (!recorderRef.current) { setRecordElapsed(0); return }
    const id = window.setInterval(() => setRecordElapsed(Math.floor((recorderRef.current?.elapsed() ?? 0) / 1000)), 500)
    return () => window.clearInterval(id)
  }, [recordedBy])

  useEffect(() => {
    if (recordSavedIn === null) return
    const id = window.setTimeout(() => setRecordSavedIn(null), 9000)
    return () => window.clearTimeout(id)
  }, [recordSavedIn])

  useEffect(() => {
    if (!hostNotice) return
    const id = window.setTimeout(() => setHostNotice(null), 6000)
    return () => window.clearTimeout(id)
  }, [hostNotice])

  // A notice is a passing thing; the indicator is what stays.
  useEffect(() => {
    if (!recordNotice) return
    const id = window.setTimeout(() => setRecordNotice(null), 6000)
    return () => window.clearTimeout(id)
  }, [recordNotice])

  const startRecording = useCallback(async (preagreed = false) => {
    if (recorderRef.current || recordSaving) return
    if (!isHost) return
    if (!canRecordMeeting()) { if (!preagreed) await confirm({ title: t('chat_call_recording_unsupported_title'), message: t('chat_call_recording_unsupported'), hideCancel: true }); return }
    // Everyone is told, so the person starting is asked to make sure the others
    // agree before the recording begins. `preagreed` skips the question and
    // ONLY that: the host ticked "record this meeting" in its options, under
    // the same warning, so the acknowledgement already happened — asking twice
    // for one decision teaches people to dismiss the asking.
    if (!preagreed) {
      const ok = await confirm({
        title:        t('chat_call_recording_ask_title'),
        message:      t('chat_call_recording_ask'),
        confirmLabel: t('chat_call_recording_start'),
        cancelLabel:  t('common_cancel'),
        variant:      'warning',
      })
      if (!ok) return
    }
    try {
      recorderRef.current = startMeetingRecording(recorderSources(), () => { void stopRecording() })
      setRecordedBy(t('chat_call_you'))
      setRecordNotice('started')
      broadcast({ type: 'call_state', recording: true, from_name: myName })
    } catch (e) {
      console.error('meeting recording', e)
      await confirm({ title: t('chat_call_recording_unsupported_title'), message: t('chat_call_recording_unsupported'), hideCancel: true })
    }
  }, [broadcast, confirm, isHost, myName, recordSaving, recorderSources, stopRecording, t])

  // "Record this meeting", decided in the meeting's options: the room starts on
  // its own as soon as a host who may record is in it. Once per room — a
  // reconnection must not start a second recording, and a host who stopped it
  // on purpose must not see it start again under them.
  const autoRecordDone = useRef(false)
  useEffect(() => {
    if (autoRecordDone.current) return
    if (!isHost || !anyConnected) return
    if (!meetingSettings?.auto_record) return
    autoRecordDone.current = true
    void startRecording(true)
  }, [isHost, anyConnected, meetingSettings?.auto_record, startRecording])

  const askStopRecording = useCallback(async () => {
    const ok = await confirm({
      title:        t('chat_call_recording_stop_title'),
      message:      t('chat_call_recording_stop_ask'),
      confirmLabel: t('chat_call_recording_stop'),
      cancelLabel:  t('common_cancel'),
    })
    if (ok) await stopRecording()
  }, [confirm, stopRecording, t])

  const hangUp = useCallback(async () => {
    publishMeetingMedia(call.room, null)
    if (recorderRef.current) await stopRecording()
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    onEnd()
  }, [onEnd, stopRecording, call.room])

  /** Ends the meeting for everyone — the host's own action, never a guest's. */
  const endForEveryone = useCallback(async () => {
    const ok = await confirm({
      title:        t('chat_call_end_all_title'),
      message:      t('chat_call_end_all_ask'),
      confirmLabel: t('chat_call_end_all'),
      cancelLabel:  t('common_cancel'),
      variant:      'danger',
    })
    if (!ok) return
    if (recorderRef.current) await stopRecording()
    // Told directly, for the people already connected, and closed on the server,
    // which reaches anyone the direct signal missed and shuts the door.
    broadcast({ type: 'call_end', from_name: myName })
    try { await chatApi.endMeeting(call.room) } catch (e) { console.error('endMeeting', e) }
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    onEnd('ended')
  }, [broadcast, call.room, confirm, myName, onEnd, stopRecording, t])

  /** Asks someone's client to mute them. Only a host may. */
  const muteParticipant = useCallback((uid: string) => {
    send(uid, { type: 'call_mute', from_name: myName })
  }, [send, myName])

  /** Removes someone from the meeting: the server checks the right, then the
   *  person's own client leaves. */
  const removeParticipant = useCallback(async (uid: string, name: string) => {
    const ok = await confirm({
      title:        t('chat_call_remove_title'),
      message:      t('chat_call_remove_ask', { name }),
      confirmLabel: t('chat_call_remove'),
      cancelLabel:  t('common_cancel'),
      variant:      'danger',
    })
    if (!ok) return
    try { await chatApi.removeMember(call.room, uid) } catch (e) { console.error('removeMember', e) }
    send(uid, { type: 'call_kick', from_name: myName })
    removePeer(uid)
  }, [call.room, confirm, myName, removePeer, send, t])

  function toggleMute() {
    const track = localStreamRef.current?.getAudioTracks()[0]
    if (track) { track.enabled = !track.enabled; setIsMuted(!track.enabled); broadcast({ type: 'call_state', muted: !track.enabled }) }
  }
  async function toggleCamera() {
    const track = localStreamRef.current?.getVideoTracks()[0]
    if (track) { track.enabled = !track.enabled; setIsCamOff(!track.enabled); broadcast({ type: 'call_state', cam_off: !track.enabled }); return }
    // An audio call: no camera was opened at setup. Open it now, add the
    // track to every peer connection and renegotiate — the side that changes
    // its media is the one that re-offers, whatever the initial offerer rule.
    await turnCameraOn()
  }

  async function turnCameraOn() {
    let cam: MediaStream
    try { cam = await navigator.mediaDevices.getUserMedia({ video: true }) }
    catch { return }
    const track = cam.getVideoTracks()[0]
    if (!track) return
    const local = localStreamRef.current ?? new MediaStream()
    local.addTrack(track)
    localStreamRef.current = local
    setLocalStream(local)
    setIsCamOff(false)
    setIsVideo(true)
    broadcast({ type: 'call_state', cam_off: false })
    for (const [uid, p] of peersRef.current) {
      try {
        p.pc.addTrack(track, local)
        const offer = await p.pc.createOffer()
        await p.pc.setLocalDescription(offer)
        send(uid, { type: 'call_offer', sdp: offer.sdp, call_type: 'video', from_name: myName })
      } catch { /* the peer keeps audio only */ }
    }
  }
  function toggleHand() {
    const v = !handUp; setHandUp(v); broadcast({ type: 'call_state', hand: v })
  }
  function sendReaction(emoji: string) {
    setShowReactionBar(false)
    broadcast({ type: 'call_reaction', emoji, from_name: myName })
    const id = Date.now()
    setReactions(r => [...r, { id, emoji, name: myName }])
    setTimeout(() => setReactions(r => r.filter(x => x.id !== id)), 4000)
  }

  async function toggleFullscreen() {
    if (!isFullscreen) { try { await fsContainerRef.current?.requestFullscreen() } catch { setIsFullscreen(true) } }
    else if (document.fullscreenElement) await document.exitFullscreen()
    else setIsFullscreen(false)
  }

  // The devices offered by the mic/camera pickers on the control bar. Labels
  // only exist once permission has been granted, so this runs after the call
  // has its stream.
  useEffect(() => {
    if (!localStream) return
    navigator.mediaDevices.enumerateDevices().then(list => {
      setDevices({
        mics:     list.filter(d => d.kind === 'audioinput'),
        cams:     list.filter(d => d.kind === 'videoinput'),
        speakers: list.filter(d => d.kind === 'audiooutput'),
      })
    }).catch(() => { /* no device access */ })
  }, [localStream])

  // Switch microphone or camera mid-call: acquire the new track, hand it to
  // every peer connection in place (no renegotiation), and swap it into the
  // local stream so the own tile follows.
  async function switchDevice(kind: 'audio' | 'video', deviceId: string) {
    if (kind === 'audio') setMicId(deviceId); else setCamId(deviceId)
    try {
      const fresh = await navigator.mediaDevices.getUserMedia(
        kind === 'audio' ? { audio: { deviceId: { exact: deviceId } } } : { video: { deviceId: { exact: deviceId } } },
      )
      const track = kind === 'audio' ? fresh.getAudioTracks()[0] : fresh.getVideoTracks()[0]
      if (!track) return
      track.enabled = kind === 'audio' ? !isMuted : !isCamOff
      peersRef.current.forEach(p => {
        const sender = p.pc.getSenders().find(sd => sd.track?.kind === kind)
        sender?.replaceTrack(track).catch(() => {})
      })
      const local = localStreamRef.current
      if (local) {
        const old = kind === 'audio' ? local.getAudioTracks()[0] : local.getVideoTracks()[0]
        if (old) { local.removeTrack(old); old.stop() }
        local.addTrack(track)
        setLocalStream(new MediaStream(local.getTracks()))
      }
    } catch { /* device busy or refused */ }
  }

  // Send a video track to every peer. When a connection has no video sender
  // yet — an audio call never created one — the track is ADDED and the call
  // renegotiated, which is what sharing a screen from an audio call needs. The
  // side that changes its media is the one that re-offers, whatever the
  // initial offerer rule.
  async function publishVideoTrack(track: MediaStreamTrack) {
    for (const [uid, p] of peersRef.current) {
      const sender = p.pc.getSenders().find(sd => sd.track?.kind === 'video')
      if (sender) { sender.replaceTrack(track).catch(() => {}); continue }
      try {
        p.pc.addTrack(track, localStreamRef.current ?? new MediaStream([track]))
        const offer = await p.pc.createOffer()
        await p.pc.setLocalDescription(offer)
        send(uid, { type: 'call_offer', sdp: offer.sdp, call_type: 'video', from_name: myName })
      } catch { /* that peer keeps audio only */ }
    }
  }

  /** Send the screen as EXTRA tracks, so the camera keeps flowing beside it.
   *  Its sound travels too when the person chose to share it. */
  async function publishScreenTrack(track: MediaStreamTrack, stream: MediaStream) {
    const audio = stream.getAudioTracks()[0]
    for (const [uid, p] of peersRef.current) {
      try {
        p.pc.addTrack(track, stream)
        if (audio) p.pc.addTrack(audio, stream)
        const offer = await p.pc.createOffer()
        await p.pc.setLocalDescription(offer)
        send(uid, { type: 'call_offer', sdp: offer.sdp, call_type: 'video', from_name: myName })
      } catch { /* that peer misses the presentation */ }
    }
  }

  /** Take the screen back off the call and renegotiate. */
  async function unpublishScreenTrack(tracks: MediaStreamTrack[]) {
    for (const [uid, p] of peersRef.current) {
      const senders = p.pc.getSenders().filter(sd => sd.track && tracks.includes(sd.track))
      if (senders.length === 0) continue
      try {
        senders.forEach(sd => p.pc.removeTrack(sd))
        const offer = await p.pc.createOffer()
        await p.pc.setLocalDescription(offer)
        send(uid, { type: 'call_offer', sdp: offer.sdp, call_type: 'video', from_name: myName })
      } catch { /* the peer will drop the track anyway */ }
    }
  }

  async function startScreenShare() {
    let screen: MediaStream
    try {
      // Offer to carry the shared window's sound as well — a shared video is
      // useless silent — and never propose the meeting's own tab as a source.
      screen = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'include',
      } as DisplayMediaStreamOptions)
    } catch { return } // the picker was dismissed, or capture is not permitted
    const track = screen.getVideoTracks()[0]
    if (!track) return
    screenStreamRef.current = screen
    // Added, not swapped in: replacing the camera track is what used to make
    // everyone's camera vanish the moment somebody presented.
    await publishScreenTrack(track, screen)
    setIsVideo(true)
    broadcast({ type: 'call_state', sharing: true })
    track.onended = () => { void stopScreenShare() }
    setMySharingAt(Date.now())
    setIsSharing(true)
  }

  async function stopScreenShare() {
    const screen = screenStreamRef.current
    if (screen) await unpublishScreenTrack(screen.getTracks())
    screen?.getTracks().forEach(tr => tr.stop())
    screenStreamRef.current = null
    broadcast({ type: 'call_state', sharing: false })
    setMySharingAt(0)
    setIsSharing(false)
  }

  async function toggleScreenShare() {
    if (isSharing) await stopScreenShare()
    else await startScreenShare()
  }

  // A new presentation is shown again even if the previous one was dismissed.
  useEffect(() => {
    if (!tiles.some(tl => tl.sharing) && !isSharing) {
      setHidePresentation(false); setPresentationPinned(true); setPresentationMuted(false)
    }
  }, [tiles, isSharing])

  const localTile: Tile = {
    userId: myId, name: myName, avatarUrl: myAvatar, stream: localStream, isLocal: true, connected: true, hand: handUp, muted: isMuted, camOff: isCamOff, sharing: isSharing, sharingAt: mySharingAt,
  }
  const allTiles = [localTile, ...tiles.map(tl => ({ ...tl, avatarUrl: avatars[tl.userId] ?? null }))]
    // Someone whose microphone is off is never shown as speaking.
    .map(tl => ({ ...tl, speaking: speaking.has(tl.userId) && !tl.muted }))
  const cols = allTiles.length <= 1 ? 1 : allTiles.length <= 4 ? 2 : 3

  // Measured here, above any early return, so the hook order never changes.
  const { ref: areaRef, box: areaBox } = useMeasuredBox()
  // Shape of what is being shared, reported by the presentation itself.
  const [presentRatio, setPresentRatio] = useState(16 / 9)
  // While the window is being dragged the area changes many times a second:
  // animating each step would make everything shake, so movement is only
  // animated for the discrete changes — a panel, a presentation, someone
  // joining. Resizing simply follows the pointer.
  const [animateLayout, setAnimateLayout] = useState(true)
  const lastAreaChange = useRef(0)
  useEffect(() => {
    if (!areaBox) return
    const now = performance.now()
    const rapid = now - lastAreaChange.current < 300
    lastAreaChange.current = now
    if (!rapid) return
    setAnimateLayout(false)
    const id = setTimeout(() => setAnimateLayout(true), 300)
    return () => clearTimeout(id)
  }, [areaBox])

  // ── Minimized corner widget ─────────────────────────────────────────────────
  if (isMinimized) {
    return createPortal(
      <div className="fixed bottom-4 right-4 z-[2147483300] rounded-2xl overflow-hidden shadow-2xl bg-gray-900 text-white" style={{ width: 220 }}>
        <div className="grid gap-0.5 p-0.5" style={{ gridTemplateColumns: `repeat(${Math.min(2, allTiles.length)}, 1fr)`, height: 130 }}>
          {allTiles.slice(0, 4).map(tl => <VideoTile key={tl.userId} tile={tl} isVideo={isVideo} />)}
        </div>
        <div className="flex items-center justify-between px-2 py-2 bg-black/30">
          <button onClick={() => setIsMinimized(false)} className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20" title={t('chat_call_expand')}>
            <Square size={14} />
          </button>
          <span className="text-[11px] text-gray-300">{anyConnected ? formatDuration(duration) : '…'}</span>
          <button onClick={hangUp} className="p-1.5 rounded-lg bg-danger hover:bg-red-700" title={t('chat_call_hang_up')}>
            <PhoneOff size={14} />
          </button>
        </div>
      </div>,
      document.body,
    )
  }

  // ── Control bar ────────────────────────────────────────────────────────────
  // Mic and camera each carry a chevron opening their device menu; the leave
  // button sits apart from them so it is never hit by accident. Every menu is
  // the @ui MenuDropdown primitive.
  const deviceItems = (
    groups: { label: string; items: MediaDeviceInfo[]; value: string; onPick: (id: string) => void }[],
  ): MenuItem[] =>
    groups.flatMap(g => [
      { type: 'label' as const, text: g.label },
      ...(g.items.length === 0
        ? [{ type: 'action' as const, label: '—', disabled: true, onClick: () => {} }]
        : g.items.map(d => ({
            type: 'action' as const,
            label: d.label || d.deviceId.slice(0, 16),
            checked: g.value === d.deviceId,
            onClick: () => g.onPick(d.deviceId),
          }))),
    ])

  const micItems = deviceItems([
    { label: t('chat_call_microphone'), items: devices.mics, value: micId, onPick: id => switchDevice('audio', id) },
    { label: t('chat_call_speaker'), items: devices.speakers, value: speakerId, onPick: setSpeakerId },
  ])
  const camItems = deviceItems([
    { label: t('chat_call_camera'), items: devices.cams, value: camId, onPick: id => switchDevice('video', id) },
  ])

  const openPanel = (panel: 'settings' | 'effects') => {
    setShowChat(false); setShowPeople(false); setSidePanel(panel)
  }

  // Activities contributed by other modules. Absent entirely when nothing is
  // registered — an empty "Activities" submenu would be a promise of nothing.
  // A guest may launch one unless the host reserved that for themselves.
  const activities = listMeetingActivities()
  const mayLaunch  = !moderated || meetingSettings?.allow_participant_activities !== false
  const runActivity = async (id: string) => {
    const a = activities.find(x => x.id === id)
    if (!a) return
    try {
      const what = await a.run(call.room)
      if (what) broadcast({ type: 'call_activity', from_name: myName, activity: String(what) })
    } catch { /* the activity says so itself, or the reader simply cancelled */ }
  }

  const moreItems: MenuItem[] = [
    { type: 'action', icon: <LayoutGrid size={16} />, label: viewMode === 'grid' ? t('chat_call_view_spotlight') : t('chat_call_view_grid'),
      onClick: () => setViewMode(v => (v === 'grid' ? 'spotlight' : 'grid')) },
    { type: 'action', icon: <Maximize2 size={16} />, label: isFullscreen ? t('chat_call_exit_fullscreen') : t('chat_call_fullscreen'),
      onClick: () => toggleFullscreen() },
    { type: 'action', icon: <PictureInPicture2 size={16} />, label: t('chat_call_pip'), onClick: () => setIsMinimized(true) },
    { type: 'action', icon: <Sparkles size={16} />, label: t('chat_call_effects'), onClick: () => openPanel('effects') },
    { type: 'separator' },
    // Recording belongs to whoever holds the meeting: it is offered to the
    // others as unavailable, with its reason, rather than hidden from them.
    recorderRef.current
      ? { type: 'action', icon: <CircleStop size={16} />, label: t('chat_call_recording_stop'), onClick: () => { void askStopRecording() } }
      : { type: 'action', icon: <Disc size={16} />, label: recordSaving ? t('chat_call_recording_saving') : t('chat_call_record'), disabled: !isHost || recordSaving || !!recordedBy, onClick: () => { void startRecording() } },
    ...(!isHost && !recordedBy ? [{ type: 'label' as const, text: t('chat_call_recording_host_only') }] : []),
    ...(recordedBy && !recorderRef.current ? [{ type: 'label' as const, text: t('chat_call_recording_by', { name: recordedBy }) }] : []),
    { type: 'separator' },
    // Offered, and shown as unavailable with its reason: a dial-in needs a
    // telephony gateway this instance does not have.
    { type: 'action', icon: <PhoneForwarded size={16} />, label: t('chat_call_phone_audio'), disabled: true, onClick: () => {} },
    { type: 'label', text: t('chat_call_phone_audio_none') },
    ...(activities.length && mayLaunch
      ? [
          { type: 'separator' as const },
          {
            type: 'submenu' as const,
            label: t('chat_call_activities', { defaultValue: 'Activités' }),
            icon: <Sparkles size={16} />,
            items: activities.map(a => ({
              type: 'action' as const, label: a.label, icon: a.icon,
              onClick: () => { void runActivity(a.id) },
            })),
          },
        ]
      : []),
    { type: 'separator' },
    { type: 'action', icon: <Settings size={16} />, label: t('chat_call_settings'), onClick: () => openPanel('settings') },
  ]

  const controls = (
    <div className="flex items-center justify-center gap-2 py-3 px-4 flex-shrink-0 relative">
      <div className="absolute left-4 hidden sm:block text-sm text-gray-300 tabular-nums">
        {anyConnected ? formatDuration(duration) : (call.isInitiator ? t('chat_call_ringing') : t('chat_call_connecting'))}
      </div>

      <div className="flex items-center">
        <button onClick={e => micMenu.open(e)} title={t('chat_call_microphone')} className="w-6 h-12 flex items-center justify-center text-gray-300 hover:text-white">
          <ChevronUp size={16} />
        </button>
        <CtrlButton onClick={toggleMute} danger={isMuted} title={isMuted ? t('chat_call_unmute') : t('chat_call_mute')}>
          {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
        </CtrlButton>
      </div>

      <div className="flex items-center">
        <button onClick={e => camMenu.open(e)} title={t('chat_call_camera')} className="w-6 h-12 flex items-center justify-center text-gray-300 hover:text-white">
          <ChevronUp size={16} />
        </button>
        <CtrlButton onClick={toggleCamera} danger={isCamOff} title={isCamOff ? t('chat_call_camera_on') : t('chat_call_camera_off')}>
          {isCamOff ? <VideoOff size={20} /> : <Video size={20} />}
        </CtrlButton>
      </div>

      {/* Withdrawn rather than shown refusing: a control that is there and
          says no on every press is a worse answer than one that is not there.
          The title says who decided. */}
      {mayShare && (
        <CtrlButton onClick={toggleScreenShare} active={isSharing} title={isSharing ? t('chat_call_stop_share') : t('chat_call_share_screen')}>
          {isSharing ? <MonitorOff size={20} /> : <Monitor size={20} />}
        </CtrlButton>
      )}

      <div className={`relative ${mayReact ? '' : 'hidden'}`}>
        <CtrlButton onClick={() => setShowReactionBar(v => !v)} title={t('chat_call_react', { defaultValue: 'Réagir' })}>
          <Smile size={20} />
        </CtrlButton>
        {showReactionBar && (
          <div className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 flex gap-1 bg-gray-800 rounded-full px-2 py-1.5 shadow-xl">
            {CALL_REACTIONS.map(e => (
              <button key={e} onClick={() => sendReaction(e)} className="text-xl hover:scale-125 transition-transform">{e}</button>
            ))}
          </div>
        )}
      </div>

      <CtrlButton onClick={toggleHand} active={handUp} title={t('chat_call_raise_hand', { defaultValue: 'Lever la main' })}>
        <Hand size={20} />
      </CtrlButton>

      <CtrlButton onClick={e2 => moreMenu.open(e2 as unknown as React.MouseEvent)} title={t('chat_more', { defaultValue: 'Plus' })}>
        <MoreVertical size={20} />
      </CtrlButton>

      <button
        onClick={e => { if (isHost && isMeeting) leaveMenu.open(e as unknown as React.MouseEvent); else void hangUp() }}
        className="ml-2 h-12 px-6 rounded-full bg-danger flex items-center justify-center hover:bg-red-700 transition-colors"
        title={isHost && isMeeting ? t('chat_call_leave_options') : t('chat_call_hang_up')}
      >
        <PhoneOff size={22} />
      </button>

      <div className="absolute right-4 flex items-center gap-1">
        <CtrlButton onClick={() => { setShowPeople(false); setSidePanel(null); setShowChat(v => !v) }} active={showChat} plain title={t('chat_call_chat', { defaultValue: 'Messagerie' })}>
          <MessageSquare size={20} />
        </CtrlButton>
        <CtrlButton onClick={() => { setShowChat(false); setSidePanel(null); setShowPeople(v => !v) }} active={showPeople} plain title={t('chat_call_people')}>
          <Users size={20} />
        </CtrlButton>
      </div>
    </div>
  )

  // Tiles actually laid out: a meeting shows a bounded grid and folds the rest
  // into one "+N others" tile, so faces stay legible however many people join.
  // Whoever is presenting takes the stage; everyone else shrinks to a strip.
  // Several people may share at once; the stage shows the latest, so a new
  // presentation replaces the one in progress.
  const presenter = allTiles
    .filter(tl => tl.sharing)
    .sort((a, b) => (b.sharingAt ?? 0) - (a.sharingAt ?? 0))[0] ?? null
  const presentationStream = presenter
    ? (presenter.isLocal ? screenStreamRef.current : presenter.screenStream ?? null)
    : null
  const presenterLabel = presenter ? (presenter.isLocal ? t('chat_call_you') : presenter.name) : ''
  // A new presentation always shows: what was set aside was the previous one.
  const presenterId = presenter?.userId ?? ''
  useEffect(() => { setHidePresentation(false); setPresentationPinned(true) }, [presenterId])
  const presenting = !!presenter && !!presentationStream && !hidePresentation && presentationPinned

  // Unpinned, the presentation leaves the stage and joins the grid as a tile.
  const gridTiles: Tile[] = (presenter && presentationStream && !hidePresentation && !presentationPinned)
    ? [...allTiles, {
        userId: `${presenter.userId}:screen`,
        name: presenter.isLocal ? t('chat_call_your_presentation') : t('chat_call_presentation_of', { name: presenterLabel }),
        stream: presentationStream,
        isLocal: presenter.isLocal,
        connected: true, hand: false, muted: true, camOff: false,
      }]
    : allTiles

  const MAX_TILES = 9
  const STRIP_TILES = 6
  const shown = presenting
    ? allTiles.slice(0, STRIP_TILES)
    : (pinnedId ? gridTiles.filter(tl => tl.userId === pinnedId) : gridTiles.slice(0, MAX_TILES))
  const overflow = presenting
    ? Math.max(0, allTiles.length - STRIP_TILES)
    : (pinnedId ? gridTiles.length - 1 : Math.max(0, gridTiles.length - MAX_TILES))
  const cells = shown.length + (overflow > 0 ? 1 : 0)
  const layout = meetingLayout(areaBox, cells, presenting)
  // One declaration for every object of the meeting, so they all move alike.
  const glide = animateLayout
    ? 'transform 280ms cubic-bezier(0.2, 0, 0, 1), width 280ms cubic-bezier(0.2, 0, 0, 1), height 280ms cubic-bezier(0.2, 0, 0, 1)'
    : 'none'
  // The presentation takes the largest box of its own shape that fits its slot.
  const stageSlot = layout.stage
  const frameW = stageSlot ? Math.round(Math.min(stageSlot.w, stageSlot.h * presentRatio)) : 0
  const frameH = stageSlot ? Math.round(Math.min(stageSlot.h, stageSlot.w / presentRatio)) : 0

  const callBody = (
    <div ref={fsContainerRef} className="flex flex-col h-full bg-[#202124] text-white relative">
      {/* Meeting bar: elapsed time · title · people count */}
      <header className="flex items-center gap-3 px-4 py-2.5 flex-shrink-0 text-sm">
        <span className="text-gray-300 tabular-nums">{anyConnected ? formatDuration(duration) : '—'}</span>
        {/* Recording indicator: shown to everyone, never hidden — it is how a
            meeting says out loud that it is being recorded. */}
        {(recordedBy || recordSaving) && (
          <button
            onClick={() => { if (recorderRef.current) void askStopRecording() }}
            disabled={!recorderRef.current}
            title={recorderRef.current ? t('chat_call_recording_stop') : t('chat_call_recording_by', { name: recordedBy ?? '' })}
            className={`flex items-center gap-1.5 rounded-full pl-2 pr-3 py-1 ${recorderRef.current ? 'bg-red-600/90 hover:bg-red-600' : 'bg-red-600/70'}`}
          >
            <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
            <span className="text-xs font-medium tracking-wide">
              {recordSaving && !recordedBy ? t('chat_call_recording_saving') : 'REC'}
            </span>
            {recorderRef.current && <span className="text-xs tabular-nums">{formatDuration(recordElapsed)}</span>}
          </button>
        )}
        <span className="text-gray-500">|</span>
        <span className="truncate max-w-[40%]">{roomName || call.title || t('chat_meeting_default_name')}</span>
        <Info size={15} className="text-gray-400 flex-shrink-0" />
        {/* The presentation names its author on the stage itself, so the bar
            says nothing while it is displayed. It only offers the way back when
            the presentation has been set aside. */}
        {presenter && hidePresentation && (
          <button
            onClick={() => setHidePresentation(false)}
            title={t('chat_call_show_presentation')}
            className="mx-auto flex items-center gap-2 rounded-full px-4 py-1.5 max-w-[45%] bg-primary/20 hover:bg-primary/30"
          >
            <Monitor size={15} className="text-primary flex-shrink-0" />
            <span className="truncate">{t('chat_call_show_presentation')}</span>
          </button>
        )}
        <div className="ml-auto flex items-center gap-1.5 bg-white/10 rounded-full px-3 py-1">
          <Users size={15} />
          <span className="tabular-nums">{allTiles.length}</span>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0 relative px-3 pb-1 min-h-0 flex flex-col">
          {/* Every object of the meeting is placed here by `meetingLayout`, and
              moves by changing its coordinates — never by being re-flowed. */}
          <div ref={areaRef} className="relative flex-1 min-h-0 overflow-hidden">
            {presenting && presenter && stageSlot && (
              <div
                className="absolute top-0 left-0"
                style={{
                  width: frameW, height: frameH, transition: glide,
                  transform: `translate(${Math.round(stageSlot.x + (stageSlot.w - frameW) / 2)}px, ${Math.round(stageSlot.y + (stageSlot.h - frameH) / 2)}px)`,
                }}
              >
                <PresentationStage
                  name={presenterLabel}
                  isMine={presenter.isLocal}
                  stream={presentationStream}
                  audioMuted={presenter.isLocal || presentationMuted}
                  canToggleAudio={!presenter.isLocal}
                  onRatio={setPresentRatio}
                  onToggleAudio={() => setPresentationMuted(m => !m)}
                  onUnpin={() => setPresentationPinned(false)}
                  onMenu={e => presentMenu.open(e)}
                  onFullscreen={toggleFullscreen}
                />
              </div>
            )}

            {shown.map((tl, i) => {
              const slot = layout.tiles[i]
              if (!slot) return null
              return (
                <div
                  key={tl.userId}
                  className="absolute top-0 left-0"
                  style={{ width: slot.size, height: slot.size, transform: `translate(${slot.x}px, ${slot.y}px)`, transition: glide }}
                >
                  <VideoTile
                    tile={tl}
                    isVideo={isVideo}
                    compact={presenting}
                    pinned={pinnedId === tl.userId}
                    level={levelOf(tl.userId)}
                    onPin={presenting ? undefined : () => setPinnedId(id => (id === tl.userId ? null : tl.userId))}
                  />
                </div>
              )
            })}

            {overflow > 0 && layout.tiles[shown.length] && (
              <div
                className="absolute top-0 left-0 bg-white/5 rounded-2xl flex flex-col items-center justify-center gap-2 text-xs text-gray-300 px-2 text-center"
                style={{
                  width: layout.tiles[shown.length].size, height: layout.tiles[shown.length].size,
                  transform: `translate(${layout.tiles[shown.length].x}px, ${layout.tiles[shown.length].y}px)`,
                  transition: glide,
                }}
              >
                {!presenting && (
                  <div className="flex -space-x-2">
                    {gridTiles.slice(shown.length, shown.length + 2).map(tl => (
                      <div key={tl.userId} className="w-10 h-10 rounded-full bg-primary/80 flex items-center justify-center text-white text-sm font-semibold ring-2 ring-[#202124]">
                        {tl.name[0]?.toUpperCase()}
                      </div>
                    ))}
                  </div>
                )}
                {t('chat_call_others', { count: overflow })}
              </div>
            )}
          </div>

          {/* What a host just did to this participant. */}
          {hostNotice && (
            <div className="pointer-events-none absolute top-3 inset-x-0 flex justify-center">
              <div className="flex items-center gap-2 bg-black/80 text-sm rounded-full px-4 py-2">
                <MicOff size={15} className="text-red-400 flex-shrink-0" />
                <span>{hostNotice}</span>
              </div>
            </div>
          )}

          {/* Where the finished recording went. */}
          {recordSavedIn !== null && (
            <div className="pointer-events-none absolute top-3 inset-x-0 flex justify-center">
              <div className="flex items-center gap-2 bg-black/80 text-sm rounded-full px-4 py-2">
                <Disc size={15} className="text-primary flex-shrink-0" />
                <span>
                  {recordSavedIn
                    ? t('chat_call_recording_saved_in', { folder: recordSavedIn })
                    : t('chat_call_recording_saved_chat')}
                </span>
              </div>
            </div>
          )}

          {/* Recording notice: said once, then it is the indicator's job. */}
          {recordNotice && (
            <div className="pointer-events-none absolute top-3 inset-x-0 flex justify-center">
              <div className="flex items-center gap-2 bg-black/80 text-sm rounded-full px-4 py-2">
                <Disc size={15} className="text-red-500 flex-shrink-0" />
                <span>
                  {recordNotice === 'started'
                    ? t('chat_call_recording_started', { name: recordedBy ?? t('chat_call_you') })
                    : t('chat_call_recording_ended')}
                </span>
              </div>
            </div>
          )}

          {/* Someone is asking to be let in. Shown to the host only, over the
              room rather than in a menu: an answer that is waited on must not
              be somewhere you have to go looking. */}
          {isHost && knocks.length > 0 && (
            <div className="absolute right-4 top-4 z-30 w-72 rounded-xl bg-white/95 p-3 shadow-xl backdrop-blur">
              <p className="mb-2 text-sm font-medium text-text-primary">
                {t('knock_pending', { count: knocks.length, defaultValue: '{{count}} personne(s) demandent à participer' })}
              </p>
              <ul className="space-y-1.5">
                {knocks.map(k => (
                  <li key={k.user_id} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm text-text-primary">
                      {knockNames[k.user_id] ?? t('knock_someone', { defaultValue: 'Une personne' })}
                    </span>
                    <button type="button" disabled={deciding === k.user_id}
                      onClick={() => void decide(k.user_id, true)}
                      className="rounded-full bg-primary px-3 py-1 text-xs text-white hover:opacity-90 disabled:opacity-50">
                      {t('knock_admit', { defaultValue: 'Admettre' })}
                    </button>
                    <button type="button" disabled={deciding === k.user_id}
                      onClick={() => void decide(k.user_id, false)}
                      className="rounded-full px-2 py-1 text-xs text-text-secondary hover:bg-surface-2 disabled:opacity-50">
                      {t('knock_deny', { defaultValue: 'Refuser' })}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Floating reactions */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {reactions.map(r => (
              <div key={r.id} className="absolute bottom-4 left-1/2 -translate-x-1/2 text-3xl animate-[float_4s_ease-out_forwards]">
                {r.emoji}
              </div>
            ))}
          </div>
        </div>

        {showChat && <CallChatPanel room={call.room} onClose={() => setShowChat(false)} />}
        {showPeople && (
          <PeoplePanel
            room={call.room}
            meetingTitle={roomName || call.title}
            tiles={allTiles}
            myId={myId}
            isHost={isHost}
            pinnedId={pinnedId}
            onPin={uid => setPinnedId(id => (id === uid ? null : uid))}
            onMute={muteParticipant}
            onRemove={removeParticipant}
            onClose={() => setShowPeople(false)}
          />
        )}
        {sidePanel === 'settings' && (
          <SettingsPanel
            devices={devices} micId={micId} camId={camId} speakerId={speakerId}
            onMic={id => switchDevice('audio', id)}
            onCam={id => switchDevice('video', id)}
            onSpeaker={setSpeakerId}
            onClose={() => setSidePanel(null)}
          />
        )}
        {sidePanel === 'effects' && <EffectsPanel camOff={isCamOff} onClose={() => setSidePanel(null)} />}
      </div>

      {controls}
      {confirmState && <ConfirmDialog {...confirmState} onConfirm={handleConfirm} onCancel={handleCancel} />}
      {presentMenu.pos && (
        <MenuDropdown
          pos={presentMenu.pos}
          onClose={presentMenu.close}
          theme="dark"
          items={[
            // Shown as unavailable, with its reason, as the reference does: a
            // viewer cannot end someone else's presentation.
            ...(presenter?.isLocal
              ? [{ type: 'action' as const, icon: <MonitorOff size={16} />, label: t('chat_call_stop_share'), onClick: () => { void stopScreenShare() } }]
              : [{ type: 'action' as const, icon: <MinusCircle size={16} />, label: t('chat_call_cannot_remove_presentation'), disabled: true, onClick: () => {} }]),
            { type: 'action', icon: <VideoOff size={16} />, label: t('chat_call_hide_presentation'), onClick: () => setHidePresentation(true) },
          ]}
        />
      )}
      {micMenu.pos  && <MenuDropdown pos={micMenu.pos}  onClose={micMenu.close}  items={micItems}  theme="dark" />}
      {camMenu.pos  && <MenuDropdown pos={camMenu.pos}  onClose={camMenu.close}  items={camItems}  theme="dark" />}
      {moreMenu.pos && <MenuDropdown pos={moreMenu.pos} onClose={moreMenu.close} items={moreItems} theme="dark" />}
      {/* Leaving and ending are two different things, and only the host may do
          the second: the meeting goes on without whoever leaves it. */}
      {leaveMenu.pos && (
        <MenuDropdown
          pos={leaveMenu.pos}
          onClose={leaveMenu.close}
          theme="dark"
          items={[
            { type: 'action', icon: <PhoneOff size={16} />, label: t('chat_call_leave_meeting'), onClick: () => { void hangUp() } },
            { type: 'action', icon: <CircleStop size={16} />, label: t('chat_call_end_all'), danger: true, onClick: () => { void endForEveryone() } },
          ]}
        />
      )}
      {micError && (
        <div className="absolute inset-x-0 top-3 mx-3 bg-red-600/90 text-sm px-4 py-2.5 rounded-xl text-center">{t('chat_call_mic_error')}</div>
      )}
    </div>
  )

  if (isFullscreen || isMeeting) {
    // Below the @ui overlay band (menus portal to <body> at z 9998/9999): a
    // higher stage would bury its own menus and dialogs underneath it.
    return createPortal(<div className="fixed inset-0 z-[9990] flex flex-col bg-gray-900">{callBody}</div>, document.body)
  }

  const kind = isVideo ? t('chat_video_call') : t('chat_audio_call')
  const title = allTiles.length > 1
    ? t('chat_call_title_group', { kind, count: allTiles.length })
    : t('chat_call_title_peer', { kind, name: call.title })

  return (
    <FloatingWindow
      title={title}
      defaultWidth={isVideo ? 680 : 420}
      defaultHeight={isVideo ? 520 : 320}
      minWidth={320}
      minHeight={240}
      resizable
      titleActions={
        <button onClick={toggleFullscreen} className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors" title={t('chat_call_fullscreen')}>
          <Square size={15} />
        </button>
      }
      onClose={hangUp}
    >
      {callBody}
    </FloatingWindow>
  )
}
