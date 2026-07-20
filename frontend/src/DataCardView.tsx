/**
 * Renders a cross-module data card (pasted JSON envelope) inside a message.
 * The producer module's renderer is resolved through the `core.data-card`
 * extension point; when the producer is not installed, a generic card shows
 * the title, the plain-text summary and the raw JSON payload.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Package, ExternalLink, ChevronDown, ChevronRight } from 'lucide-react'
import { resolveDataCardRenderer, type KubunoDataEnvelope } from './kubunoData'

export default function DataCardView({ envelope }: { envelope: KubunoDataEnvelope }) {
  const { t } = useTranslation('chat')
  const navigate = useNavigate()
  const [showJson, setShowJson] = useState(false)

  const Renderer = resolveDataCardRenderer(envelope.type)
  if (Renderer) return <Renderer envelope={envelope} />

  // Generic fallback: the producer module is not installed (or registered no
  // renderer) — still show something useful, JSON included.
  return (
    <div className="w-72 max-w-full rounded-xl border border-gray-200 bg-white text-gray-900 overflow-hidden">
      <div className="px-3 py-2 flex items-start gap-2">
        <Package size={15} className="text-blue-600 mt-0.5 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          {envelope.title && <p className="text-xs font-semibold truncate">{envelope.title}</p>}
          <p className="text-[11px] text-gray-500 truncate">{envelope.module} · {envelope.type}</p>
        </div>
        {envelope.href && (
          <button
            onClick={() => navigate(envelope.href!)}
            className="p-1 text-gray-400 hover:text-blue-600 flex-shrink-0"
            title={t('chat_card_open', { defaultValue: 'Ouvrir dans le module' })}
          >
            <ExternalLink size={13} />
          </button>
        )}
      </div>
      {envelope.text && (
        <p className="px-3 pb-2 text-[11px] text-gray-600 whitespace-pre-wrap break-words">{envelope.text}</p>
      )}
      <button
        onClick={() => setShowJson(s => !s)}
        className="w-full flex items-center gap-1 px-3 py-1.5 border-t border-gray-100 text-[10px] text-gray-400 hover:text-gray-600"
      >
        {showJson ? <ChevronDown size={11} /> : <ChevronRight size={11} />} JSON
      </button>
      {showJson && (
        <pre className="px-3 pb-2 text-[10px] text-gray-500 overflow-x-auto max-h-40 overflow-y-auto">
          {JSON.stringify(envelope.data, null, 2)}
        </pre>
      )}
    </div>
  )
}
