import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { MessageSquare, Clock } from 'lucide-react'
import { api } from '@kubuno/sdk'
import { Input } from '@ui'

interface ChatSettings {
  retention_days: number
  max_media_mb:   number
}

function useAdminSettings() {
  return useQuery({
    queryKey: ['admin-settings-chat'],
    queryFn: () => api.get<{ settings: Record<string, unknown> }>('/admin/settings').then(r => {
      const s = r.data.settings
      return {
        retention_days: Number(s['chat.retention_days'] ?? 0),
        max_media_mb:   Number(s['chat.max_media_mb']   ?? 50),
      } as ChatSettings
    }),
  })
}

export default function ChatSettingsPage() {
  const { t } = useTranslation('chat')
  const qc = useQueryClient()
  const { data, isLoading } = useAdminSettings()

  const save = useMutation({
    mutationFn: (vals: ChatSettings) =>
      api.patch('/admin/settings', {
        'chat.retention_days': vals.retention_days,
        'chat.max_media_mb':   vals.max_media_mb,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-settings-chat'] }),
  })

  if (isLoading || !data) {
    return <div className="p-8 text-sm text-gray-400">{t('common_loading')}</div>
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
          <MessageSquare className="w-5 h-5 text-blue-600" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{t('chat_settings_title')}</h1>
          <p className="text-sm text-gray-500">{t('chat_settings_subtitle')}</p>
        </div>
      </div>

      <SettingsCard title={t('chat_settings_storage')} icon={<Clock className="w-4 h-4" />}>
        <Field
          label={t('chat_settings_retention_label')}
          description={t('chat_settings_retention_desc')}
          defaultValue={data.retention_days}
          min={0} max={3650}
          name="retention_days"
          onSave={v => save.mutate({ ...data, retention_days: v })}
        />
        <Field
          label={t('chat_settings_maxsize_label')}
          description={t('chat_settings_maxsize_desc')}
          defaultValue={data.max_media_mb}
          min={1} max={500}
          name="max_media_mb"
          onSave={v => save.mutate({ ...data, max_media_mb: v })}
        />
      </SettingsCard>
    </div>
  )
}

function SettingsCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-100 bg-gray-50">
        <span className="text-gray-500">{icon}</span>
        <span className="text-sm font-medium text-gray-700">{title}</span>
      </div>
      <div className="divide-y divide-gray-100">{children}</div>
    </div>
  )
}

function Field({
  label, description, defaultValue, min, max, name, onSave,
}: {
  label:        string
  description:  string
  defaultValue: number
  min?:         number
  max?:         number
  name:         string
  onSave:       (v: number) => void
}) {
  return (
    <div className="flex items-center justify-between px-5 py-3 gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800">{label}</p>
        <p className="text-xs text-gray-400 mt-0.5">{description}</p>
      </div>
      <Input
        type="number"
        defaultValue={defaultValue}
        min={min}
        max={max}
        name={name}
        className="w-28 text-right"
        onBlur={e => {
          const v = Number(e.target.value)
          if (!isNaN(v)) onSave(v)
        }}
      />
    </div>
  )
}
