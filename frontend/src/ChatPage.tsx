/**
 * Main chat area. The sidebar shortcuts pick a view:
 *   home     — centered conversation list ("Accueil"), unread filter, layout
 *              switch (dual pane: conversation opens as a right side panel;
 *              single pane: it takes the full width)
 *   mentions — messages mentioning me across the loaded conversations
 *   starred  — followed (favorite) conversations
 *   browse   — public spaces discovery, with open join
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  MessageSquare, AtSign, Star, Search, ArrowLeft, Users, MailOpen, MoreVertical,
  PanelRightOpen, Rows3, ChevronDown, Check, MessagesSquare, PictureInPicture2,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useChatStore, getConvName, type HomeView } from './chatStore'
import { chatApi, type ConversationSummary } from './api'
import { useAuthStore } from '@kubuno/sdk'
import { ConfirmDialog, MenuDropdown, useMenuDropdown, Toggle, type MenuItem } from '@ui'
import { hasIdentityKey, getOrCreateIdentityKey, getOrCreateSignedPreKey, generateOneTimePreKeys } from './crypto/KeyStore'
import ConversationView from './ConversationView'
import { useConvActions } from './useConvActions'

const LAYOUT_KEY = 'kubuno.chat.layout'

/** Unread badge / bold row: either real unread messages, or an explicit "mark as unread". */
function isUnread(c: ConversationSummary): boolean {
  return c.unread_count > 0 || c.is_unread
}
type Layout = 'dual' | 'single'

export default function ChatPage() {
  const { t, i18n } = useTranslation('chat')
  const { fetchConversations, setKeysRegistered } = useChatStore()
  const activeConvId = useChatStore(s => s.activeConvId)
  const setActiveConv = useChatStore(s => s.setActiveConv)
  const sendTyping = useChatStore(s => s.sendTyping)
  const homeView = useChatStore(s => s.homeView)
  const setHomeView = useChatStore(s => s.setHomeView)
  const navigate = useNavigate()
  const convDisplay = useChatStore(s => s.convDisplay)
  const setConvDisplay = useChatStore(s => s.setConvDisplay)

  const restoredRef = useRef(false)
  const [layout, setLayoutState] = useState<Layout>(() =>
    (localStorage.getItem(LAYOUT_KEY) as Layout) || 'dual')
  const setLayout = (l: Layout) => {
    setLayoutState(l)
    try { localStorage.setItem(LAYOUT_KEY, l) } catch { /* best effort */ }
  }

  useEffect(() => {
    // Silent E2E key bootstrap — no user action required.
    async function initKeys() {
      try {
        const hasLocal = await hasIdentityKey()
        if (!hasLocal) {
          const ik   = await getOrCreateIdentityKey()
          const spk  = await getOrCreateSignedPreKey()
          const opks = await generateOneTimePreKeys(100)
          await chatApi.registerKeys({
            identity_key_pub: ik.publicKeyB64,
            fingerprint:      ik.fingerprint,
            signed_prekey: { id: spk.id, public_key: spk.publicKeyB64, signature: spk.signature },
            one_time_prekeys: opks,
          })
          setKeysRegistered(true)
        } else {
          try {
            const status = await chatApi.getKeyStatus()
            setKeysRegistered(status.opk_count > 0)
            if (status.needs_refill) {
              generateOneTimePreKeys(100)
                .then(async (keys) => {
                  try {
                    await chatApi.uploadOneTimePrekeys(keys)
                  } catch {
                    const ik  = await getOrCreateIdentityKey()
                    const spk = await getOrCreateSignedPreKey()
                    const opks = await generateOneTimePreKeys(100)
                    await chatApi.registerKeys({
                      identity_key_pub: ik.publicKeyB64,
                      fingerprint:      ik.fingerprint,
                      signed_prekey: { id: spk.id, public_key: spk.publicKeyB64, signature: spk.signature },
                      one_time_prekeys: opks,
                    })
                    setKeysRegistered(true)
                  }
                })
                .catch(() => {})
            }
          } catch {
            setKeysRegistered(true)
          }
        }
      } catch {
        // Silent failure
      }
    }

    initKeys()
    fetchConversations()

    // Restore the conversation from the URL: a copied space link, a bookmark, or
    // simply a page reload — /chat?conv=<id>&view=<home|mentions|starred|browse>.
    const params = new URLSearchParams(location.search)
    const convId = params.get('conv')
    const view   = params.get('view') as HomeView | null
    if (view && view !== 'home') setHomeView(view)
    if (convId) setActiveConv(convId)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // …and mirror the state back into the URL, so F5 lands where the user was.
  useEffect(() => {
    // First run happens before the restore effect has pushed the URL params into
    // the store — mirroring then would blank the query string for one frame.
    if (!restoredRef.current) { restoredRef.current = true; return }
    const params = new URLSearchParams(location.search)
    const wanted = new URLSearchParams()
    if (activeConvId) wanted.set('conv', activeConvId)
    if (homeView !== 'home') wanted.set('view', homeView)
    if (params.toString() === wanted.toString()) return
    const qs = wanted.toString()
    navigate(qs ? `/chat?${qs}` : '/chat', { replace: true })
  }, [activeConvId, homeView]) // eslint-disable-line react-hooks/exhaustive-deps

  // Single pane: an open conversation replaces the list entirely. Dual pane: the
  // list stays in a narrow left column and the conversation fills the rest —
  // unless it was expanded, which makes it full width there too.
  const fullConv = activeConvId && (layout === 'single' || convDisplay === 'full')
  const dual = layout === 'dual' && !fullConv

  const mainView = (
    <>
      {homeView === 'home'     && <HomeList layout={layout} onLayout={setLayout} />}
      {homeView === 'starred'  && <HomeList starred layout={layout} onLayout={setLayout} />}
      {homeView === 'mentions' && <MentionsView />}
      {homeView === 'browse'   && <BrowseSpaces />}
    </>
  )

  return (
    /* Full-bleed: the host module area already rounds and clips the corners. */
    <div className="flex flex-1 min-h-0 overflow-hidden bg-white">
      {fullConv ? (
        <div className="flex-1 flex min-h-0 overflow-hidden">
          <ConversationView
            key={activeConvId}
            convId={activeConvId!}
            onBack={() => { setActiveConv(null); setConvDisplay('panel') }}
            sendTyping={sendTyping}
          />
        </div>
      ) : dual ? (
        <>
          {/* Narrow list column… */}
          <div className="w-[38%] min-w-[340px] max-w-[560px] flex min-h-0 overflow-hidden border-r border-gray-100">
            {mainView}
          </div>
          {/* …and the conversation (or an empty pane) filling the rest. */}
          <div className="flex-1 flex min-h-0 overflow-hidden">
            {activeConvId ? (
              <ConversationView
                key={activeConvId}
                convId={activeConvId}
                sendTyping={sendTyping}
                onExpand={() => setConvDisplay('full')}
                onClosePanel={() => setActiveConv(null)}
              />
            ) : (
              <EmptyIllustration
                icon={<MessageSquare className="w-10 h-10 text-gray-300" />}
                title={t('chat_empty_select')}
                hint={t('chat_empty_start_new')}
              />
            )}
          </div>
        </>
      ) : (
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {mainView}
        </div>
      )}
    </div>
  )
}

// ── Accueil / Suivis ─────────────────────────────────────────────────────────

function HomeList({ starred = false, layout, onLayout }: {
  starred?: boolean
  layout: Layout
  onLayout: (l: Layout) => void
}) {
  const { t, i18n } = useTranslation('chat')
  const user = useAuthStore(s => s.user)
  const conversations = useChatStore(s => s.conversations)
  const messages = useChatStore(s => s.messages)
  const setActiveConv = useChatStore(s => s.setActiveConv)
  const activeConvId = useChatStore(s => s.activeConvId)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const threadMode = useChatStore(s => s.threadMode)
  const setThreadMode = useChatStore(s => s.setThreadMode)

  const rowMenu = useMenuDropdown()
  const [menuConvId, setMenuConvId] = useState<string | null>(null)
  const layoutMenu = useMenuDropdown()
  const { buildItems, confirmState, handleConfirm, handleCancel } = useConvActions()
  const myId = user?.id ?? ''

  const rows = conversations
    .filter(c => !c.is_archived)
    .filter(c => !starred || c.is_favorite)
    .filter(c => !unreadOnly || isUnread(c))
    .sort((a, b) => new Date(b.conversation.updated_at).getTime() - new Date(a.conversation.updated_at).getTime())

  const menuSummary = menuConvId ? conversations.find(c => c.conversation.id === menuConvId) : null

  const layoutItems: MenuItem[] = [
    { type: 'action', icon: <PanelRightOpen className="w-4 h-4" />, label: t('chat_layout_dual', { defaultValue: 'Double volet' }), checked: layout === 'dual', onClick: () => onLayout('dual') },
    { type: 'action', icon: <Rows3 className="w-4 h-4" />, label: t('chat_layout_single', { defaultValue: 'Simple volet' }), checked: layout === 'single', onClick: () => onLayout('single') },
  ]

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <header className="flex items-center gap-4 px-6 pt-5 pb-3">
        <h1 className="text-2xl text-gray-900">
          {starred ? t('chat_followed', { defaultValue: 'Suivis' }) : t('chat_home', { defaultValue: 'Accueil' })}
        </h1>
        <Toggle
          className="ml-4"
          label={t('chat_unread_only', { defaultValue: 'Non lus' })}
          size="sm"
          checked={unreadOnly}
          onChange={e => setUnreadOnly(e.target.checked)}
        />
        <button
          onClick={() => setThreadMode(!threadMode)}
          aria-pressed={threadMode}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm transition-colors
            ${threadMode ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-100'}`}
        >
          <MessagesSquare className="w-4 h-4" />
          {t('chat_thread_mode', { defaultValue: 'Fil de discussion' })}
        </button>
        <button
          onClick={e => layoutMenu.open(e)}
          className="ml-auto flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-gray-500 hover:bg-gray-100"
          title={t('chat_layout', { defaultValue: 'Disposition' })}
        >
          {layout === 'dual' ? <PanelRightOpen className="w-4 h-4" /> : <Rows3 className="w-4 h-4" />}
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {rows.length === 0 && (
          starred ? (
            <EmptyIllustration
              icon={<Star className="w-10 h-10 text-amber-300" />}
              title={t('chat_followed_empty', { defaultValue: 'Vos conversations suivies s’affichent ici' })}
              hint={t('chat_followed_hint', { defaultValue: 'Sur une conversation, ouvrez le menu ⋮ puis « Suivre » pour la retrouver ici.' })}
            />
          ) : (
            <EmptyIllustration
              icon={<MessageSquare className="w-10 h-10 text-gray-300" />}
              title={t('chat_no_conversation')}
              hint={t('chat_empty_start_new')}
            />
          )
        )}

        {rows.map(summary => {
          const conv = summary.conversation
          const name = getConvName(conv, myId, summary.other_user)
          const snippet = lastSnippet(messages[conv.id], myId, t)
          return (
            <div
              key={conv.id}
              className={`group flex items-center gap-4 px-3 py-2.5 rounded-xl cursor-pointer transition-colors
                ${conv.id === activeConvId ? 'bg-primary/10' : 'hover:bg-surface-1'}`}
              onClick={() => setActiveConv(conv.id)}
              onContextMenu={e => { e.preventDefault(); setMenuConvId(conv.id); rowMenu.open(e) }}
              role="button"
              tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter') setActiveConv(conv.id) }}
            >
              <div className={`w-11 h-11 ${conv.conv_type === 'direct' ? 'rounded-full' : 'rounded-xl'} bg-surface-2 flex items-center justify-center text-base font-semibold text-text-secondary flex-shrink-0`}>
                {name[0]?.toUpperCase() ?? '?'}
              </div>
              <div className="flex-1 min-w-0 border-b border-gray-100 pb-2.5 -mb-2.5 group-last:border-0">
                <div className="flex items-baseline justify-between gap-3">
                  <p className={`text-[15px] truncate ${isUnread(summary) ? 'font-semibold text-gray-900' : 'text-gray-800'}`}>
                    {name}
                  </p>
                  {/* The date stays put; the actions appear next to it on hover. */}
                  <span className="text-xs text-gray-400 flex-shrink-0">
                    {formatAge(conv.updated_at, i18n.language)}
                  </span>
                  <span className="hidden group-hover:flex items-center gap-1 flex-shrink-0">
                    <HoverAction title={t('chat_mark_unread')} onClick={e => {
                      e.stopPropagation()
                      // Same as the menu action: an open conversation would be re-read at once.
                      if (useChatStore.getState().activeConvId === conv.id) setActiveConv(null)
                      chatApi.updateMemberSettings(conv.id, { mark_unread: true })
                        .then(() => useChatStore.getState().fetchConversations())
                    }}>
                      <MailOpen className="w-4 h-4" />
                    </HoverAction>
                    <HoverAction title={t('chat_open_popup', { defaultValue: 'Ouvrir dans une fenêtre pop-up' })} onClick={e => { e.stopPropagation(); useChatStore.getState().openPopup(conv.id) }}>
                      <PictureInPicture2 className="w-4 h-4" />
                    </HoverAction>
                    <HoverAction title={t('chat_more', { defaultValue: 'Plus' })} onClick={e => { e.stopPropagation(); setMenuConvId(conv.id); rowMenu.open(e) }}>
                      <MoreVertical className="w-4 h-4" />
                    </HoverAction>
                  </span>
                </div>
                <p className={`text-sm truncate ${isUnread(summary) ? 'text-gray-700 font-medium' : 'text-gray-500'}`}>
                  {snippet ?? (conv.conv_type === 'direct'
                    ? (summary.other_user ? `@${summary.other_user.username}` : '')
                    : t('chat_members_count', { count: summary.member_count, defaultValue: '{{count}} membre(s)' }))}
                </p>
              </div>
              {isUnread(summary) && (
                <span className="bg-primary text-white text-[10px] rounded-full px-1.5 py-0.5 font-medium flex-shrink-0 min-w-[18px] text-center">
                  {summary.unread_count > 0 ? (summary.unread_count > 99 ? '99+' : summary.unread_count) : ''}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {confirmState && <ConfirmDialog {...confirmState} onConfirm={handleConfirm} onCancel={handleCancel} />}
      {rowMenu.pos && menuSummary && (
        <MenuDropdown pos={rowMenu.pos} onClose={() => { rowMenu.close(); setMenuConvId(null) }} items={buildItems(menuSummary)} />
      )}
      {layoutMenu.pos && <MenuDropdown pos={layoutMenu.pos} onClose={layoutMenu.close} items={layoutItems} />}
    </div>
  )
}

function HoverAction({ title, onClick, children }: { title: string; onClick: (e: React.MouseEvent) => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title} className="p-1.5 rounded-full text-gray-500 hover:bg-gray-200">
      {children}
    </button>
  )
}

/** Decrypted snippet of the newest cached message ("Vous : …" when it's mine). */
function lastSnippet(
  msgs: ReturnType<typeof useChatStore.getState>['messages'][string] | undefined,
  myId: string,
  t: (k: string, o?: Record<string, unknown>) => string,
): string | null {
  if (!msgs?.length) return null
  const m = msgs[msgs.length - 1]
  const body = m.message_type === 'deleted' ? t('chat_message_deleted')
    : m.media ? (m.media.voice ? '🎤' : m.media.kind === 'sticker' ? '🏷️' : m.media.kind === 'gif' ? 'GIF' : '📎 ' + (m.media.name || ''))
    : m.poll ? '📊 ' + (m.poll.question || '')
    : m.card ? (m.card.title ?? m.card.type)
    : m.plaintext
  if (!body) return null
  return m.sender_id === myId ? `${t('chat_you', { defaultValue: 'Vous' })} : ${body}` : body
}

function formatAge(iso: string, locale: string): string {
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })
  return d.toLocaleDateString(locale, { month: 'short', year: 'numeric' })
}

function EmptyIllustration({ icon, title, hint }: { icon: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex-1 w-full flex flex-col items-center justify-center h-full text-center gap-3 px-8">
      <div className="w-20 h-20 rounded-full bg-surface-1 flex items-center justify-center">{icon}</div>
      <p className="text-lg text-gray-700">{title}</p>
      {hint && <p className="text-sm text-gray-400 max-w-sm">{hint}</p>}
    </div>
  )
}

// ── Mentions ─────────────────────────────────────────────────────────────────

function MentionsView() {
  const { t, i18n } = useTranslation('chat')
  const user = useAuthStore(s => s.user)
  const conversations = useChatStore(s => s.conversations)
  const messages = useChatStore(s => s.messages)
  const setActiveConv = useChatStore(s => s.setActiveConv)
  const myId = user?.id ?? ''
  const myUsername = (user as { username?: string } | null)?.username?.toLowerCase() ?? ''

  // E2E means no server-side mention index: scan the decrypted messages we
  // already have locally (conversations opened in this session).
  const hits = useMemo(() => {
    if (!myUsername) return []
    const found: { convId: string; convName: string; text: string; at: string }[] = []
    for (const summary of conversations) {
      const convId = summary.conversation.id
      for (const m of messages[convId] ?? []) {
        if (m.sender_id !== myId && m.plaintext?.toLowerCase().includes(`@${myUsername}`)) {
          found.push({
            convId,
            convName: getConvName(summary.conversation, myId, summary.other_user),
            text: m.plaintext,
            at: m.created_at,
          })
        }
      }
    }
    return found.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 50)
  }, [conversations, messages, myId, myUsername])

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <header className="px-6 pt-5 pb-3">
        <h1 className="text-2xl text-gray-900">{t('chat_mentions', { defaultValue: 'Mentions' })}</h1>
      </header>
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {hits.length === 0 ? (
          <EmptyIllustration
            icon={<AtSign className="w-10 h-10 text-emerald-300" />}
            title={t('chat_no_mentions', { defaultValue: "Vous n'avez aucune mention" })}
          />
        ) : (
          hits.map((h, i) => (
            <button
              key={`${h.convId}-${i}`}
              onClick={() => setActiveConv(h.convId)}
              className="w-full flex flex-col items-start gap-0.5 px-4 py-2.5 rounded-xl hover:bg-surface-1 text-left"
            >
              <span className="flex items-baseline gap-2 w-full">
                <span className="text-sm font-semibold text-gray-900 truncate">{h.convName}</span>
                <span className="text-xs text-gray-400 ml-auto flex-shrink-0">{formatAge(h.at, i18n.language)}</span>
              </span>
              <span className="text-sm text-gray-600 truncate w-full">{h.text}</span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

// ── Parcourir les espaces ────────────────────────────────────────────────────

interface BrowseChannel {
  id: string
  name: string | null
  description: string | null
  created_at: string
  member_count: number
  is_member: boolean
}

function BrowseSpaces() {
  const { t, i18n } = useTranslation('chat')
  const setHomeView = useChatStore(s => s.setHomeView)
  const setActiveConv = useChatStore(s => s.setActiveConv)
  const fetchConvs = useChatStore(s => s.fetchConversations)
  const [query, setQuery] = useState('')
  const [joined, setJoined] = useState(false)
  const [channels, setChannels] = useState<BrowseChannel[] | null>(null)
  const [joining, setJoining] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setChannels(null)
    const timer = window.setTimeout(() => {
      chatApi.browseChannels(query.trim(), joined)
        .then(list => { if (alive) setChannels(list) })
        .catch(() => { if (alive) setChannels([]) })
    }, query.trim() ? 300 : 0)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [query, joined])

  async function join(id: string) {
    if (joining) return
    setJoining(id)
    try {
      await chatApi.joinMeeting(id)
      await fetchConvs()
      setActiveConv(id)
    } catch (e) {
      console.error('joinSpace', e)
    } finally {
      setJoining(null)
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <header className="flex items-center gap-3 px-6 pt-5 pb-3">
        <button onClick={() => setHomeView('home')} className="p-1.5 rounded-full hover:bg-gray-100">
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <h1 className="text-2xl text-gray-900">{t('chat_browse_spaces', { defaultValue: 'Parcourir les espaces' })}</h1>
      </header>

      <div className="flex items-center gap-3 px-6 pb-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('chat_search_spaces', { defaultValue: 'Rechercher des espaces' })}
            className="w-full rounded-full border border-gray-200 pl-9 pr-3 py-1.5 text-sm focus:outline-none focus:border-blue-400"
          />
        </div>
        <button
          onClick={() => setJoined(v => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border transition-colors ${
            joined ? 'border-primary text-primary bg-primary/5' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
        >
          {joined && <Check className="w-3.5 h-3.5" />}
          {joined
            ? t('chat_spaces_joined', { defaultValue: 'Espaces que j’ai rejoints' })
            : t('chat_spaces_not_joined', { defaultValue: 'Espaces que je n’ai pas rejoints' })}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {channels === null ? (
          <p className="text-sm text-gray-400 py-6">{t('common_loading')}</p>
        ) : channels.length === 0 ? (
          <EmptyIllustration
            icon={<Users className="w-10 h-10 text-gray-300" />}
            title={t('chat_no_results')}
            hint={t('chat_browse_hint', { defaultValue: 'Essayez un autre terme de recherche.' })}
          />
        ) : (
          channels.map(ch => (
            <div key={ch.id} className="flex items-center gap-4 py-3 border-b border-gray-100">
              <div className="w-11 h-11 rounded-xl bg-surface-2 flex items-center justify-center text-base font-semibold text-text-secondary flex-shrink-0">
                {(ch.name?.[0] ?? '?').toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] text-gray-900 truncate">{ch.name ?? t('chat_type_channel')}</p>
                <p className="text-sm text-gray-500 truncate">
                  {t('chat_members_count', { count: ch.member_count, defaultValue: '{{count}} membre(s)' })}
                  {ch.description ? ` · ${ch.description}` : ''}
                </p>
              </div>
              {ch.is_member ? (
                <button onClick={() => setActiveConv(ch.id)} className="px-4 py-1.5 rounded-full text-sm border border-gray-200 text-gray-700 hover:bg-gray-50">
                  {t('chat_open', { defaultValue: 'Ouvrir' })}
                </button>
              ) : (
                <button
                  onClick={() => join(ch.id)}
                  disabled={joining === ch.id}
                  className="px-4 py-1.5 rounded-full text-sm bg-primary text-white hover:opacity-90 disabled:opacity-50"
                >
                  {t('chat_join', { defaultValue: 'Rejoindre' })}
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
