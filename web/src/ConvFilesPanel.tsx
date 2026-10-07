/**
 * Files shared in a conversation.
 *
 * End-to-end encryption rules out a server-side index: the list is derived from
 * the messages already decrypted in the store (same approach as the Mentions
 * view). Each entry is decrypted on demand, when the user opens or downloads it.
 */
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, FileText, Image as ImageIcon, Film, Music, Download, Loader2 } from 'lucide-react'
import { Button } from '@ui'
import { useChatStore } from './chatStore'
import { chatApi, type MediaPayload, type DecodedMessage } from './api'
import { decryptToBlob } from './crypto/media'

interface Props {
  convId:      string
  memberNames: Record<string, string>
  onClose:     () => void
}

type Entry = { msg: DecodedMessage; media: MediaPayload }

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}

function KindIcon({ kind }: { kind: MediaPayload['kind'] }) {
  const cls = 'w-5 h-5'
  if (kind === 'image' || kind === 'sticker' || kind === 'gif') return <ImageIcon className={`${cls} text-blue-500`} />
  if (kind === 'video') return <Film className={`${cls} text-rose-500`} />
  if (kind === 'audio') return <Music className={`${cls} text-amber-500`} />
  return <FileText className={`${cls} text-violet-500`} />
}

export default function ConvFilesPanel({ convId, memberNames, onClose }: Props) {
  const { t, i18n } = useTranslation('chat')
  const messages = useChatStore(s => s.messages[convId]) ?? []
  const [busyId, setBusyId] = useState<string | null>(null)

  const entries = useMemo<Entry[]>(
    () => messages
      .filter(m => m.media && !m.deleted_at)
      .map(m => ({ msg: m, media: m.media as MediaPayload }))
      .reverse(),
    [messages],
  )

  async function open(entry: Entry) {
    setBusyId(entry.msg.id)
    try {
      const cipher = await chatApi.downloadMedia(entry.media.media_id)
      const blob   = await decryptToBlob(cipher, entry.media.key, entry.media.iv, entry.media.mime)
      const url    = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = entry.media.name || 'fichier'
      a.click()
      // The browser needs the URL alive until the download starts.
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (e) {
      console.error('download shared file', e)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <aside className="w-80 flex-shrink-0 border-l border-gray-200 bg-white flex flex-col min-h-0">
      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200 flex-shrink-0">
        <h2 className="text-sm font-semibold text-gray-900">
          {t('chat_shared_files', { defaultValue: 'Fichiers partagés' })}
        </h2>
        <button onClick={onClose} className="p-1 rounded hover:bg-gray-100" title={t('common_close', { defaultValue: 'Fermer' })}>
          <X className="w-4 h-4 text-gray-500" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-2">
        {entries.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-gray-400">
            {t('chat_no_shared_files', { defaultValue: 'Aucun fichier partagé dans cette conversation.' })}
          </p>
        ) : entries.map(entry => (
          <div key={entry.msg.id} className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-gray-50">
            <KindIcon kind={entry.media.kind} />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-800 truncate">
                {entry.media.name || t('chat_media_untitled', { defaultValue: 'Sans nom' })}
              </p>
              <p className="text-xs text-gray-400 truncate">
                {memberNames[entry.msg.sender_id] ?? '…'}
                {' · '}
                {new Date(entry.msg.created_at).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' })}
                {entry.media.size ? ` · ${formatSize(entry.media.size)}` : ''}
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => open(entry)}
              disabled={busyId === entry.msg.id}
              icon={busyId === entry.msg.id
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Download className="w-4 h-4" />}
              title={t('chat_download', { defaultValue: 'Télécharger' })}
            />
          </div>
        ))}
      </div>
    </aside>
  )
}
