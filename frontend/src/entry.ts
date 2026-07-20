/** Bundle MODULE chat — chargé à l'exécution (cf. vite.module.config). */
import { lazy } from 'react'
import { RouteRegistry, WaffleAppRegistry, SlotRegistry, FaviconRegistry, useToolbarStore, useSidebarStore, useSearchStore, ModuleServiceRegistry, ModuleSettingsRegistry, NotificationRegistry, SDK_VERSION } from '@kubuno/sdk'
import './index.css'
import './i18n'
import { chatApi } from './api'
import ChatLogo from './ChatLogo'
import CallManager from './CallWindow'
import ChatGlobalService from './ChatGlobalService'
import ChatPopups from './ChatPopups'
import ChatStatusMenu from './ChatStatusMenu'
import ChatSidebarBody from './ChatSidebarBody'

export const sdkVersion = SDK_VERSION

export function register() {
  FaviconRegistry.register('chat', '/chat-logo.svg')

  // Nom d'application = marque, jamais traduit.
  WaffleAppRegistry.register('chat', 'Chat', [
    { id: 'chat', label: 'Chat', Icon: ChatLogo, path: '/chat' },
  ])

  // The header gear button opens the per-user Chat settings while in /chat.
  ModuleSettingsRegistry.register('chat')

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

  // Routes
  const ChatPage         = lazy(() => import('./ChatPage'))
  const ChatSettingsPage = lazy(() => import('./ChatSettingsPage'))

  const ChatMeetingPage  = lazy(() => import('./ChatMeetingPage'))

  RouteRegistry.register('chat',          ChatPage)
  RouteRegistry.register('chat/settings', ChatSettingsPage)
  RouteRegistry.register('chat/meet/:id', ChatMeetingPage)

  // Inter-module service: other modules (e.g. calendar) can create a video
  // meeting without any hard dependency on chat. Discovery is dynamic.
  ModuleServiceRegistry.publish('chat', {
    createMeeting: async (title: string, attendeeIds: string[] = []) => {
      const conv = await chatApi.createMeeting(title || 'Réunion', attendeeIds)
      return { link: `/chat/meet/${conv.id}`, roomId: conv.id, provider: 'chat' }
    },
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
