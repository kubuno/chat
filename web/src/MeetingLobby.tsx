import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Mic, MicOff, Video, VideoOff, X } from 'lucide-react'

interface Props {
  title:    string
  onJoin:   (muted: boolean, camOff: boolean) => void
  onCancel: () => void
}

interface DeviceGroup { mics: MediaDeviceInfo[]; cams: MediaDeviceInfo[]; speakers: MediaDeviceInfo[] }

/**
 * Meeting lobby (the "green room"): a camera/mic preview shown before the call
 * starts, so the user checks their devices and chooses whether to enter with
 * the camera or microphone on. It always precedes joining a meeting.
 */
export default function MeetingLobby({ title, onJoin, onCancel }: Props) {
  const { t } = useTranslation('chat')
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [muted, setMuted] = useState(false)
  const [camOff, setCamOff] = useState(false)
  const [devices, setDevices] = useState<DeviceGroup>({ mics: [], cams: [], speakers: [] })
  const [micId, setMicId] = useState<string>('')
  const [camId, setCamId] = useState<string>('')
  const [speakerId, setSpeakerId] = useState<string>('')
  const [denied, setDenied] = useState(false)

  // Open (or reopen) the preview stream for the chosen devices.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: micId ? { deviceId: { exact: micId } } : true,
          video: camId ? { deviceId: { exact: camId } } : true,
        })
        if (cancelled) { stream.getTracks().forEach(tr => tr.stop()); return }
        streamRef.current?.getTracks().forEach(tr => tr.stop())
        streamRef.current = stream
        // Reflect the current on/off choices onto the fresh tracks.
        stream.getAudioTracks().forEach(tr => { tr.enabled = !muted })
        stream.getVideoTracks().forEach(tr => { tr.enabled = !camOff })
        if (videoRef.current) videoRef.current.srcObject = stream
        // Device labels are only populated once permission is granted.
        const list = await navigator.mediaDevices.enumerateDevices()
        if (cancelled) return
        setDevices({
          mics:     list.filter(d => d.kind === 'audioinput'),
          cams:     list.filter(d => d.kind === 'videoinput'),
          speakers: list.filter(d => d.kind === 'audiooutput'),
        })
      } catch {
        if (!cancelled) setDenied(true)
      }
    })()
    return () => { cancelled = true }
  }, [micId, camId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Stop the preview when the lobby closes.
  useEffect(() => () => { streamRef.current?.getTracks().forEach(tr => tr.stop()) }, [])

  function toggleMic() {
    setMuted(m => { const v = !m; streamRef.current?.getAudioTracks().forEach(tr => { tr.enabled = !v }); return v })
  }
  function toggleCam() {
    setCamOff(c => { const v = !c; streamRef.current?.getVideoTracks().forEach(tr => { tr.enabled = !v }); return v })
  }

  return (
    <div className="fixed inset-0 z-[2147483200] flex items-center justify-center bg-gray-900/95 backdrop-blur-sm p-6" data-module="chat">
      <button onClick={onCancel} className="absolute top-4 right-4 p-2 rounded-full text-gray-300 hover:bg-white/10" title={t('common_cancel')}>
        <X size={20} />
      </button>

      <div className="flex flex-row flex-wrap items-center justify-center gap-8 lg:gap-14 max-w-5xl w-full">
        {/* Camera preview + device pickers */}
        <div className="flex flex-col gap-3 flex-[1_1_400px] max-w-[640px]">
          <div className="relative aspect-video w-full rounded-2xl overflow-hidden bg-black shadow-2xl">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover ${camOff || denied ? 'hidden' : ''}`}
            />
            {(camOff || denied) && (
              <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm">
                {denied ? t('chat_lobby_denied', { defaultValue: 'Caméra et micro indisponibles.' }) : t('chat_lobby_cam_off', { defaultValue: 'Caméra désactivée' })}
              </div>
            )}
            {/* Overlaid mic / camera controls */}
            <div className="absolute bottom-3 inset-x-0 flex items-center justify-center gap-3">
              <button
                onClick={toggleMic}
                title={muted ? t('chat_call_unmute', { defaultValue: 'Activer le micro' }) : t('chat_call_mute', { defaultValue: 'Couper le micro' })}
                className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${muted ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-white/20 text-white hover:bg-white/30'}`}
              >
                {muted ? <MicOff size={18} /> : <Mic size={18} />}
              </button>
              <button
                onClick={toggleCam}
                title={camOff ? t('chat_call_camera_on', { defaultValue: 'Activer la caméra' }) : t('chat_call_camera_off', { defaultValue: 'Désactiver la caméra' })}
                className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${camOff ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-white/20 text-white hover:bg-white/30'}`}
              >
                {camOff ? <VideoOff size={18} /> : <Video size={18} />}
              </button>
            </div>
          </div>

          {/* Your devices */}
          <div className="flex flex-wrap gap-2">
            <DeviceSelect icon={<Mic size={14} />} value={micId} onChange={setMicId} options={devices.mics} fallback={t('chat_lobby_default_mic', { defaultValue: 'Micro par défaut' })} />
            <DeviceSelect icon={<Video size={14} />} value={camId} onChange={setCamId} options={devices.cams} fallback={t('chat_lobby_default_cam', { defaultValue: 'Caméra par défaut' })} />
            {devices.speakers.length > 0 && (
              <DeviceSelect value={speakerId} onChange={setSpeakerId} options={devices.speakers} fallback={t('chat_lobby_default_speaker', { defaultValue: 'Haut-parleur par défaut' })} />
            )}
          </div>
        </div>

        {/* Join panel */}
        <div className="flex flex-col items-center text-center gap-4 min-w-[260px]">
          <h2 className="text-2xl text-white max-w-xs truncate">{title}</h2>
          <p className="text-sm text-gray-300">{t('chat_lobby_ready', { defaultValue: 'Prêt à participer ?' })}</p>
          <button
            onClick={() => onJoin(muted, camOff)}
            className="mt-1 px-8 py-3 rounded-full bg-primary text-white font-medium hover:opacity-90 transition-opacity"
          >
            {t('chat_lobby_join', { defaultValue: 'Participer à la réunion' })}
          </button>
          <button onClick={onCancel} className="text-sm text-gray-300 hover:text-white transition-colors">
            {t('common_cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}

function DeviceSelect({ icon, value, onChange, options, fallback }: {
  icon?: React.ReactNode
  value: string
  onChange: (id: string) => void
  options: MediaDeviceInfo[]
  fallback: string
}) {
  return (
    <div className="flex items-center gap-1.5 bg-white/10 text-white text-xs rounded-full pl-3 pr-1 py-1.5 max-w-[220px]">
      {icon}
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="bg-transparent outline-none text-white truncate max-w-[180px] [&>option]:text-black"
      >
        <option value="">{fallback}</option>
        {options.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || fallback}</option>)}
      </select>
    </div>
  )
}
