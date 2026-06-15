import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  Phone, PhoneOff, Video, VideoOff, Mic, MicOff,
  Maximize2, Minimize2, Monitor, MonitorOff,
} from 'lucide-react'
import { useChatStore, ActiveCall, IncomingCall } from './chatStore'
import { FloatingWindow } from '@ui'

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

// ── Incoming call overlay ─────────────────────────────────────────────────────
function IncomingCallOverlay({
  call,
  onAccept,
  onReject,
}: {
  call: IncomingCall
  onAccept: () => void
  onReject: () => void
}) {
  const { t } = useTranslation('chat')
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm">
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
          <button
            onClick={onReject}
            className="w-14 h-14 rounded-full bg-danger flex items-center justify-center hover:bg-red-700 transition-colors"
            title={t('chat_call_reject')}
          >
            <PhoneOff size={24} className="text-white" />
          </button>
          <button
            onClick={onAccept}
            className="w-14 h-14 rounded-full bg-green-500 flex items-center justify-center hover:bg-green-600 transition-colors"
            title={t('chat_call_accept')}
          >
            <Phone size={24} className="text-white" />
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Minimized corner widget ───────────────────────────────────────────────────
function MinimizedWidget({
  call,
  remoteVideoRef,
  localVideoRef,
  isConnected,
  duration,
  formatDuration,
  onRestore,
  onHangUp,
}: {
  call:           ActiveCall
  remoteVideoRef: React.RefObject<HTMLVideoElement | null>
  localVideoRef:  React.RefObject<HTMLVideoElement | null>
  isConnected:    boolean
  duration:       number
  formatDuration: (s: number) => string
  onRestore:      () => void
  onHangUp:       () => void
}) {
  const { t } = useTranslation('chat')
  const posRef  = useRef({ x: 0, y: 0 })
  const dragging = useRef(false)
  const origin   = useRef({ mx: 0, my: 0, wx: 0, wy: 0 })
  const elRef    = useRef<HTMLDivElement>(null)

  // Initial position: bottom-right
  useEffect(() => {
    const el = elRef.current
    if (!el) return
    posRef.current = {
      x: window.innerWidth  - el.offsetWidth  - 16,
      y: window.innerHeight - el.offsetHeight - 16,
    }
    el.style.left = `${posRef.current.x}px`
    el.style.top  = `${posRef.current.y}px`
  }, [])

  const onMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    const el = elRef.current
    if (!el) return
    dragging.current = true
    origin.current   = { mx: e.clientX, my: e.clientY, wx: posRef.current.x, wy: posRef.current.y }
    e.preventDefault()
  }

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !elRef.current) return
      const { mx, my, wx, wy } = origin.current
      const nx = Math.max(0, Math.min(window.innerWidth  - elRef.current.offsetWidth,  wx + e.clientX - mx))
      const ny = Math.max(0, Math.min(window.innerHeight - elRef.current.offsetHeight, wy + e.clientY - my))
      posRef.current = { x: nx, y: ny }
      elRef.current.style.left = `${nx}px`
      elRef.current.style.top  = `${ny}px`
    }
    const onUp = () => { dragging.current = false }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
    }
  }, [])

  return createPortal(
    <div
      ref={elRef}
      onMouseDown={onMouseDown}
      className="fixed z-[300] rounded-2xl overflow-hidden shadow-2xl bg-gray-900 text-white cursor-move select-none"
      style={{ width: 200 }}
    >
      {call.type === 'video' ? (
        <div className="relative" style={{ height: 120 }}>
          <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
          <div className="absolute bottom-1.5 left-1.5 w-14 h-10 rounded-lg overflow-hidden border border-white/20 bg-gray-800">
            <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
          </div>
          {isConnected && (
            <div className="absolute top-1.5 left-1/2 -translate-x-1/2 text-[10px] bg-black/60 px-2 py-0.5 rounded-full">
              {formatDuration(duration)}
            </div>
          )}
        </div>
      ) : (
        <>
          <video ref={remoteVideoRef} autoPlay playsInline className="hidden" />
          <video ref={localVideoRef}  autoPlay muted playsInline className="hidden" />
          <div className="flex items-center gap-2 px-3 pt-3 pb-1">
            <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center text-sm font-bold flex-shrink-0">
              {call.peerName[0]?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold truncate">{call.peerName}</p>
              <p className="text-[10px] text-gray-400">
                {isConnected ? formatDuration(duration) : t('chat_call_connecting')}
              </p>
            </div>
          </div>
        </>
      )}
      <div className="flex items-center justify-between px-2 py-2 bg-black/20">
        <button
          onClick={onRestore}
          className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
          title={t('chat_call_expand')}
        >
          <Maximize2 size={14} />
        </button>
        <p className="text-[11px] text-gray-300 truncate max-w-[80px] text-center">
          {call.participants.length > 1 ? t('chat_call_participants_count', { count: call.participants.length }) : call.peerName}
        </p>
        <button
          onClick={onHangUp}
          className="p-1.5 rounded-lg bg-danger hover:bg-red-700 transition-colors"
          title={t('chat_call_hang_up')}
        >
          <PhoneOff size={14} />
        </button>
      </div>
    </div>,
    document.body,
  )
}

// ── Active call window ────────────────────────────────────────────────────────
function ActiveCallWindow({
  call,
  onEnd,
}: {
  call: ActiveCall
  onEnd: () => void
}) {
  const { t } = useTranslation('chat')
  const sendCallSignal  = useChatStore(s => s.sendCallSignal)
  const localVideoRef   = useRef<HTMLVideoElement>(null)
  const remoteVideoRef  = useRef<HTMLVideoElement>(null)
  const pcRef           = useRef<RTCPeerConnection | null>(null)
  const localStreamRef  = useRef<MediaStream | null>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const fsContainerRef  = useRef<HTMLDivElement>(null)

  const [isMuted,      setIsMuted]      = useState(false)
  const [isCamOff,     setIsCamOff]     = useState(call.type === 'audio')
  const [isConnected,  setIsConnected]  = useState(false)
  const [duration,     setDuration]     = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isMinimized,  setIsMinimized]  = useState(false)
  const [isSharing,    setIsSharing]    = useState(false)
  const [micError,     setMicError]     = useState(false)

  // Timer
  useEffect(() => {
    if (!isConnected) return
    const t = setInterval(() => setDuration(d => d + 1), 1000)
    return () => clearInterval(t)
  }, [isConnected])

  // Sync fullscreen API state
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  const formatDuration = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  function cleanup() {
    screenStreamRef.current?.getTracks().forEach(t => t.stop())
    screenStreamRef.current = null
    localStreamRef.current?.getTracks().forEach(t => t.stop())
    localStreamRef.current = null
    pcRef.current?.close()
    pcRef.current = null
  }

  const hangUp = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    sendCallSignal(call.peerUserId, { type: 'call_end' })
    cleanup()
    onEnd()
  }, [call.peerUserId, sendCallSignal, onEnd]) // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleFullscreen() {
    if (!isFullscreen) {
      try { await fsContainerRef.current?.requestFullscreen() }
      catch { setIsFullscreen(true) }
    } else {
      if (document.fullscreenElement) await document.exitFullscreen()
      else setIsFullscreen(false)
    }
  }

  async function toggleScreenShare() {
    if (isSharing) {
      // Stop sharing — restore camera track
      screenStreamRef.current?.getTracks().forEach(t => t.stop())
      screenStreamRef.current = null
      const camTrack = localStreamRef.current?.getVideoTracks()[0]
      if (camTrack && pcRef.current) {
        const sender = pcRef.current.getSenders().find(s => s.track?.kind === 'video')
        if (sender) await sender.replaceTrack(camTrack)
      }
      if (localVideoRef.current && localStreamRef.current) {
        localVideoRef.current.srcObject = localStreamRef.current
      }
      setIsSharing(false)
    } else {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
        screenStreamRef.current = screenStream
        const screenTrack = screenStream.getVideoTracks()[0]

        // Replace video track in the peer connection
        const sender = pcRef.current?.getSenders().find(s => s.track?.kind === 'video')
        if (sender) await sender.replaceTrack(screenTrack)

        // Show screen in local PIP
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = new MediaStream([screenTrack])
        }

        // When user stops sharing from browser toolbar
        screenTrack.onended = async () => {
          screenStreamRef.current = null
          const cam = localStreamRef.current?.getVideoTracks()[0]
          if (cam && pcRef.current) {
            const s = pcRef.current.getSenders().find(s2 => s2.track?.kind === 'video')
            if (s) await s.replaceTrack(cam)
          }
          if (localVideoRef.current && localStreamRef.current) {
            localVideoRef.current.srcObject = localStreamRef.current
          }
          setIsSharing(false)
        }
        setIsSharing(true)
      } catch {
        // User cancelled or browser denied — ignore
      }
    }
  }

  // Listen for signaling events
  useEffect(() => {
    const handler = (e: Event) => {
      const { signal } = (e as CustomEvent).detail
      const pc = pcRef.current
      if (!pc) return
      if (signal.type === 'call_answer' && call.isInitiator) {
        pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp }).catch(console.error)
      } else if (signal.type === 'ice_candidate' && signal.candidate) {
        pc.addIceCandidate(new RTCIceCandidate(signal.candidate)).catch(() => {})
      } else if (signal.type === 'call_end') {
        cleanup()
        onEnd()
      }
    }
    window.addEventListener('chat:call_signal', handler)
    return () => window.removeEventListener('chat:call_signal', handler)
  }, [call.isInitiator, onEnd]) // eslint-disable-line react-hooks/exhaustive-deps

  // Set up WebRTC
  useEffect(() => {
    let cancelled = false

    async function setup() {
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: call.type === 'video' })
      } catch {
        try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }) }
        catch { setMicError(true); setTimeout(() => { onEnd() }, 2500); return }
      }
      if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }

      localStreamRef.current = stream
      if (localVideoRef.current) localVideoRef.current.srcObject = stream

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
      pcRef.current = pc
      stream.getTracks().forEach(track => pc.addTrack(track, stream))

      pc.ontrack = ev => {
        if (remoteVideoRef.current && ev.streams[0]) remoteVideoRef.current.srcObject = ev.streams[0]
      }
      pc.onicecandidate = ev => {
        if (ev.candidate) sendCallSignal(call.peerUserId, { type: 'ice_candidate', candidate: ev.candidate.toJSON() })
      }
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') setIsConnected(true)
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') { cleanup(); onEnd() }
      }

      if (call.isInitiator) {
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        sendCallSignal(call.peerUserId, { type: 'call_offer', call_type: call.type, sdp: offer.sdp, from_name: '' })
      } else {
        const storedOffer = (window as unknown as Record<string, unknown>)['__pendingCallOffer__'] as RTCSessionDescriptionInit | undefined
        if (storedOffer) {
          await pc.setRemoteDescription(storedOffer)
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          sendCallSignal(call.peerUserId, { type: 'call_answer', sdp: answer.sdp })
        }
      }
    }

    setup().catch(console.error)
    return () => { cancelled = true; cleanup() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleMute() {
    const track = localStreamRef.current?.getAudioTracks()[0]
    if (track) { track.enabled = !track.enabled; setIsMuted(!track.enabled) }
  }

  function toggleCamera() {
    const track = localStreamRef.current?.getVideoTracks()[0]
    if (track) { track.enabled = !track.enabled; setIsCamOff(!track.enabled) }
  }

  // ── Minimized corner widget ───────────────────────────────────────────────
  if (isMinimized) {
    return (
      <MinimizedWidget
        call={call}
        remoteVideoRef={remoteVideoRef}
        localVideoRef={localVideoRef}
        isConnected={isConnected}
        duration={duration}
        formatDuration={formatDuration}
        onRestore={() => setIsMinimized(false)}
        onHangUp={hangUp}
      />
    )
  }

  // ── Controls bar (shared between windowed and fullscreen) ─────────────────
  const controls = (
    <div className="flex items-center justify-center gap-3 py-4 bg-black/40 backdrop-blur-sm flex-shrink-0">
      <button
        onClick={toggleMute}
        className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors
          ${isMuted ? 'bg-red-600 hover:bg-red-700' : 'bg-white/20 hover:bg-white/30'}`}
        title={isMuted ? t('chat_call_unmute') : t('chat_call_mute')}
      >
        {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
      </button>

      {call.type === 'video' && (
        <>
          <button
            onClick={toggleCamera}
            className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors
              ${isCamOff ? 'bg-red-600 hover:bg-red-700' : 'bg-white/20 hover:bg-white/30'}`}
            title={isCamOff ? t('chat_call_camera_on') : t('chat_call_camera_off')}
          >
            {isCamOff ? <VideoOff size={18} /> : <Video size={18} />}
          </button>

          <button
            onClick={toggleScreenShare}
            className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors
              ${isSharing ? 'bg-blue-600 hover:bg-blue-700' : 'bg-white/20 hover:bg-white/30'}`}
            title={isSharing ? t('chat_call_stop_share') : t('chat_call_share_screen')}
          >
            {isSharing ? <MonitorOff size={18} /> : <Monitor size={18} />}
          </button>
        </>
      )}

      {/* Minimize to corner */}
      <button
        onClick={() => setIsMinimized(true)}
        className="w-11 h-11 rounded-full flex items-center justify-center bg-white/20 hover:bg-white/30 transition-colors"
        title={t('chat_call_minimize')}
      >
        <Minimize2 size={18} />
      </button>

      <button
        onClick={hangUp}
        className="w-14 h-14 rounded-full bg-danger flex items-center justify-center hover:bg-red-700 transition-colors"
        title={t('chat_call_hang_up')}
      >
        <PhoneOff size={22} />
      </button>
    </div>
  )

  // ── Call body (shared between windowed and fullscreen) ────────────────────
  const callBody = (
    <div ref={fsContainerRef} className="flex flex-col h-full bg-gray-900 text-white">
      {call.type === 'video' && (
        <div className="relative flex-1 bg-black overflow-hidden">
          <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />

          {/* Local PIP */}
          <div className="absolute bottom-3 right-3 w-32 h-24 rounded-xl overflow-hidden border-2 border-white/30 bg-gray-800 shadow-lg">
            <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
          </div>

          {/* Partage d'écran badge */}
          {isSharing && (
            <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-blue-600/90 text-xs px-2.5 py-1 rounded-full backdrop-blur-sm">
              <Monitor size={12} /> {t('chat_call_sharing')}
            </div>
          )}

          {/* Duration */}
          {isConnected && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 text-xs bg-black/60 px-3 py-1 rounded-full backdrop-blur-sm">
              {formatDuration(duration)}
            </div>
          )}

          {/* Connecting */}
          {!isConnected && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60">
              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-blue-600 flex items-center justify-center text-2xl mx-auto mb-3 animate-pulse">
                  {call.peerName[0]?.toUpperCase()}
                </div>
                <p className="text-sm text-gray-300">
                  {call.isInitiator ? t('chat_call_ringing') : t('chat_call_connecting')}
                </p>
              </div>
            </div>
          )}

          {/* Exit fullscreen overlay button */}
          {isFullscreen && (
            <button
              onClick={toggleFullscreen}
              className="absolute top-3 right-3 p-2 rounded-lg bg-black/50 text-white hover:bg-black/70 transition-colors backdrop-blur-sm"
              title={t('chat_call_exit_fullscreen')}
            >
              <Minimize2 size={18} />
            </button>
          )}
        </div>
      )}

      {call.type === 'audio' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="w-24 h-24 rounded-full bg-blue-600 flex items-center justify-center text-4xl font-bold animate-pulse">
            {call.peerName[0]?.toUpperCase()}
          </div>
          <p className="font-semibold text-lg">{call.peerName}</p>
          <p className="text-gray-400 text-sm">
            {isConnected ? formatDuration(duration) : (call.isInitiator ? t('chat_call_ringing') : t('chat_call_connecting'))}
          </p>
          <video ref={remoteVideoRef} autoPlay playsInline className="hidden" />
          <video ref={localVideoRef}  autoPlay muted playsInline className="hidden" />
        </div>
      )}

      {controls}

      {/* Mic access error */}
      {micError && (
        <div className="absolute inset-x-0 top-3 mx-3 bg-red-600/90 text-white text-sm px-4 py-2.5 rounded-xl text-center backdrop-blur-sm">
          {t('chat_call_mic_error')}
        </div>
      )}
    </div>
  )

  // ── Fullscreen mode ───────────────────────────────────────────────────────
  if (isFullscreen) {
    return createPortal(
      <div className="fixed inset-0 z-[500] flex flex-col bg-gray-900">
        {callBody}
      </div>,
      document.body,
    )
  }

  // ── Windowed mode (FloatingWindow) ────────────────────────────────────────
  const titleActions = call.type === 'video' ? (
    <button
      onClick={toggleFullscreen}
      className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors"
      title={t('chat_call_fullscreen')}
    >
      <Maximize2 size={15} />
    </button>
  ) : undefined

  const callKind = call.type === 'video' ? t('chat_video_call') : t('chat_audio_call')
  const callTitle = call.participants.length > 1
    ? t('chat_call_title_group', { kind: callKind, count: call.participants.length })
    : t('chat_call_title_peer', { kind: callKind, name: call.peerName })

  return (
    <FloatingWindow
      title={callTitle}
      defaultWidth={call.type === 'video' ? 520 : 360}
      defaultHeight={call.type === 'video' ? 420 : 280}
      minWidth={280}
      minHeight={call.type === 'video' ? 240 : 180}
      resizable
      titleActions={titleActions}
      onClose={hangUp}
    >
      {callBody}
    </FloatingWindow>
  )
}

// ── Root call manager ─────────────────────────────────────────────────────────
export default function CallManager() {
  const incomingCall   = useChatStore(s => s.incomingCall)
  const activeCall     = useChatStore(s => s.activeCall)
  const { setIncomingCall, setActiveCall } = useChatStore()
  const sendCallSignal = useChatStore(s => s.sendCallSignal)

  function acceptCall() {
    if (!incomingCall) return
    ;(window as unknown as Record<string, unknown>)['__pendingCallOffer__'] = incomingCall.sdpOffer
    setActiveCall({
      convId:       incomingCall.convId,
      peerUserId:   incomingCall.fromUserId,
      peerName:     incomingCall.fromName,
      type:         incomingCall.type,
      isInitiator:  false,
      participants: [{ userId: incomingCall.fromUserId, name: incomingCall.fromName }],
    })
    setIncomingCall(null)
  }

  function rejectCall() {
    if (!incomingCall) return
    sendCallSignal(incomingCall.fromUserId, { type: 'call_end' })
    setIncomingCall(null)
  }

  return (
    <>
      {incomingCall && (
        <IncomingCallOverlay
          call={incomingCall}
          onAccept={acceptCall}
          onReject={rejectCall}
        />
      )}
      {activeCall && (
        <ActiveCallWindow call={activeCall} onEnd={() => setActiveCall(null)} />
      )}
    </>
  )
}

// ── Hook for initiating calls ─────────────────────────────────────────────────
export function useInitiateCall() {
  const setActiveCall = useChatStore(s => s.setActiveCall)
  return function startCall(
    peerUserId: string,
    peerName:   string,
    convId:     string,
    type:       'audio' | 'video',
    isFirst     = true,
  ) {
    if (!isFirst) {
      // Additional participant in a group call: send invite but don't open a new window
      // The CallWindow handles sending offers to additional participants via sendCallSignal
      useChatStore.getState().sendCallSignal(peerUserId, {
        type:      'call_invite',
        call_type: type,
        conv_id:   convId,
      })
      return
    }
    setActiveCall({
      convId,
      peerUserId,
      peerName,
      type,
      isInitiator: true,
      participants: [{ userId: peerUserId, name: peerName }],
    })
  }
}
