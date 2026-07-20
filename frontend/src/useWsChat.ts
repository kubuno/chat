import { useEffect, useRef, useCallback } from 'react'
import { useAuthStore } from '@kubuno/sdk'
import { useChatStore, getConvName, decodeEnvelope, type PresenceStatus } from './chatStore'
import { useNotificationStore } from '@kubuno/sdk'
import { DecodedMessage } from './api'

// Aperçu lisible d'un message pour les notifications (média → libellé).
function previewOf(text: string | null, media: { kind: string; voice?: boolean } | null): string {
  if (media) {
    if (media.voice) return '🎤 Message vocal'
    if (media.kind === 'image') return '📷 Photo'
    if (media.kind === 'video') return '🎬 Vidéo'
    if (media.kind === 'audio') return '🎵 Audio'
    return '📎 Fichier'
  }
  return text ?? '…'
}

// isOnChatPage: callback fourni par Shell — doit retourner l'état courant de la route
export function useWsChat(isOnChatPage: () => boolean) {
  const accessToken = useAuthStore(s => s.accessToken)
  const currentUser = useAuthStore(s => s.user)
  const {
    setWsStatus, appendMessage, updateMessage, setTyping,
    fetchConversations, bumpConversation, setSendTypingFn, setSendCallSignalFn,
    setIncomingCall, applyReaction,
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
          const env = decodeEnvelope(raw.encrypted_data as string)
          const msg: DecodedMessage = {
            ...(raw as unknown as DecodedMessage),
            plaintext: env.text,
            media:     env.media,
            poll:      env.poll,
          }
          appendMessage(msg.conversation_id, msg)
          // Reorder/badge locally — refetching the whole list on every incoming
          // message hammered the API for information we already have.
          bumpConversation(msg.conversation_id, msg.sender_id === currentUserRef.current?.id)

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
            const preview = previewOf(msg.plaintext, msg.media ?? null)
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
            const env = raw.deleted ? null : decodeEnvelope(raw.encrypted_data as string)
            updateMessage(convId, {
              id:          raw.id as string,
              message_type: raw.deleted ? 'deleted' : raw.message_type as string,
              deleted_at:  raw.deleted ? new Date().toISOString() : null,
              is_pinned:   raw.is_pinned as boolean | undefined,
              pinned_at:   raw.pinned_at as string | null | undefined,
              ...(env ? { plaintext: env.text, media: env.media, poll: env.poll } : {}),
            } as Parameters<typeof updateMessage>[1])
          }
          break
        }
        case 'poll_update': {
          // Let the open poll component refetch its tallies.
          window.dispatchEvent(new CustomEvent('chat:poll_update', { detail: { messageId: payload.message_id } }))
          break
        }
        case 'reaction_update': {
          const msgId  = payload.message_id as string
          const userId = payload.user_id as string
          const emoji  = payload.emoji as string
          const add    = (payload.action as string) !== 'remove'
          if (!msgId) break
          // The payload has no conversation_id → find which conversation holds it.
          const all = useChatStore.getState().messages
          const convId = Object.keys(all).find(cid => all[cid]?.some(m => m.id === msgId))
          if (convId) applyReaction(convId, msgId, emoji, userId, add)
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
          useChatStore.getState().setUserPresence(
            payload.user_id as string,
            (payload.status as PresenceStatus) ?? 'offline',
            (payload.custom_status as string | null) ?? null,
          )
          break
        case 'conversation_created':
          fetchConversations()
          break
        case 'call_signal': {
          const sig = payload.signal as Record<string, unknown>
          if (!sig) break
          const sigType  = sig.type as string
          const fromUser = payload.from_user_id as string
          const room     = sig.room as string | undefined

          if (sigType === 'call_ring') {
            // Ne pas sonner si déjà en appel.
            if (!useChatStore.getState().activeCall) {
              setIncomingCall({
                room:       room ?? '',
                fromUserId: fromUser,
                fromName:   (sig.from_name as string) ?? fromUser.slice(0, 8),
                type:       (sig.call_type as 'audio' | 'video') ?? 'audio',
              })
            }
          } else if (sigType === 'call_leave') {
            // L'appelant a raccroché alors que l'appel entrant sonnait encore → manqué.
            const pending = useChatStore.getState().incomingCall
            if (pending && pending.fromUserId === fromUser && pending.room === room) {
              const callType = pending.type === 'video' ? 'vidéo' : 'audio'
              pushNotification({
                title:    'Appel manqué',
                body:     `${pending.fromName} vous a appelé (${callType})`,
                moduleId: 'chat',
                icon:     'PhoneMissed',
                link:     '/chat',
              })
              setIncomingCall(null)
            }
          }
          // Tous les signaux (join/present/offer/answer/ice/leave/state/reaction)
          // sont relayés à la fenêtre d'appel active via un événement DOM.
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
