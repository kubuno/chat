import { useEffect, useState } from 'react'
import { chatApi } from './api'

interface Unfurl { url: string; title: string | null; description: string | null; image: string | null; site_name?: string | null }

// Module-level cache so the same link isn't re-fetched per render/message.
const cache = new Map<string, Unfurl | null>()

export default function LinkPreview({ url, isOwn }: { url: string; isOwn: boolean }) {
  const [data, setData] = useState<Unfurl | null>(cache.has(url) ? cache.get(url)! : null)

  useEffect(() => {
    if (cache.has(url)) { setData(cache.get(url)!); return }
    let alive = true
    chatApi.unfurl(url)
      .then(d => { const v = (d.title || d.image) ? d : null; cache.set(url, v); if (alive) setData(v) })
      .catch(() => { cache.set(url, null) })
    return () => { alive = false }
  }, [url])

  if (!data) return null

  return (
    <a
      href={data.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={e => e.stopPropagation()}
      className={`mt-1 flex flex-col rounded-lg overflow-hidden border max-w-[280px] ${isOwn ? 'border-white/25 bg-white/10' : 'border-gray-200 bg-gray-50 hover:bg-gray-100'} transition-colors`}
    >
      {data.image && (
        <img src={data.image} alt="" className="w-full max-h-36 object-cover" loading="lazy" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
      )}
      <div className="px-2.5 py-1.5 min-w-0">
        {data.site_name && <div className={`text-[10px] uppercase tracking-wide truncate ${isOwn ? 'text-white/60' : 'text-gray-400'}`}>{data.site_name}</div>}
        {data.title && <div className={`text-xs font-semibold truncate ${isOwn ? 'text-white' : 'text-gray-900'}`}>{data.title}</div>}
        {data.description && <div className={`text-[11px] line-clamp-2 ${isOwn ? 'text-white/70' : 'text-gray-500'}`}>{data.description}</div>}
      </div>
    </a>
  )
}
