import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageSquare } from 'lucide-react'
import { useChatStore } from './chatStore'
import { chatApi } from './api'
import { hasIdentityKey, getOrCreateIdentityKey, getOrCreateSignedPreKey, generateOneTimePreKeys } from './crypto/KeyStore'
import ConversationView from './ConversationView'

export default function ChatPage() {
  const { fetchConversations, setKeysRegistered } = useChatStore()
  const activeConvId  = useChatStore(s => s.activeConvId)
  const setActiveConv = useChatStore(s => s.setActiveConv)
  const sendTyping    = useChatStore(s => s.sendTyping)

  useEffect(() => {
    // Initialisation silencieuse des clés — aucune action requise de l'utilisateur
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
            signed_prekey: {
              id:         spk.id,
              public_key: spk.publicKeyB64,
              signature:  spk.signature,
            },
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
        // Échec silencieux
      }
    }

    initKeys()
    fetchConversations()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {activeConvId ? (
        <ConversationView
          key={activeConvId}
          convId={activeConvId}
          onBack={() => setActiveConv(null)}
          sendTyping={sendTyping}
        />
      ) : (
        <EmptyState />
      )}
    </div>
  )
}

function EmptyState() {
  const { t } = useTranslation('chat')
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-4">
      <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center">
        <MessageSquare className="w-8 h-8 text-gray-300" />
      </div>
      <div className="text-center">
        <p className="font-medium text-gray-600">{t('chat_empty_select')}</p>
        <p className="text-sm mt-1">{t('chat_empty_start_new')}</p>
      </div>
    </div>
  )
}
