import { useEffect, useRef, useCallback } from 'react'
import { useAuthStore } from '@kubuno/sdk'
import { useChatStore, getConvName } from './chatStore'
import { useNotificationStore } from '@kubuno/sdk'
import { DecodedMessage } from './api'

function tryDecodeText(encrypted: string): string | null {
  try {
    const parsed = JSON.parse(atob(encrypted.replace(/-/g, '+').replace(/_/g, '/')))
    if (typeof parsed?.text === 'string') return parsed.text
  } catch {}
  try { return atob(encrypted.replace(/-/g, '+').replace(/_/g, '/')) } catch {}
  return null
}

// isOnChatPage: callback fourni par Shell — doit retourner l'état courant de la route
export function useWsChat(isOnChatPage: () => boolean) {
  const accessToken = useAuthStore(s => s.accessToken)
  const currentUser = useAuthStore(s => s.user)
  const {
    setWsStatus, appendMessage, updateMessage, setTyping, setUserOnline,
    fetchConversations, setSendTypingFn, setSendCallSignalFn,
    setIncomingCall, setActiveCall,
  } = useChatStore()
  const pushNotification = useNotificationStore(s => s.push)

  const wsRef             = useRef<WebSocket | null>(null)
  const timerRef          = useRef<number | null>(null)
  const activeRef         = useRef(false)
  const reconnectDelayRef = useRef(2_000)
  const reconnectTimerRef = useRef<number | null>(null)
  const isOnChatRef       = useRef(isOnChatPage)
  const currentUserRef    = useRef(currentUser)

  // Garder les refs à jour sans rouvrir le WebSocket
  useEffect(() => { isOnChatRef.current = isOnChatPage }, [isOnChatPage])
  useEffect(() => { currentUserRef.current = currentUser }, [currentUser])

  // Expose sendTyping via le store pour que ConversationView n'ait pas besoin du prop
  const sendTyping = useCallback((convId: string, isTyping: boolean) => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        action: isTyping ? 'typing_start' : 'typing_stop',
        conversation_id: convId,
      }))
    }
  }, [])

  const sendCallSignal = useCallback((toUserId: string, signal: object) => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ action: 'call_signal', to_user_id: toUserId, signal }))
    }
  }, [])

  useEffect(() => {
    setSendTypingFn(sendTyping)
  }, [sendTyping, setSendTypingFn])

  useEffect(() => {
    setSendCallSignalFn(sendCallSignal)
  }, [sendCallSignal, setSendCallSignalFn])

  useEffect(() => {
    if (!accessToken) return

    activeRef.current = true

    function connect() {
      if (!activeRef.current) return
      setWsStatus('connecting')
      const token = useAuthStore.getState().accessToken ?? ''
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/v1/chat/ws?token=${encodeURIComponent(token)}`)
      wsRef.current = ws

      const connectTime = Date.now()
      ws.onopen = () => {
        if (!activeRef.current) { ws.close(); return }
        reconnectDelayRef.current = 2_000  // reset backoff on successful open
        setWsStatus('connected')
        timerRef.current = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ action: 'ping' }))
        }, 25_000)
      }

      ws.onclose = () => {
        if (timerRef.current) clearInterval(timerRef.current)
        if (!activeRef.current) return
        setWsStatus('disconnected')

        const openedSuccessfully = Date.now() - connectTime > 2_000
        if (!openedSuccessfully) {
          // Connection failed immediately — likely auth or module down; apply backoff
          reconnectDelayRef.current = Math.min(60_000, reconnectDelayRef.current * 2)
        }

        reconnectTimerRef.current = window.setTimeout(connect, reconnectDelayRef.current)
      }

      ws.onerror = () => ws.close()

      ws.onmessage = (ev) => {
        if (!activeRef.current) return
        try {
          const env = JSON.parse(ev.data) as { event: string; payload: Record<string, unknown> }
          handleEvent(env.event, env.payload)
        } catch {}
      }
    }

    function handleEvent(event: string, payload: Record<string, unknown>) {
      switch (event) {
        case 'new_message': {
          const raw = payload.message as Record<string, unknown>
          if (!raw) break
          const msg: DecodedMessage = {
            ...(raw as unknown as DecodedMessage),
            plaintext: tryDecodeText(raw.encrypted_data as string),
          }
          appendMessage(msg.conversation_id, msg)
          fetchConversations()

          // Notification si l'utilisateur n'est pas sur la page chat
          // ou si la conversation n'est pas celle actuellement affichée
          const onChat = isOnChatRef.current()
          const isActiveConv = useChatStore.getState().activeConvId === msg.conversation_id
          if (!onChat || !isActiveConv) {
            const convSummary = useChatStore.getState().conversations.find(
              c => c.conversation.id === msg.conversation_id
            )
            const convName = convSummary
              ? getConvName(convSummary.conversation, currentUserRef.current?.id ?? '', convSummary.other_user)
              : 'Chat'
            const preview = msg.plaintext ?? '…'
            pushNotification({
              title:    convName,
              body:     preview.length > 80 ? preview.slice(0, 80) + '…' : preview,
              moduleId: 'chat',
              icon:     'MessageSquare',
              link:     '/chat',
            })
          }
          break
        }
        case 'message_updated': {
          const raw = payload.message as Record<string, unknown>
          if (!raw) break
          const convId = raw.conversation_id as string
          if (convId) {
            const decoded = raw.deleted ? undefined : tryDecodeText(raw.encrypted_data as string)
            updateMessage(convId, {
              id:          raw.id as string,
              message_type: raw.deleted ? 'deleted' : raw.message_type as string,
              deleted_at:  raw.deleted ? new Date().toISOString() : null,
              ...(decoded !== undefined ? { plaintext: decoded } : {}),
            } as Parameters<typeof updateMessage>[1])
          }
          break
        }
        case 'typing_start':
          setTyping(payload.conversation_id as string, payload.user_id as string, true)
          setTimeout(() => setTyping(payload.conversation_id as string, payload.user_id as string, false), 4000)
          break
        case 'typing_stop':
          setTyping(payload.conversation_id as string, payload.user_id as string, false)
          break
        case 'presence_update':
          setUserOnline(payload.user_id as string, payload.status === 'online')
          break
        case 'conversation_created':
          fetchConversations()
          break
        case 'call_signal': {
          const sig = payload.signal as Record<string, unknown>
          if (!sig) break
          const sigType   = sig.type as string
          const fromUser  = payload.from_user_id as string
          const convIdSig = payload.conversation_id as string | undefined

          if (sigType === 'call_offer') {
            setIncomingCall({
              convId:    convIdSig ?? '',
              fromUserId: fromUser,
              fromName:  (sig.from_name as string) ?? fromUser.slice(0, 8),
              type:      (sig.call_type as 'audio' | 'video') ?? 'audio',
              sdpOffer:  { type: 'offer', sdp: sig.sdp as string },
            })
          } else if (sigType === 'call_end' || sigType === 'call_busy') {
            // Si l'appel entrant était encore en attente → appel manqué
            const pending = useChatStore.getState().incomingCall
            if (pending && pending.fromUserId === fromUser) {
              const callType = pending.type === 'video' ? 'vidéo' : 'audio'
              pushNotification({
                title:    'Appel manqué',
                body:     `${pending.fromName} vous a appelé (${callType})`,
                moduleId: 'chat',
                icon:     'PhoneMissed',
                link:     '/chat',
              })
            }
            setIncomingCall(null)
            setActiveCall(null)
          }
          // ice_candidate and call_answer are handled directly by CallWindow via store
          // We dispatch a custom event so CallWindow can pick it up
          window.dispatchEvent(new CustomEvent('chat:call_signal', {
            detail: { signal: sig, fromUserId: fromUser },
          }))
          break
        }
      }
    }

    connect()

    return () => {
      activeRef.current = false
      if (timerRef.current) clearInterval(timerRef.current)
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      wsRef.current?.close()
    }
  }, [accessToken]) // eslint-disable-line react-hooks/exhaustive-deps

  // Exposé pour usage direct (ex: depuis ConversationView via le store)
  return { sendTyping }
}
