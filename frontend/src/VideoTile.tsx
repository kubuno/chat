import { useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Mic, MicOff, Pin, PinOff } from 'lucide-react'
import { Tile, tileHue } from './callShared'


/**
 * The badge worn by whoever is speaking: three bars that follow their voice.
 * It reads the level straight from an animation frame and writes to the DOM,
 * so a moving voice never re-renders the meeting.
 */
function SpeakingBars({ level }: { level: () => number }) {
  const bars = [useRef<HTMLSpanElement>(null), useRef<HTMLSpanElement>(null), useRef<HTMLSpanElement>(null)]
  useEffect(() => {
    let raf = 0
    // Each bar answers the voice a little differently, so the three of them
    // read as a level meter rather than one block going up and down.
    const shape = [0.62, 1, 0.78]
    const loop = () => {
      const v = Math.max(0, Math.min(1, level()))
      bars.forEach((ref, i) => {
        const el = ref.current
        if (el) el.style.height = `${Math.round(5 + v * shape[i] * 10)}px`
      })
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [level]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <span className="flex items-center justify-center gap-[2px] w-7 h-7 rounded-full bg-primary">
      {bars.map((ref, i) => (
        <span key={i} ref={ref} className="w-[3px] rounded-full bg-white" style={{ height: 5 }} />
      ))}
    </span>
  )
}


export function VideoTile({ tile, isVideo, pinned, onPin, asAvatar, compact, level }: { tile: Tile; isVideo: boolean; pinned?: boolean; onPin?: () => void; asAvatar?: boolean; compact?: boolean; level?: () => number }) {
  const { t } = useTranslation('chat')
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (ref.current && tile.stream) ref.current.srcObject = tile.stream
  }, [tile.stream])
  // A tile shows video only when its stream actually carries a live video
  // track: in a call that turned to video, a participant who kept their
  // camera closed still gets the avatar, not a black frame.
  const hasVideoTrack = !!tile.stream?.getVideoTracks().some(tr => tr.readyState === 'live')
  const showVideo = isVideo && hasVideoTrack && !tile.camOff && !asAvatar
  const hue = tileHue(tile.userId)
  return (
    <div
      className={`group relative w-full h-full rounded-2xl overflow-hidden flex items-center justify-center ${pinned && !tile.speaking ? 'ring-2 ring-primary' : ''}`}
      style={{ background: showVideo ? '#3c4043' : `hsl(${hue} 26% 24%)` }}
    >
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={tile.isLocal}
        className={`w-full h-full object-cover ${showVideo ? '' : 'hidden'}`}
      />
      {/* Camera off: the profile picture sits in the middle of the tile, in a
          circle sized by the tile but capped on a large one. The initial is
          sized from the circle itself, through container units. */}
      {!showVideo && (
        <div
          className="aspect-square rounded-full overflow-hidden flex items-center justify-center font-medium text-white select-none"
          style={{ width: 'min(45%, 150px)', containerType: 'size', background: `hsl(${hue} 42% 46%)` }}
        >
          {tile.avatarUrl
            ? <img src={tile.avatarUrl} alt="" className="w-full h-full object-cover" />
            : <span style={{ fontSize: '42cqmin' }}>{tile.name[0]?.toUpperCase()}</span>}
        </div>
      )}
      {/* Name and microphone, bottom-left: the mic state is always shown, not
          only when muted, so a tile says at a glance who can be heard. */}
      <div className={`absolute bottom-2 left-3 flex items-center gap-1.5 text-white drop-shadow max-w-[85%] ${compact ? 'text-xs' : 'text-sm'}`}>
        {tile.muted
          ? <MicOff size={compact ? 12 : 14} className="text-red-400 flex-shrink-0" />
          : <Mic size={compact ? 12 : 14} className="flex-shrink-0" />}
        <span className="truncate">{tile.name}</span>
      </div>
      {/* Hover control: pin this tile */}
      {onPin && (
        <button
          onClick={onPin}
          title={pinned ? t('chat_call_unpin') : t('chat_call_pin')}
          className="absolute top-2 left-2 w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 items-center justify-center hidden group-hover:flex"
        >
          {pinned ? <PinOff size={14} /> : <Pin size={14} />}
        </button>
      )}
      {/* Speaking: a blue edge drawn inside the tile, so nothing can clip it,
          and a very faint blue veil over the whole tile. */}
      {tile.speaking && (
        <div className="pointer-events-none absolute inset-0 rounded-2xl border-[3px] border-primary bg-primary/10" />
      )}
      {tile.speaking && level && (
        <div className="absolute top-2 right-2">
          <SpeakingBars level={level} />
        </div>
      )}
      {tile.hand && (
        <div className="absolute top-1.5 right-1.5 text-lg animate-bounce">✋</div>
      )}
      {!tile.connected && !tile.isLocal && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-xs text-gray-200">…</div>
      )}
    </div>
  )
}
