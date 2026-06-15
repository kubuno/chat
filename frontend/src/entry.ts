/** Bundle MODULE chat — chargé à l'exécution (cf. vite.module.config). */
import { lazy } from 'react'
import { RouteRegistry, WaffleAppRegistry, SlotRegistry, FaviconRegistry, useToolbarStore, useSidebarStore, useSearchStore, SDK_VERSION } from '@kubuno/sdk'
import './index.css'
import './i18n'
import ChatLogo from './ChatLogo'
import CallManager from './CallWindow'
import ChatGlobalService from './ChatGlobalService'
import ChatSidebarBody from './ChatSidebarBody'

export const sdkVersion = SDK_VERSION

export function register() {
  FaviconRegistry.register('chat', '/chat-logo.svg')

  // Nom d'application = marque, jamais traduit.
  WaffleAppRegistry.register('chat', 'Chat', [
    { id: 'chat', label: 'Chat', Icon: ChatLogo, path: '/chat' },
  ])

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

  RouteRegistry.register('chat',          ChatPage)
  RouteRegistry.register('chat/settings', ChatSettingsPage)

  // Overlay appels (entrants + actifs) — rendu partout via le slot global app-dialogs
  SlotRegistry.register('app-dialogs',     'chat', CallManager)
  // Connexion WebSocket globale — active peu importe le module affiché
  SlotRegistry.register('global-services', 'chat', ChatGlobalService)
}
