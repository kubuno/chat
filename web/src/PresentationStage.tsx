import { useRef, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { PinOff, Volume2, VolumeX, MoreVertical, ZoomIn, ExternalLink, Maximize2 } from 'lucide-react'
import { StageButton } from './callControls'


/**
 * The shared screen, on stage, with the two control clusters a presentation
 * carries: one over it (take it off the main screen, its sound, a menu) and
 * one in the corner (zoom, open in a window of its own, enlarge).
 */
export function PresentationStage({ name, isMine, stream, audioMuted, canToggleAudio, onRatio, onToggleAudio, onUnpin, onMenu, onFullscreen }: {
  name: string
  isMine: boolean
  stream: MediaStream | null
  audioMuted: boolean
  canToggleAudio: boolean
  /** Reports the shape of the shared screen, which sizes the frame. */
  onRatio: (ratio: number) => void
  onToggleAudio: () => void
  onUnpin: () => void
  onMenu: (e: React.MouseEvent) => void
  onFullscreen: () => void
}) {
  const { t } = useTranslation('chat')
  const ref = useRef<HTMLVideoElement>(null)
  const holderRef = useRef<HTMLDivElement>(null)
  const [zoomed, setZoomed] = useState(false)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => { if (ref.current) ref.current.srcObject = stream }, [stream])
  useEffect(() => { if (!zoomed) setPan({ x: 0, y: 0 }) }, [zoomed])

  // The shape of what is being shared, handed up so the meeting can size the
  // frame. A shared window changes size while it is shared, so it is re-read on
  // every `resize` of the video.
  useEffect(() => {
    const v = ref.current
    if (!v) return
    const read = () => { if (v.videoWidth > 0 && v.videoHeight > 0) onRatio(v.videoWidth / v.videoHeight) }
    v.addEventListener('loadedmetadata', read)
    v.addEventListener('resize', read)
    read()
    return () => { v.removeEventListener('loadedmetadata', read); v.removeEventListener('resize', read) }
  }, [stream, onRatio])

  /** Its own window: the Document Picture-in-Picture window when the browser
   *  has one, the video's picture-in-picture otherwise. */
  async function openInWindow() {
    const dpip = (window as unknown as { documentPictureInPicture?: { requestWindow: (o: { width: number; height: number }) => Promise<Window> } }).documentPictureInPicture
    const holder = holderRef.current
    const video = ref.current
    if (dpip && holder && video) {
      try {
        const win = await dpip.requestWindow({ width: 640, height: 360 })
        win.document.body.style.margin = '0'
        win.document.body.style.background = '#000'
        video.style.width = '100%'; video.style.height = '100%'
        win.document.body.append(video)
        win.addEventListener('pagehide', () => { holder.append(video) })
        return
      } catch { /* fall through to the video's own picture-in-picture */ }
    }
    try { await ref.current?.requestPictureInPicture() } catch { /* not available */ }
  }

  return (
    // The frame is already placed and sized by the meeting, to the exact shape
    // of the shared screen: nothing is cropped and no band is left around it.
    <div className="w-full h-full">
      <div
        ref={holderRef}
        className={`group relative w-full h-full rounded-2xl overflow-hidden bg-black leading-none ${zoomed ? 'cursor-grab active:cursor-grabbing' : ''}`}
        onPointerDown={e => { if (zoomed) { drag.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }; (e.target as HTMLElement).setPointerCapture(e.pointerId) } }}
        onPointerMove={e => { if (drag.current) setPan({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y }) }}
        onPointerUp={() => { drag.current = null }}
      >
        <video
          ref={ref}
          autoPlay
          playsInline
          muted={audioMuted}
          className="block w-full h-full"
          style={{ transform: `scale(${zoomed ? 2 : 1}) translate(${pan.x}px, ${pan.y}px)` }}
        />

      {/* Over the presentation */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-1 rounded-full bg-black/70 px-2 py-1.5">
        <StageButton title={t('chat_call_unpin_presentation')} onClick={onUnpin}><PinOff size={18} /></StageButton>
        <StageButton
          title={audioMuted ? t('chat_call_presentation_unmute') : t('chat_call_presentation_mute')}
          onClick={onToggleAudio}
          disabled={!canToggleAudio}
        >
          {audioMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </StageButton>
        <StageButton title={t('chat_more', { defaultValue: 'Plus' })} onClick={onMenu}><MoreVertical size={18} /></StageButton>
      </div>

      {/* In the corner */}
      <div className="absolute bottom-3 right-3 hidden group-hover:flex items-center gap-1 rounded-full bg-black/70 px-2 py-1.5">
        <StageButton title={t('chat_call_zoom')} onClick={() => setZoomed(z => !z)} active={zoomed}><ZoomIn size={18} /></StageButton>
        <StageButton title={t('chat_call_open_window')} onClick={openInWindow}><ExternalLink size={18} /></StageButton>
        <StageButton title={t('chat_call_fullscreen')} onClick={onFullscreen}><Maximize2 size={18} /></StageButton>
      </div>

      <div className="absolute bottom-2 left-3 text-sm text-white drop-shadow">
        {isMine ? t('chat_call_your_presentation') : t('chat_call_presentation_of', { name })}
      </div>
      </div>
    </div>
  )
}
