import { useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { useWsChat } from './useWsChat'

export default function ChatGlobalService() {
  const location = useLocation()
  const isOnChatPage = useCallback(
    () => location.pathname.startsWith('/chat'),
    [location.pathname],
  )
  useWsChat(isOnChatPage)
  return null
}
