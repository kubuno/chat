import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  Phone, PhoneOff, Video, VideoOff, Mic, MicOff,
  Maximize2, Minimize2, Monitor, MonitorOff, Hand, Smile, MessageSquare, Send, X,
} from 'lucide-react'
import { useChatStore, ActiveCall, IncomingCall, CallParticipant, encodeTextMessage } from './chatStore'
import { chatApi } from './api'
import { useAuthStore } from '@kubuno/sdk'
import { FloatingWindow } from '@ui'

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

const CALL_REACTIONS = ['👍', '❤️', '😂', '🎉', '👏', '😮']

// Signal envelope relayed peer-to-peer through the chat WebSocket hub. Every
// signal carries the `room` (conversation id) so a client in several rooms can
// disambiguate. SDP/ICE are targeted; ring/join/leave/reactions are broadcast.
interface CallSignal {
  type: 'call_ring' | 'call_join' | 'call_present' | 'call_offer' | 'call_answer'
      | 'call_ice' | 'call_leave' | 'call_state' | 'call_reaction'
  room: string
  call_type?: 'audio' | 'video'
  from_name?: string
  sdp?: string
  candidate?: RTCIceCandidateInit
  hand?: boolean
  muted?: boolean
  cam_off?: boolean
  emoji?: string
}

// ── Incoming call overlay ─────────────────────────────────────────────────────
function IncomingCallOverlay({ call, onAccept, onReject }: {
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
            {call.type === 'video' ? t('chat_incoming_video_call') : t('chat_incoming_audio_call')}
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

// A single participant tile (local or remote).
interface Tile {
  userId:    string
  name:      string
  stream:    MediaStream | null
  isLocal:   boolean
  connected: boolean
  hand:      boolean
  muted:     boolean
  camOff:    boolean
}

function VideoTile({ tile, isVideo }: { tile: Tile; isVideo: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (ref.current && tile.stream) ref.current.srcObject = tile.stream
  }, [tile.stream])
  const showVideo = isVideo && tile.stream && !tile.camOff
  return (
    <div className="relative bg-gray-800 rounded-xl overflow-hidden flex items-center justify-center min-h-0">
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={tile.isLocal}
        className={`w-full h-full object-cover ${showVideo ? '' : 'hidden'}`}
      />
      {!showVideo && (
        <div className="w-16 h-16 rounded-full bg-blue-600 flex items-center justify-center text-2xl font-bold text-white">
          {tile.name[0]?.toUpperCase()}
        </div>
      )}
      <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 text-[11px] bg-black/60 text-white px-2 py-0.5 rounded-full max-w-[80%]">
        {tile.muted ? <MicOff size={11} className="text-red-400" /> : <Mic size={11} />}
        <span className="truncate">{tile.name}{tile.isLocal ? ' ·' : ''}</span>
      </div>
      {tile.hand && (
        <div className="absolute top-1.5 right-1.5 text-lg animate-bounce">✋</div>
      )}
      {!tile.connected && !tile.isLocal && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-xs text-gray-200">…</div>
      )}
    </div>
  )
}

// ── Active call window (full mesh) ────────────────────────────────────────────
function ActiveCallWindow({ call, onEnd }: { call: ActiveCall; onEnd: () => void }) {
  const { t } = useTranslation('chat')
  const sendCallSignal = useChatStore(s => s.sendCallSignal)
  const myId   = useAuthStore(s => s.user?.id) ?? ''
  const myName = useAuthStore(s => s.user?.display_name || s.user?.username) ?? 'Moi'

  const localStreamRef  = useRef<MediaStream | null>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const fsContainerRef  = useRef<HTMLDivElement>(null)
  const membersRef      = useRef<string[]>([])         // other conv members (for broadcast)
  const isVideo = call.type === 'video'

  // Mesh peer table. Kept in a ref (mutable), mirrored into `tiles` for render.
  interface Peer { pc: RTCPeerConnection; name: string; stream: MediaStream | null; pendingIce: RTCIceCandidateInit[]; hand: boolean; muted: boolean; camOff: boolean; connected: boolean }
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
  const [micError,    setMicError]     = useState(false)
  const [showChat,    setShowChat]     = useState(false)
  const [reactions,   setReactions]    = useState<{ id: number; emoji: string; name: string }[]>([])
  const [showReactionBar, setShowReactionBar] = useState(false)

  const amOfferer = useCallback((other: string) => myId < other, [myId])

  // Rebuild the render tiles from the peer table + local stream.
  const syncTiles = useCallback(() => {
    const remote: Tile[] = Array.from(peersRef.current.entries()).map(([uid, p]) => ({
      userId: uid, name: p.name, stream: p.stream, isLocal: false, connected: p.connected, hand: p.hand, muted: p.muted, camOff: p.camOff,
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
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    const peer: Peer = { pc, name: name || uid.slice(0, 6), stream: null, pendingIce: [], hand: false, muted: false, camOff: false, connected: false }
    localStreamRef.current?.getTracks().forEach(tr => pc.addTrack(tr, localStreamRef.current!))
    pc.ontrack = ev => { peer.stream = ev.streams[0] ?? new MediaStream([ev.track]); syncTiles() }
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

  const removePeer = useCallback((uid: string) => {
    const p = peersRef.current.get(uid)
    if (p) { try { p.pc.close() } catch { /* noop */ } peersRef.current.delete(uid) }
    syncTiles()
  }, [syncTiles])

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

      switch (signal.type) {
        case 'call_join': {
          // A newcomer announced themselves: tell them we're here, then connect.
          send(fromUserId, { type: 'call_present', from_name: myName })
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
        case 'call_state': {
          const peer = peersRef.current.get(fromUserId)
          if (peer) {
            if (signal.hand    !== undefined) peer.hand   = signal.hand
            if (signal.muted   !== undefined) peer.muted  = signal.muted
            if (signal.cam_off !== undefined) peer.camOff = signal.cam_off
            syncTiles()
          }
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
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: isVideo })
      } catch {
        try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }) }
        catch { setMicError(true); setTimeout(onEnd, 2500); return }
      }
      if (cancelled) { stream.getTracks().forEach(tr => tr.stop()); return }
      localStreamRef.current = stream
      setLocalStream(stream)

      // Fetch the room members so we can ring/announce to everyone.
      try {
        const res = await chatApi.getConversation(call.room)
        membersRef.current = (res.members ?? []).map(m => m.user_id).filter(id => id !== myId)
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

  const hangUp = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    onEnd()
  }, [onEnd])

  function toggleMute() {
    const track = localStreamRef.current?.getAudioTracks()[0]
    if (track) { track.enabled = !track.enabled; setIsMuted(!track.enabled); broadcast({ type: 'call_state', muted: !track.enabled }) }
  }
  function toggleCamera() {
    const track = localStreamRef.current?.getVideoTracks()[0]
    if (track) { track.enabled = !track.enabled; setIsCamOff(!track.enabled); broadcast({ type: 'call_state', cam_off: !track.enabled }) }
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

  // Replace the video track on every peer (screen share / camera swap).
  async function replaceVideoTrack(track: MediaStreamTrack | null) {
    peersRef.current.forEach(p => {
      const sender = p.pc.getSenders().find(s => s.track?.kind === 'video')
      if (sender && track) sender.replaceTrack(track).catch(() => {})
    })
  }

  async function toggleScreenShare() {
    if (isSharing) {
      screenStreamRef.current?.getTracks().forEach(tr => tr.stop())
      screenStreamRef.current = null
      const cam = localStreamRef.current?.getVideoTracks()[0] ?? null
      await replaceVideoTrack(cam)
      setIsSharing(false)
    } else {
      try {
        const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
        screenStreamRef.current = screen
        const track = screen.getVideoTracks()[0]
        await replaceVideoTrack(track)
        track.onended = async () => {
          screenStreamRef.current = null
          await replaceVideoTrack(localStreamRef.current?.getVideoTracks()[0] ?? null)
          setIsSharing(false)
        }
        setIsSharing(true)
      } catch { /* cancelled */ }
    }
  }

  const localTile: Tile = {
    userId: myId, name: myName, stream: localStream, isLocal: true, connected: true, hand: handUp, muted: isMuted, camOff: isCamOff,
  }
  const allTiles = [localTile, ...tiles]
  const cols = allTiles.length <= 1 ? 1 : allTiles.length <= 4 ? 2 : 3

  // ── Minimized corner widget ─────────────────────────────────────────────────
  if (isMinimized) {
    return createPortal(
      <div className="fixed bottom-4 right-4 z-[2147483300] rounded-2xl overflow-hidden shadow-2xl bg-gray-900 text-white" style={{ width: 220 }}>
        <div className="grid gap-0.5 p-0.5" style={{ gridTemplateColumns: `repeat(${Math.min(2, allTiles.length)}, 1fr)`, height: 130 }}>
          {allTiles.slice(0, 4).map(tl => <VideoTile key={tl.userId} tile={tl} isVideo={isVideo} />)}
        </div>
        <div className="flex items-center justify-between px-2 py-2 bg-black/30">
          <button onClick={() => setIsMinimized(false)} className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20" title={t('chat_call_expand')}>
            <Maximize2 size={14} />
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

  const controls = (
    <div className="flex items-center justify-center gap-2.5 py-4 bg-black/40 backdrop-blur-sm flex-shrink-0 relative">
      <button onClick={toggleMute} className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${isMuted ? 'bg-red-600 hover:bg-red-700' : 'bg-white/20 hover:bg-white/30'}`} title={isMuted ? t('chat_call_unmute') : t('chat_call_mute')}>
        {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
      </button>
      {isVideo && (
        <>
          <button onClick={toggleCamera} className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${isCamOff ? 'bg-red-600 hover:bg-red-700' : 'bg-white/20 hover:bg-white/30'}`} title={isCamOff ? t('chat_call_camera_on') : t('chat_call_camera_off')}>
            {isCamOff ? <VideoOff size={18} /> : <Video size={18} />}
          </button>
          <button onClick={toggleScreenShare} className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${isSharing ? 'bg-blue-600 hover:bg-blue-700' : 'bg-white/20 hover:bg-white/30'}`} title={isSharing ? t('chat_call_stop_share') : t('chat_call_share_screen')}>
            {isSharing ? <MonitorOff size={18} /> : <Monitor size={18} />}
          </button>
        </>
      )}
      <button onClick={toggleHand} className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${handUp ? 'bg-amber-500 hover:bg-amber-600' : 'bg-white/20 hover:bg-white/30'}`} title={t('chat_call_raise_hand', { defaultValue: 'Lever la main' })}>
        <Hand size={18} />
      </button>
      <div className="relative">
        <button onClick={() => setShowReactionBar(v => !v)} className="w-11 h-11 rounded-full flex items-center justify-center bg-white/20 hover:bg-white/30 transition-colors" title={t('chat_call_react', { defaultValue: 'Réagir' })}>
          <Smile size={18} />
        </button>
        {showReactionBar && (
          <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 flex gap-1 bg-gray-800 rounded-full px-2 py-1.5 shadow-lg">
            {CALL_REACTIONS.map(e => (
              <button key={e} onClick={() => sendReaction(e)} className="text-xl hover:scale-125 transition-transform">{e}</button>
            ))}
          </div>
        )}
      </div>
      <button onClick={() => setShowChat(v => !v)} className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${showChat ? 'bg-blue-600' : 'bg-white/20 hover:bg-white/30'}`} title={t('chat_call_chat', { defaultValue: 'Messagerie' })}>
        <MessageSquare size={18} />
      </button>
      <button onClick={() => setIsMinimized(true)} className="w-11 h-11 rounded-full flex items-center justify-center bg-white/20 hover:bg-white/30 transition-colors" title={t('chat_call_minimize')}>
        <Minimize2 size={18} />
      </button>
      <button onClick={hangUp} className="w-14 h-14 rounded-full bg-danger flex items-center justify-center hover:bg-red-700 transition-colors" title={t('chat_call_hang_up')}>
        <PhoneOff size={22} />
      </button>
    </div>
  )

  const callBody = (
    <div ref={fsContainerRef} className="flex flex-col h-full bg-gray-900 text-white relative">
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 relative p-2 min-h-0">
          <div className="grid gap-2 h-full" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {allTiles.map(tl => <VideoTile key={tl.userId} tile={tl} isVideo={isVideo} />)}
          </div>
          {/* Floating reactions */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {reactions.map(r => (
              <div key={r.id} className="absolute bottom-4 left-1/2 -translate-x-1/2 text-3xl animate-[float_4s_ease-out_forwards]">
                {r.emoji}
              </div>
            ))}
          </div>
          {anyConnected && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 text-xs bg-black/60 px-3 py-1 rounded-full">{formatDuration(duration)}</div>
          )}
          {!anyConnected && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 text-xs bg-black/60 px-3 py-1 rounded-full">
              {call.isInitiator ? t('chat_call_ringing') : t('chat_call_connecting')}
            </div>
          )}
          {isFullscreen && (
            <button onClick={toggleFullscreen} className="absolute top-3 right-3 p-2 rounded-lg bg-black/50 hover:bg-black/70" title={t('chat_call_exit_fullscreen')}>
              <Minimize2 size={18} />
            </button>
          )}
        </div>
        {showChat && <CallChatPanel room={call.room} onClose={() => setShowChat(false)} />}
      </div>
      {controls}
      {micError && (
        <div className="absolute inset-x-0 top-3 mx-3 bg-red-600/90 text-sm px-4 py-2.5 rounded-xl text-center">{t('chat_call_mic_error')}</div>
      )}
    </div>
  )

  if (isFullscreen) {
    return createPortal(<div className="fixed inset-0 z-[2147483300] flex flex-col bg-gray-900">{callBody}</div>, document.body)
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
          <Maximize2 size={15} />
        </button>
      }
      onClose={hangUp}
    >
      {callBody}
    </FloatingWindow>
  )
}

// In-call chat side panel — posts to the underlying conversation.
function CallChatPanel({ room, onClose }: { room: string; onClose: () => void }) {
  const { t } = useTranslation('chat')
  const messages = useChatStore(s => s.messages[room]) ?? []
  const appendMessage = useChatStore(s => s.appendMessage)
  const [text, setText] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => { bottomRef.current?.scrollIntoView() }, [messages.length])

  async function send() {
    const trimmed = text.trim()
    if (!trimmed) return
    setText('')
    const { encrypted_data, nonce } = encodeTextMessage(trimmed)
    try {
      const msg = await chatApi.sendMessage(room, { encrypted_data, nonce })
      appendMessage(room, { ...msg, plaintext: trimmed })
    } catch { /* noop */ }
  }

  return (
    <div className="w-64 flex-shrink-0 bg-white text-gray-900 flex flex-col border-l border-gray-200">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200">
        <span className="text-sm font-medium">{t('chat_call_chat', { defaultValue: 'Messagerie' })}</span>
        <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X className="w-4 h-4" /></button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5 text-sm">
        {messages.slice(-50).map(m => (
          <div key={m.id} className="break-words"><span className="text-gray-400 text-xs">{m.plaintext ? '' : ''}</span>{m.plaintext}</div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="flex items-center gap-1 p-2 border-t border-gray-200">
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send() }}
          placeholder={t('chat_message_placeholder')}
          className="flex-1 text-sm border border-gray-200 rounded-full px-3 py-1.5 focus:outline-none focus:border-blue-400"
        />
        <button onClick={send} className="p-2 bg-blue-600 text-white rounded-full hover:bg-blue-700"><Send className="w-4 h-4" /></button>
      </div>
    </div>
  )
}

// ── Root call manager ─────────────────────────────────────────────────────────
export default function CallManager() {
  const incomingCall = useChatStore(s => s.incomingCall)
  const activeCall   = useChatStore(s => s.activeCall)
  const { setIncomingCall, setActiveCall } = useChatStore()

  function acceptCall() {
    if (!incomingCall) return
    setActiveCall({
      room:        incomingCall.room,
      title:       incomingCall.fromName,
      type:        incomingCall.type,
      isInitiator: false,
      ring:        [],
    })
    setIncomingCall(null)
  }
  function rejectCall() { setIncomingCall(null) }

  return (
    <>
      {incomingCall && !activeCall && (
        <IncomingCallOverlay call={incomingCall} onAccept={acceptCall} onReject={rejectCall} />
      )}
      {activeCall && <ActiveCallWindow call={activeCall} onEnd={() => setActiveCall(null)} />}
    </>
  )
}

// ── Hook for initiating calls ─────────────────────────────────────────────────
export function useInitiateCall() {
  const setActiveCall = useChatStore(s => s.setActiveCall)
  return function startCall(room: string, title: string, type: 'audio' | 'video', ring: CallParticipant[]) {
    setActiveCall({ room, title, type, isInitiator: true, ring })
  }
}
