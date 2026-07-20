/**
 * In-composer camera: take a photo or record a clip, review it, then send.
 *
 * The captured file goes through the regular media pipeline (encrypt → upload →
 * encrypted envelope), so nothing here is special-cased server-side.
 * The core serves `permissions-policy: camera=(self), microphone=(self)`, which
 * is what makes getUserMedia usable at all inside the app.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Camera, Video, Send, RefreshCw, RotateCcw, Loader2, Square } from 'lucide-react'
import { Button } from '@ui'

interface Props {
  onCapture: (file: File) => Promise<void> | void
  onClose:   () => void
}

type Mode = 'photo' | 'video'

export default function CameraCapture({ onCapture, onClose }: Props) {
  const { t } = useTranslation('chat')
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)

  const [mode, setMode] = useState<Mode>('photo')
  const [facing, setFacing] = useState<'user' | 'environment'>('user')
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(true)
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null)
  const [sending, setSending] = useState(false)

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach(tr => tr.stop())
    streamRef.current = null
  }, [])

  // (Re)open the stream whenever the camera or the mode changes — video mode
  // needs the microphone too.
  useEffect(() => {
    if (preview) return
    let alive = true
    setStarting(true)
    setError(null)
    stopStream()

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: facing }, audio: mode === 'video' })
      .then(stream => {
        if (!alive) { stream.getTracks().forEach(tr => tr.stop()); return }
        streamRef.current = stream
        if (videoRef.current) videoRef.current.srcObject = stream
        setStarting(false)
      })
      .catch(() => {
        if (!alive) return
        setStarting(false)
        setError(t('chat_camera_denied', { defaultValue: 'Caméra indisponible ou accès refusé.' }))
      })

    return () => { alive = false }
  }, [facing, mode, preview, stopStream, t])

  useEffect(() => () => {
    stopStream()
    if (timerRef.current) window.clearInterval(timerRef.current)
  }, [stopStream])

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url) }, [preview])

  function takePhoto() {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0)
    canvas.toBlob(blob => {
      if (!blob) return
      const file = new File([blob], `photo-${stamp()}.jpg`, { type: 'image/jpeg' })
      stopStream()
      setPreview({ file, url: URL.createObjectURL(blob) })
    }, 'image/jpeg', 0.92)
  }

  function startRecording() {
    const stream = streamRef.current
    if (!stream || recording) return
    const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
      .find(m => MediaRecorder.isTypeSupported(m))
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    chunksRef.current = []
    rec.ondataavailable = e => { if (e.data.size) chunksRef.current.push(e.data) }
    rec.onstop = () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
      setRecording(false)
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'video/webm' })
      stopStream()
      if (!blob.size) return
      const file = new File([blob], `video-${stamp()}.webm`, { type: blob.type })
      setPreview({ file, url: URL.createObjectURL(blob) })
    }
    recorderRef.current = rec
    rec.start()
    setRecording(true)
    setElapsed(0)
    const startedAt = Date.now()
    timerRef.current = window.setInterval(() => setElapsed((Date.now() - startedAt) / 1000), 200)
  }

  function retake() {
    if (preview) URL.revokeObjectURL(preview.url)
    setPreview(null)
  }

  async function send() {
    if (!preview || sending) return
    setSending(true)
    try {
      await onCapture(preview.file)
      onClose()
    } finally {
      setSending(false)
    }
  }

  const fmt = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`

  return (
    <div className="fixed inset-0 z-[2147483100] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-[520px] max-w-full overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">{t('chat_camera', { defaultValue: 'Caméra' })}</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded" title={t('common_cancel')}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="relative bg-black aspect-video flex items-center justify-center">
          {error ? (
            <p className="text-sm text-white/80 px-6 text-center">{error}</p>
          ) : preview ? (
            preview.file.type.startsWith('video/')
              ? <video src={preview.url} controls className="w-full h-full object-contain" />
              : <img src={preview.url} alt="" className="w-full h-full object-contain" />
          ) : (
            <>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover ${facing === 'user' ? '-scale-x-100' : ''}`}
              />
              {starting && <Loader2 className="w-6 h-6 text-white/70 animate-spin absolute" />}
              {recording && (
                <div className="absolute top-3 left-3 flex items-center gap-2 bg-black/60 rounded-full px-3 py-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-xs text-white font-mono">{fmt(elapsed)}</span>
                </div>
              )}
            </>
          )}
        </div>

        {preview ? (
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50">
            <Button variant="ghost" icon={<RotateCcw className="w-4 h-4" />} onClick={retake} disabled={sending}>
              {t('chat_camera_retake', { defaultValue: 'Reprendre' })}
            </Button>
            <Button icon={sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} onClick={send} disabled={sending}>
              {t('chat_send')}
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50">
            <div className="flex items-center bg-gray-200 rounded-full p-0.5">
              {(['photo', 'video'] as Mode[]).map(m => (
                <button
                  key={m}
                  onClick={() => !recording && setMode(m)}
                  disabled={recording}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 transition-colors disabled:opacity-40 ${
                    mode === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {m === 'photo' ? <Camera className="w-3.5 h-3.5" /> : <Video className="w-3.5 h-3.5" />}
                  {m === 'photo' ? t('chat_camera_photo', { defaultValue: 'Photo' }) : t('chat_camera_video', { defaultValue: 'Vidéo' })}
                </button>
              ))}
            </div>

            {mode === 'photo' ? (
              <button
                onClick={takePhoto}
                disabled={!!error || starting}
                className="w-14 h-14 rounded-full bg-blue-600 hover:bg-blue-700 disabled:opacity-40 flex items-center justify-center text-white shadow"
                title={t('chat_camera_shoot', { defaultValue: 'Prendre une photo' })}
              >
                <Camera className="w-6 h-6" />
              </button>
            ) : (
              <button
                onClick={() => (recording ? recorderRef.current?.stop() : startRecording())}
                disabled={!!error || starting}
                className={`w-14 h-14 rounded-full flex items-center justify-center text-white shadow disabled:opacity-40 ${
                  recording ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
                }`}
                title={recording ? t('chat_camera_stop', { defaultValue: 'Arrêter' }) : t('chat_camera_record', { defaultValue: 'Enregistrer' })}
              >
                {recording ? <Square className="w-5 h-5 fill-current" /> : <Video className="w-6 h-6" />}
              </button>
            )}

            <button
              onClick={() => setFacing(f => (f === 'user' ? 'environment' : 'user'))}
              disabled={recording || !!error}
              className="p-2 text-gray-500 hover:text-gray-700 rounded-full hover:bg-gray-200 disabled:opacity-40"
              title={t('chat_camera_switch', { defaultValue: 'Changer de caméra' })}
            >
              <RefreshCw className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/** Local timestamp for a readable file name (no dependency on the locale). */
function stamp(): string {
  const d = new Date()
  const p = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}
