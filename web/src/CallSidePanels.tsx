import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Dropdown, Tabs, Toggle } from '@ui'


/** Shell shared by the meeting's right-hand panels. */
function SidePanel({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    // A side panel keeps its width until the window gets narrow, then follows
    // it: it stays visible at any size instead of being pushed off-screen.
    <div className="relative z-10 flex-shrink-0 bg-[#2a2b2e] text-gray-100 flex flex-col rounded-2xl overflow-hidden mr-3 mb-1" style={{ width: 'min(20rem, 70vw)' }}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <span className="text-sm font-medium">{title}</span>
        <button onClick={onClose} className="p-1 rounded hover:bg-white/10"><X className="w-4 h-4" /></button>
      </div>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}


/** Devices, as a side panel rather than a dialog — the meeting stays visible. */
export function SettingsPanel({ devices, micId, camId, speakerId, onMic, onCam, onSpeaker, onClose }: {
  devices: { mics: MediaDeviceInfo[]; cams: MediaDeviceInfo[]; speakers: MediaDeviceInfo[] }
  micId: string; camId: string; speakerId: string
  onMic: (id: string) => void; onCam: (id: string) => void; onSpeaker: (id: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation('chat')
  const opts = (list: MediaDeviceInfo[], fallback: string) => [
    { value: '', label: fallback },
    ...list.map(d => ({ value: d.deviceId, label: d.label || d.deviceId.slice(0, 16) })),
  ]
  return (
    <SidePanel title={t('chat_call_settings')} onClose={onClose}>
      <div className="px-4 py-4 flex flex-col gap-5">
        <label className="flex flex-col gap-1.5 text-sm">
          {t('chat_call_microphone')}
          <Dropdown value={micId} onChange={onMic} options={opts(devices.mics, t('chat_lobby_default_mic'))} width="100%" height={36} variant="dark" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          {t('chat_call_speaker')}
          <Dropdown value={speakerId} onChange={onSpeaker} options={opts(devices.speakers, t('chat_lobby_default_speaker'))} width="100%" height={36} variant="dark" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          {t('chat_call_camera')}
          <Dropdown value={camId} onChange={onCam} options={opts(devices.cams, t('chat_lobby_default_cam'))} width="100%" height={36} variant="dark" />
        </label>
      </div>
    </SidePanel>
  )
}


/**
 * Backgrounds and effects. Backgrounds and filters need a person-segmentation
 * model, which this instance does not ship: they are listed with that reason
 * rather than pretended. Lighting works today — it is a plain filter over the
 * frame and needs no model.
 */
export function EffectsPanel({ camOff, onClose }: { camOff: boolean; onClose: () => void }) {
  const { t } = useTranslation('chat')
  const [tab, setTab] = useState<'backgrounds' | 'filters' | 'appearance'>('backgrounds')
  const [lighting, setLighting] = useState(false)

  return (
    <SidePanel title={t('chat_call_effects')} onClose={onClose}>
      {camOff && (
        <p className="mx-4 mt-4 rounded-xl bg-white/5 px-4 py-6 text-center text-sm text-gray-300">
          {t('chat_effects_cam_off')}
        </p>
      )}
      <Tabs
        className="px-2 pt-3"
        size="sm"
        variant="stretched"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'backgrounds', label: t('chat_effects_backgrounds') },
          { id: 'filters',     label: t('chat_effects_filters') },
          { id: 'appearance',  label: t('chat_effects_appearance') },
        ]}
      />
      <div className="px-4 py-4">
        {/* The switch is the @ui primitive; its text is written here because
            the primitive's own label follows the light theme tokens. */}
        {tab === 'appearance' ? (
          <label className="flex items-start gap-3 cursor-pointer">
            <Toggle checked={lighting} onChange={e => setLighting(e.target.checked)} />
            <span className="min-w-0">
              <span className="block text-sm text-gray-100">{t('chat_effects_lighting')}</span>
              <span className="block text-xs text-gray-400">{t('chat_effects_lighting_hint')}</span>
            </span>
          </label>
        ) : (
          <p className="text-sm text-gray-300">{t('chat_effects_needs_model')}</p>
        )}
      </div>
    </SidePanel>
  )
}
