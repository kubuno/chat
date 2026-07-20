/**
 * Addressable chat state as a REAL link.
 *
 * The chat main area has a single route (`/chat`) but several addressable
 * views: the shortcut views (home / mentions / starred / browse) and the open
 * conversation. Unlike the other modules — where such a client-side selection
 * is encoded in the location HASH — chat already had a query-string scheme
 * (`/chat?conv=<id>&view=<view>`): ChatPage restores it on mount and mirrors
 * the store back into it with `navigate(..., { replace: true })`. That mirror
 * would strip any hash a fraction of a second after the click, so the sidebar
 * anchors point at the query-string form, which is genuinely shareable,
 * reload-proof and history-friendly.
 */
import type { HomeView } from './chatStore'

const VIEWS: readonly HomeView[] = ['home', 'mentions', 'starred', 'browse']

/** Target encoded in a chat URL. */
export interface ChatTarget {
  view:   HomeView
  convId: string | null
}

/** `to=` value for a sidebar link: a view shortcut or an open conversation. */
export function chatTo(kind: 'view' | 'conv', id: string): string {
  if (kind === 'conv') return `/chat?conv=${encodeURIComponent(id)}`
  return id === 'home' ? '/chat' : `/chat?view=${encodeURIComponent(id)}`
}

/** Decode a location search string; defaults to the home view, no conversation. */
export function chatFromLocation(search: string): ChatTarget {
  const params = new URLSearchParams(search)
  const view   = params.get('view') as HomeView | null
  return {
    view:   view && VIEWS.includes(view) ? view : 'home',
    convId: params.get('conv') || null,
  }
}
