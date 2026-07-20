import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, Download, Play, Pause, AlertCircle, Loader2, Mic } from 'lucide-react'
import { MediaPayload, chatApi } from './api'
import { decryptToBlob } from './crypto/media'

interface Props {
  media: MediaPayload
  isOwn: boolean
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// Decrypt-on-mount hook: fetches the ciphertext, decrypts it client-side, and
// exposes a typed object URL (revoked on unmount).
function useDecryptedUrl(media: MediaPayload, enabled: boolean) {
  const [url, setUrl]     = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let revoked = false
    let objectUrl: string | null = null
    ;(async () => {
      try {
        const cipher = await chatApi.downloadMedia(media.media_id)
        const blob   = await decryptToBlob(cipher, media.key, media.iv, media.mime)
        if (revoked) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      } catch {
        if (!revoked) setError(true)
      }
    })()
    return () => {
      revoked = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [media.media_id, media.key, media.iv, media.mime, enabled])

  return { url, error }
}

export default function MediaContent({ media, isOwn }: Props) {
  const { t } = useTranslation('chat')

  // Files are decrypted lazily (only when the user clicks download); media that
  // renders inline (image/video/audio/voice) decrypts immediately.
  const inline = media.kind !== 'file'
  const { url, error } = useDecryptedUrl(media, inline)
  const [downloading, setDownloading] = useState(false)

  async function download() {
    setDownloading(true)
    try {
      const cipher = await chatApi.downloadMedia(media.media_id)
      const blob   = await decryptToBlob(cipher, media.key, media.iv, media.mime)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = media.name || 'fichier'
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
    } catch { /* ignore */ }
    finally { setDownloading(false) }
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-xs opacity-70 py-1">
        <AlertCircle className="w-4 h-4" />
        {t('chat_media_error', { defaultValue: 'Média indisponible' })}
      </div>
    )
  }

  // ── Voice message ────────────────────────────────────────────────────────────
  if (media.voice) {
    return <VoicePlayer url={url} media={media} isOwn={isOwn} />
  }

  // ── Sticker ──────────────────────────────────────────────────────────────────
  // Rendered bare (MessageBubble drops the bubble around it): no frame, no
  // lightbox — transparency is the whole point.
  if (media.kind === 'sticker') {
    return (
      <div className="w-[140px] h-[140px]">
        {url
          ? <img src={url} alt="" className="w-full h-full object-contain" />
          : <div className="w-full h-full rounded-lg bg-black/5 animate-pulse" />}
      </div>
    )
  }

  // ── GIF ──────────────────────────────────────────────────────────────────────
  if (media.kind === 'gif') {
    return (
      <div className="max-w-[280px] rounded-xl overflow-hidden bg-black/5">
        {url
          ? <img src={url} alt={media.name} className="w-full h-auto block" />
          : <div className="w-[240px] h-[180px] animate-pulse" />}
      </div>
    )
  }

  // ── Image ────────────────────────────────────────────────────────────────────
  if (media.kind === 'image') {
    return (
      <ImageContent url={url} media={media} />
    )
  }

  // ── Video ────────────────────────────────────────────────────────────────────
  if (media.kind === 'video') {
    return url ? (
      <video src={url} controls className="rounded-lg max-w-full max-h-[360px]" preload="metadata" />
    ) : <MediaSkeleton />
  }

  // ── Audio (non-voice) ────────────────────────────────────────────────────────
  if (media.kind === 'audio') {
    return (
      <div className="min-w-[220px]">
        <div className="text-xs mb-1 truncate opacity-80">{media.name}</div>
        {url ? <audio src={url} controls className="w-full h-9" /> : <MediaSkeleton small />}
      </div>
    )
  }

  // ── Generic file ─────────────────────────────────────────────────────────────
  return (
    <button
      onClick={download}
      disabled={downloading}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg min-w-[200px] text-left transition-colors ${
        isOwn ? 'bg-blue-500/40 hover:bg-blue-500/60' : 'bg-gray-100 hover:bg-gray-200'
      }`}
    >
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${isOwn ? 'bg-white/20' : 'bg-white'}`}>
        <FileText className={`w-5 h-5 ${isOwn ? 'text-white' : 'text-blue-600'}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{media.name}</div>
        <div className="text-[11px] opacity-70">{formatSize(media.size)}</div>
      </div>
      {downloading
        ? <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
        : <Download className="w-4 h-4 flex-shrink-0 opacity-70" />}
    </button>
  )
}

function MediaSkeleton({ small }: { small?: boolean }) {
  return (
    <div className={`flex items-center justify-center bg-black/5 rounded-lg ${small ? 'h-9 w-[220px]' : 'h-40 w-60'}`}>
      <Loader2 className="w-5 h-5 animate-spin opacity-40" />
    </div>
  )
}

// Image with click-to-zoom lightbox overlay.
function ImageContent({ url, media }: { url: string | null; media: MediaPayload }) {
  const [zoom, setZoom] = useState(false)
  // Constrain the placeholder to the image aspect ratio to avoid layout jumps.
  const ratio = media.width && media.height ? media.width / media.height : undefined

  if (!url) {
    return (
      <div
        className="flex items-center justify-center bg-black/5 rounded-lg max-w-[280px]"
        style={{ aspectRatio: ratio, width: media.width ? Math.min(280, media.width) : 200, height: ratio ? undefined : 160 }}
      >
        <Loader2 className="w-5 h-5 animate-spin opacity-40" />
      </div>
    )
  }
  return (
    <>
      <img
        src={url}
        alt={media.name}
        onClick={() => setZoom(true)}
        className="rounded-lg max-w-[280px] max-h-[320px] object-cover cursor-zoom-in"
      />
      {zoom && (
        <div
          className="fixed inset-0 z-[2147483000] bg-black/85 flex items-center justify-center p-6 cursor-zoom-out"
          onClick={() => setZoom(false)}
        >
          <img src={url} alt={media.name} className="max-w-full max-h-full object-contain rounded" />
        </div>
      )}
    </>
  )
}

// Voice message player with waveform scrubber.
function VoicePlayer({ url, media, isOwn }: { url: string | null; media: MediaPayload; isOwn: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0) // 0..1
  const bars = media.waveform && media.waveform.length ? media.waveform : Array(32).fill(0.4)
  const duration = media.duration ?? 0

  function toggle() {
    const a = audioRef.current
    if (!a || !url) return
    if (playing) { a.pause() } else { a.play() }
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const a = audioRef.current
    if (!a || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    a.currentTime = ratio * duration
    setProgress(ratio)
  }

  return (
    <div className="flex items-center gap-2 min-w-[200px]">
      {url && (
        <audio
          ref={audioRef}
          src={url}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => { setPlaying(false); setProgress(0) }}
          onTimeUpdate={() => {
            const a = audioRef.current
            if (a && duration) setProgress(a.currentTime / duration)
          }}
        />
      )}
      <button
        onClick={toggle}
        disabled={!url}
        className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
          isOwn ? 'bg-white/25 hover:bg-white/40' : 'bg-blue-600 text-white hover:bg-blue-700'
        }`}
      >
        {!url ? <Loader2 className="w-4 h-4 animate-spin" />
          : playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-[2px] h-7 cursor-pointer" onClick={seek}>
          {bars.map((h, i) => {
            const active = i / bars.length <= progress
            return (
              <span
                key={i}
                className={`flex-1 rounded-full transition-colors ${
                  active ? (isOwn ? 'bg-white' : 'bg-blue-600') : (isOwn ? 'bg-white/40' : 'bg-gray-300')
                }`}
                style={{ height: `${Math.max(15, h * 100)}%` }}
              />
            )
          })}
        </div>
        <div className={`flex items-center gap-1 text-[10px] mt-0.5 ${isOwn ? 'text-white/70' : 'text-gray-400'}`}>
          <Mic className="w-3 h-3" />
          {formatDuration(duration)}
        </div>
      </div>
    </div>
  )
}
