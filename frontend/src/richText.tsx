import { ReactNode } from 'react'

// Inline tokenizer: [label](url), URLs, @mentions, **bold**, ~~strike~~,
// `code`, *italic*. Non-nested (good enough for chat). Underscores are
// intentionally NOT italic markers to avoid mangling snake_case.
const TOKEN_RE = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<]+)|(@\w+)|\*\*([^*\n]+)\*\*|~~([^~\n]+)~~|`([^`\n]+)`|\*([^*\n]+)\*/g

const TRAILING = /[.,;:!?)\]]+$/

export function renderRich(text: string, isOwn: boolean): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let key = 0
  let m: RegExpExecArray | null
  TOKEN_RE.lastIndex = 0
  while ((m = TOKEN_RE.exec(text)) !== null) {
    if (m.index > last) out.push(<span key={key++}>{text.slice(last, m.index)}</span>)
    const link = (href: string, label: string) => (
      <a key={key++} href={href} target="_blank" rel="noopener noreferrer"
        className={`underline ${isOwn ? 'text-white' : 'text-blue-600'}`} onClick={e => e.stopPropagation()}>
        {label}
      </a>
    )
    if (m[1] && m[2]) {
      out.push(link(m[2], m[1]))
    } else if (m[3]) {
      const trail = TRAILING.exec(m[3])?.[0] ?? ''
      const href = m[3].slice(0, m[3].length - trail.length)
      out.push(link(href, href))
      if (trail) out.push(<span key={key++}>{trail}</span>)
    } else if (m[4]) {
      out.push(<span key={key++} className={isOwn ? 'font-semibold underline decoration-white/50' : 'font-semibold text-blue-600'}>{m[4]}</span>)
    } else if (m[5]) {
      out.push(<strong key={key++}>{m[5]}</strong>)
    } else if (m[6]) {
      out.push(<span key={key++} className="line-through">{m[6]}</span>)
    } else if (m[7]) {
      out.push(<code key={key++} className={`px-1 py-0.5 rounded text-[0.85em] font-mono ${isOwn ? 'bg-white/20' : 'bg-gray-100'}`}>{m[7]}</code>)
    } else if (m[8]) {
      out.push(<em key={key++}>{m[8]}</em>)
    }
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(<span key={key++}>{text.slice(last)}</span>)
  return out
}

/** First http(s) URL in the text (trailing punctuation stripped), or null. */
export function firstUrl(text: string): string | null {
  const m = /https?:\/\/[^\s<]+/.exec(text)
  if (!m) return null
  return m[0].replace(TRAILING, '')
}
