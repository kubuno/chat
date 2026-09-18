/** Bundle MODULE chat — chargé à l'exécution (cf. vite.module.config). */
import { lazy } from 'react'
import { RouteRegistry, WaffleAppRegistry, SlotRegistry, ExtensionRegistry, FaviconRegistry, useToolbarStore, useSidebarStore, useSearchStore, ModuleServiceRegistry, ModuleSettingsRegistry, NotificationRegistry, useRightPanelStore, SDK_VERSION } from '@kubuno/sdk'
import './index.css'
import { MessageCircle } from 'lucide-react'
import ChatMiniPanel from './ChatMiniPanel'
import './i18n'
import { chatApi } from './api'
import ChatLogo from './ChatLogo'
import ChatMeetingField from './ChatMeetingField'
import { registerBuiltinActivities } from './meetingActivities'
import { meetingMediaFor } from './meetingMedia'
import i18n from 'i18next'
import CallManager from './CallWindow'
import ChatGlobalService from './ChatGlobalService'
import ChatPopups from './ChatPopups'
import ChatStatusMenu from './ChatStatusMenu'
import ChatSidebarBody from './ChatSidebarBody'
import { registerChatAdmin } from './admin/ChatAdminPanel'

export const sdkVersion = SDK_VERSION

export function register() {
  FaviconRegistry.register('chat', '/chat-logo.png')

  // Nom d'application = marque, jamais traduit.
  WaffleAppRegistry.register('chat', 'Chat', [
    { id: 'chat', label: 'Chat', Icon: ChatLogo, path: '/chat' },
  ])

  // The header gear button opens the per-user Chat settings while in /chat.
  ModuleSettingsRegistry.register('chat')

  // Instance administration (E2E banner, retention, media, GIPHY) in the core
  // admin console.
  registerChatAdmin()

  // Declare the notification activities shown in the core Settings → Notifications matrix.
  NotificationRegistry.register({
    moduleId: 'chat',
    title: 'Messages',
    order: 40,
    activities: [
      { id: 'direct_message', label: 'Nouveau message direct', pushDefault: true },
      { id: 'mention', label: 'Vous êtes mentionné', emailDefault: true, pushDefault: true },
      { id: 'call_invite', label: 'Invitation à un appel', pushDefault: true },
    ],
  })

  useToolbarStore.getState().register({
    moduleId:    'chat',
    routePrefix: '/chat',
    noPadding:   true,
  })

  useSidebarStore.getState().register({
    moduleId:    'chat',
    routePrefix: '/chat',
    SidebarBody: ChatSidebarBody,
    collapsedBody: true,
  })

  useSearchStore.getState().register({
    moduleId:    'chat',
    routePrefix: '/chat',
    placeholder: 'Rechercher dans les messages…',
    placeholderKey: 'chat:chat_search_ph',
    onSearch:    () => {},
  })

  // Side panel: who is waiting, without leaving the page.
  useRightPanelStore.getState().registerEntry({
    moduleId:       'chat',
    icon:           ChatLogo,
    label:          'Chat',
    panelComponent: ChatMiniPanel,
    openPath:       '/chat',
  })

  // Routes
  const ChatPage         = lazy(() => import('./ChatPage'))
  const ChatSettingsPage = lazy(() => import('./ChatSettingsPage'))

  const ChatMeetingPage  = lazy(() => import('./ChatMeetingPage'))

  RouteRegistry.register('chat',          ChatPage)
  RouteRegistry.register('chat/settings', ChatSettingsPage)
  RouteRegistry.register('chat/meet/:id', ChatMeetingPage)

  // Inter-module service: other modules (e.g. calendar) can create a video
  // meeting without any hard dependency on chat. Discovery is dynamic.
  //
  // A form that creates a room before it is itself saved (an event, a task)
  // asks for a `provisional` one and then says which way it went: `confirm`
  // once it is saved, `drop` if it is abandoned or the call is taken back off
  // it. Saying nothing at all is allowed too — a provisional room carries its
  // own deadline and the server sweeps it away, which is what covers a reloaded
  // page, a closed tab or a machine that simply went to sleep.
  ModuleServiceRegistry.publish('chat', {
    createMeeting: async (title: string, attendeeIds: string[] = [], opts?: { provisional?: boolean }) => {
      const conv = await chatApi.createMeeting(title || 'Réunion', attendeeIds, opts?.provisional === true)
      return { link: `/chat/meet/${conv.id}`, roomId: conv.id, provider: 'chat' }
    },
    confirmMeeting: (roomId: string) => chatApi.confirmProvisional(roomId),
    dropProvisionalMeeting: (roomId: string) => chatApi.dropProvisional(roomId),
  })

  // Calendar leaves a hole where the video call of an event goes; this module
  // hosts calls, so it fills it. Eager import, no `lazy`: calendar renders the
  // override where its own field stood, with no Suspense around it.
  SlotRegistry.registerOverride('video-meeting-field', 'chat', ChatMeetingField)

  // What THIS module can do with a person, offered to whoever shows one — a
  // guest's card in the calendar today. Two acts it owns and nobody else can
  // perform: opening a conversation with someone, and starting a call with
  // them. An instance without this module simply shows two buttons fewer.
  ExtensionRegistry.register('person.details', 'chat', {
    async lookup(person: { email?: string; userId?: string }) {
      // Both acts need an ACCOUNT: there is nobody to talk to behind an outside
      // address. Offering them anyway would be a button that always fails.
      if (!person.userId) return {}
      return {
        actions: [
          {
            id:    'chat.talk',
            label: i18n.t('chat:person_chat', { defaultValue: 'Discuter' }) as string,
            icon:  'chat',
            run: async () => {
              const conv = await chatApi.createDirect(person.userId as string)
              window.location.assign(`/chat?conversation=${conv.id}`)
            },
          },
          {
            id:    'chat.meet',
            label: i18n.t('chat:person_meet', { defaultValue: 'Démarrer une réunion' }) as string,
            icon:  'video',
            run: async () => {
              const conv = await chatApi.createMeeting(
                i18n.t('chat:chat_meeting_default_name', { defaultValue: 'Réunion' }) as string,
                [person.userId as string],
              )
              window.open(`${window.location.origin}/chat/meet/${conv.id}`, '_blank', 'noopener,noreferrer')
            },
          },
        ],
      }
    },
  })

  // In-meeting activities: this module owns the room, other modules own the
  // things shared in it. One is contributed here — putting a file in front of
  // everyone — and only when a module that can pick a file is installed.
  registerBuiltinActivities(
    (k, o) => i18n.t(`chat:${k}`, o as Record<string, unknown>) as string,
    { get: <T,>(m: string, n: string) => ModuleServiceRegistry.get(m, n) as T | undefined },
    async (room, text) => {
      const { encodeTextMessage } = await import('./chatStore')
      await chatApi.sendMessage(room, encodeTextMessage(text))
    },
  )

  /**
   * The meeting's own audio and video, offered to another module.
   *
   * This is the door the reference calls "third-party apps collecting audio
   * and video", and it is the ONLY one: the media is peer-to-peer inside this
   * tab, so nothing reaches it except through here. The host's setting is
   * enforced at the door rather than by whoever knocks — a permission checked
   * by the caller is not a permission.
   */
  ModuleServiceRegistry.publish('chat-media', {
    getMeetingMedia: (room: string) => meetingMediaFor(room),
  })

  // Overlay appels (entrants + actifs) — rendu partout via le slot global app-dialogs
  SlotRegistry.register('app-dialogs',     'chat', CallManager)
  // Fenêtres pop-up de conversation — flottantes, survivent au changement de module
  SlotRegistry.register('app-dialogs',     'chat', ChatPopups)
  // Sélecteur de statut (Actif / Ne pas déranger / Absent) dans la barre du haut
  SlotRegistry.register('topbar-actions',  'chat', ChatStatusMenu)
  // Connexion WebSocket globale — active peu importe le module affiché
  SlotRegistry.register('global-services', 'chat', ChatGlobalService)
}
