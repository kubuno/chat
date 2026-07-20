/**
 * Expression picker for the composer: emojis, GIFs and personal stickers,
 * behind the three tabs at the bottom of the panel.
 *
 * - Emoji: the full Unicode 15.1 catalogue (lazy-loaded chunk), browsable by
 *   category with a fr/en keyword search and a local "recently used" row.
 * - GIF: searched through the module's GIPHY proxy; the tab hides itself when
 *   no API key is configured on the instance.
 * - Sticker: the device-local pack (see stickers.ts), plus creation from any image.
 */
import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { MenuDropdown, useMenuDropdown, type MenuItem } from '@ui'
import {
  Clock, Smile, Cat, Coffee, Volleyball, Car, Lightbulb, Hash, Flag,
  Search, X, TrendingUp, Laugh, Heart, ThumbsUp, PartyPopper, Tv, Plus, Trash2, Loader2, ImageOff,
} from 'lucide-react'
import { chatApi, type GifResult } from './api'
import { listStickers, removeSticker, type Sticker } from './stickers'
import type { Emoji, EmojiGroup } from './emojiData'

type Tab = 'emoji' | 'gif' | 'sticker'

interface Props {
  onPickEmoji:     (emoji: string) => void
  onPickGif:       (gif: GifResult) => void
  onPickSticker:   (sticker: Sticker) => void
  onCreateSticker: () => void
  /** Bumped by the parent after a sticker is added, to refresh the pack. */
  stickerVersion?: number
  onClose:         () => void
}

const RECENT_KEY = 'kubuno.chat.recentEmojis'
const RECENT_MAX = 24

export function readRecentEmojis(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list.filter((e): e is string => typeof e === 'string').slice(0, RECENT_MAX) : []
  } catch {
    return []
  }
}

export function pushRecentEmoji(emoji: string): void {
  try {
    const next = [emoji, ...readRecentEmojis().filter(e => e !== emoji)].slice(0, RECENT_MAX)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // Private mode / quota exceeded — recents are a nicety, never a hard failure.
  }
}

// Category icons, in the Unicode keyboard order used by emojiData.
const EMOJI_CATS: { id: string; icon: typeof Smile }[] = [
  { id: 'smileys',    icon: Smile },
  { id: 'animals',    icon: Cat },
  { id: 'food',       icon: Coffee },
  { id: 'activities', icon: Volleyball },
  { id: 'travel',     icon: Car },
  { id: 'objects',    icon: Lightbulb },
  { id: 'symbols',    icon: Hash },
  { id: 'flags',      icon: Flag },
]

// GIF categories are just canned GIPHY queries.
const GIF_CATS: { id: string; icon: typeof Smile; query: string }[] = [
  { id: 'trending', icon: TrendingUp,  query: '' },
  { id: 'funny',    icon: Laugh,       query: 'funny' },
  { id: 'love',     icon: Heart,       query: 'love' },
  { id: 'thumbsup', icon: ThumbsUp,    query: 'thumbs up' },
  { id: 'party',    icon: PartyPopper, query: 'party' },
  { id: 'sports',   icon: Volleyball,  query: 'sports' },
  { id: 'tv',       icon: Tv,          query: 'tv' },
]

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export default function ExpressionPanel({ onPickEmoji, onPickGif, onPickSticker, onCreateSticker, stickerVersion = 0, onClose }: Props) {
  const { t, i18n } = useTranslation('chat')
  const [tab, setTab] = useState<Tab>('emoji')
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  // Dismiss on outside click / Escape.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // Reset the search box when switching tabs — the query means something else there.
  useEffect(() => { setQuery('') }, [tab])

  const [gifEnabled, setGifEnabled] = useState<boolean | null>(null)
  useEffect(() => {
    let alive = true
    chatApi.gifStatus()
      .then(s => { if (alive) setGifEnabled(s.enabled) })
      .catch(() => { if (alive) setGifEnabled(false) })
    return () => { alive = false }
  }, [])

  const placeholder = tab === 'emoji'
    ? t('chat_emoji_search', { defaultValue: 'Rechercher un emoji' })
    : t('chat_gif_search', { defaultValue: 'Rechercher des GIF via GIPHY' })

  return (
    <div
      ref={rootRef}
      className="absolute bottom-full left-0 mb-2 w-[min(380px,calc(100vw-2rem))] h-[440px] max-h-[70vh] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden z-40"
      role="dialog"
      aria-label={t('chat_expressions', { defaultValue: 'Emojis, GIF et stickers' })}
    >
      {tab !== 'sticker' && (
        <div className="px-3 pt-2 pb-2 border-b border-gray-100">
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={placeholder}
              className="w-full rounded-full border border-gray-200 pl-9 pr-8 py-2 text-sm focus:outline-none focus:border-blue-400 placeholder-gray-400"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
                title={t('common_cancel')}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0">
        {tab === 'emoji' && <EmojiTab query={query} onPick={emoji => { pushRecentEmoji(emoji); onPickEmoji(emoji) }} />}
        {tab === 'gif' && <GifTab query={query} lang={i18n.language?.slice(0, 2)} onPick={onPickGif} />}
        {tab === 'sticker' && <StickerTab version={stickerVersion} onPick={onPickSticker} onCreate={onCreateSticker} />}
      </div>

      {/* Emoji / GIF / Sticker switch */}
      <div className="border-t border-gray-100 py-2 flex justify-center">
        <div className="flex items-center bg-gray-100 rounded-full p-0.5">
          {(['emoji', 'gif', 'sticker'] as Tab[]).filter(id => id !== 'gif' || gifEnabled !== false).map(id => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-6 py-1.5 rounded-full text-sm transition-colors ${
                tab === id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
              title={t(`chat_tab_${id}`, { defaultValue: id })}
              aria-pressed={tab === id}
            >
              {id === 'emoji' ? <Smile className="w-5 h-5" />
                : id === 'gif' ? <span className="font-semibold text-xs tracking-wide">GIF</span>
                : <StickerIcon />}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/** lucide v1 has no sticker glyph — a peeled-corner square, as in the mockup. */
function StickerIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15.5 3H7a4 4 0 0 0-4 4v10a4 4 0 0 0 4 4h6l8-8V7a4 4 0 0 0-4-4Z" />
      <path d="M13 21v-4a4 4 0 0 1 4-4h4" />
    </svg>
  )
}

// ── Emoji ────────────────────────────────────────────────────────────────────

function EmojiTab({ query, onPick }: { query: string; onPick: (emoji: string) => void }) {
  const { t } = useTranslation('chat')
  const [groups, setGroups] = useState<EmojiGroup[] | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({})
  const [recent] = useState<string[]>(() => readRecentEmojis())
  const [cat, setCat] = useState<string>(() => (recent.length ? 'recent' : 'smileys'))

  // 220 KB of emoji data: only pulled in when the panel is actually opened.
  useEffect(() => {
    let alive = true
    import('./emojiData').then(m => { if (alive) setGroups(m.EMOJI_GROUPS) })
    return () => { alive = false }
  }, [])

  const hits = useMemo(() => {
    const q = strip(query.trim())
    if (!q || !groups) return null
    const all: Emoji[] = []
    for (const g of groups) {
      for (const e of g.emojis) {
        if (e.k.includes(q)) all.push(e)
        if (all.length >= 180) return all
      }
    }
    return all
  }, [query, groups])

  const scrollTo = useCallback((id: string) => {
    setCat(id)
    const el = sectionRefs.current[id]
    const box = scrollRef.current
    if (el && box) box.scrollTo({ top: el.offsetTop - box.offsetTop, behavior: 'smooth' })
  }, [])

  if (!groups) {
    return <div className="h-full flex items-center justify-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
  }

  if (hits) {
    return (
      <div className="h-full overflow-y-auto px-2 py-2">
        {hits.length === 0
          ? <p className="text-center text-sm text-gray-400 py-8">{t('chat_no_results')}</p>
          : <EmojiGrid emojis={hits} onPick={onPick} />}
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-0.5 px-2 border-b border-gray-100 overflow-x-auto">
        {recent.length > 0 && (
          <CatButton active={cat === 'recent'} onClick={() => scrollTo('recent')} title={t('chat_emoji_cat_recent', { defaultValue: 'Récent' })}>
            <Clock className="w-5 h-5" />
          </CatButton>
        )}
        {EMOJI_CATS.map(c => (
          <CatButton key={c.id} active={cat === c.id} onClick={() => scrollTo(c.id)} title={t(`chat_emoji_cat_${c.id}`, { defaultValue: c.id })}>
            <c.icon className="w-5 h-5" />
          </CatButton>
        ))}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-2 py-2">
        {recent.length > 0 && (
          <section ref={el => { sectionRefs.current.recent = el }} className="mb-2">
            <h3 className="px-1 py-1 text-xs font-semibold text-gray-500">{t('chat_emoji_cat_recent', { defaultValue: 'Récent' })}</h3>
            <EmojiGrid emojis={recent.map(c => ({ c, n: c, k: '' }))} onPick={onPick} />
          </section>
        )}
        {EMOJI_CATS.map(c => {
          const group = groups.find(g => g.id === c.id)
          if (!group) return null
          return (
            <section
              key={c.id}
              ref={el => { sectionRefs.current[c.id] = el }}
              className="mb-2"
              style={{ contentVisibility: 'auto', containIntrinsicSize: '0 320px' }}
            >
              <h3 className="px-1 py-1 text-xs font-semibold text-gray-500">{t(`chat_emoji_cat_${c.id}`, { defaultValue: c.id })}</h3>
              <EmojiGrid emojis={group.emojis} onPick={onPick} />
            </section>
          )
        })}
      </div>
    </div>
  )
}

function EmojiGrid({ emojis, onPick }: { emojis: Emoji[]; onPick: (emoji: string) => void }) {
  return (
    <div className="grid grid-cols-8 gap-0.5">
      {emojis.map((e, i) => (
        <button
          key={`${e.c}-${i}`}
          onClick={() => onPick(e.c)}
          title={e.n}
          className="text-2xl leading-none h-10 rounded-lg hover:bg-gray-100 transition-colors"
        >
          {e.c}
        </button>
      ))}
    </div>
  )
}

function CatButton({ active, onClick, title, children }: { active: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex-shrink-0 px-2.5 py-2 border-b-2 transition-colors ${
        active ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'
      }`}
    >
      {children}
    </button>
  )
}

// ── GIF ──────────────────────────────────────────────────────────────────────

function GifTab({ query, lang, onPick }: { query: string; lang?: string; onPick: (gif: GifResult) => void }) {
  const { t } = useTranslation('chat')
  const [cat, setCat] = useState('trending')
  const [gifs, setGifs] = useState<GifResult[] | null>(null)
  const [error, setError] = useState(false)

  const term = query.trim() || (GIF_CATS.find(c => c.id === cat)?.query ?? '')

  useEffect(() => {
    let alive = true
    setGifs(null)
    setError(false)
    // Debounce keystrokes so a search isn't fired on every character.
    const timer = window.setTimeout(() => {
      chatApi.searchGifs(term, 24, 0, lang)
        .then(res => { if (alive) setGifs(res) })
        .catch(() => { if (alive) { setError(true); setGifs([]) } })
    }, query.trim() ? 350 : 0)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [term, lang, query])

  return (
    <div className="h-full flex flex-col">
      {!query.trim() && (
        <div className="flex items-center gap-0.5 px-2 border-b border-gray-100 overflow-x-auto">
          {GIF_CATS.map(c => (
            <CatButton key={c.id} active={cat === c.id} onClick={() => setCat(c.id)} title={t(`chat_gif_cat_${c.id}`, { defaultValue: c.id })}>
              <c.icon className="w-5 h-5" />
            </CatButton>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2">
        {gifs === null ? (
          <div className="h-full flex items-center justify-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : error ? (
          <p className="text-center text-sm text-gray-400 py-8">{t('chat_gif_error', { defaultValue: 'Recherche de GIF indisponible.' })}</p>
        ) : gifs.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-8">{t('chat_no_results')}</p>
        ) : (
          <div className="columns-3 gap-2 [column-fill:_balance]">
            {gifs.map(g => (
              <button
                key={g.id}
                onClick={() => onPick(g)}
                className="mb-2 block w-full rounded-lg overflow-hidden bg-gray-100 hover:ring-2 hover:ring-blue-500 transition-shadow"
                title={g.title}
              >
                <img src={g.preview} alt={g.title} loading="lazy" className="w-full h-auto block" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Stickers ─────────────────────────────────────────────────────────────────

function StickerTab({ version, onPick, onCreate }: { version: number; onPick: (s: Sticker) => void; onCreate: () => void }) {
  const { t } = useTranslation('chat')
  const [stickers, setStickers] = useState<Sticker[] | null>(null)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const menu = useMenuDropdown()
  const [target, setTarget] = useState<Sticker | null>(null)

  useEffect(() => {
    let alive = true
    listStickers()
      .then(list => { if (alive) setStickers(list) })
      .catch(() => { if (alive) setStickers([]) })
    return () => { alive = false }
  }, [version])

  // Object URLs for the stored blobs, revoked when the list changes or unmounts.
  useEffect(() => {
    if (!stickers) return
    const map: Record<string, string> = {}
    for (const s of stickers) map[s.id] = URL.createObjectURL(s.blob)
    setUrls(map)
    return () => { Object.values(map).forEach(URL.revokeObjectURL) }
  }, [stickers])

  async function del(sticker: Sticker) {
    await removeSticker(sticker.id).catch(() => {})
    setStickers(list => (list ?? []).filter(s => s.id !== sticker.id))
  }

  const menuItems = (): MenuItem[] => (target ? [
    { type: 'action', label: t('common_delete'), danger: true, icon: <Trash2 size={15} />, onClick: () => del(target) },
  ] : [])

  if (stickers === null) {
    return <div className="h-full flex items-center justify-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
  }

  return (
    <div className="h-full overflow-y-auto p-3">
      {stickers.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full text-center gap-2 px-6">
          <ImageOff className="w-8 h-8 text-gray-300" />
          <p className="text-sm text-gray-500">{t('chat_sticker_empty', { defaultValue: 'Aucun sticker pour l’instant.' })}</p>
          <p className="text-xs text-gray-400">{t('chat_sticker_empty_hint', { defaultValue: 'Créez-en un à partir de n’importe quelle image — il reste sur cet appareil.' })}</p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        {stickers.map(s => (
          <button
            key={s.id}
            onClick={() => onPick(s)}
            onContextMenu={e => { e.preventDefault(); setTarget(s); menu.open(e) }}
            className="aspect-square rounded-xl p-1.5 hover:bg-gray-100 transition-colors"
            title={t('chat_sticker_send', { defaultValue: 'Envoyer ce sticker' })}
          >
            {urls[s.id] && <img src={urls[s.id]} alt="" className="w-full h-full object-contain" />}
          </button>
        ))}

        <button
          onClick={onCreate}
          className="aspect-square rounded-xl border-2 border-dashed border-gray-200 text-gray-400 hover:border-blue-400 hover:text-blue-500 flex flex-col items-center justify-center gap-1 transition-colors"
          title={t('chat_sticker_new', { defaultValue: 'Nouveau sticker' })}
        >
          <Plus className="w-6 h-6" />
          <span className="text-[11px] px-1">{t('chat_sticker_new', { defaultValue: 'Nouveau sticker' })}</span>
        </button>
      </div>

      {menu.pos && <MenuDropdown items={menuItems()} pos={menu.pos} onClose={() => { menu.close(); setTarget(null) }} />}
    </div>
  )
}
