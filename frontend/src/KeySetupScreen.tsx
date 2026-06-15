import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Shield, Loader2, Lock } from 'lucide-react'
import { Button } from '@ui'
import { chatApi } from './api'
import { getOrCreateIdentityKey, getOrCreateSignedPreKey, generateOneTimePreKeys } from './crypto/KeyStore'
import { useChatStore } from './chatStore'

export default function KeySetupScreen() {
  const { t } = useTranslation('chat')
  const [step,   setStep]   = useState<'idle' | 'generating' | 'uploading' | 'done' | 'error'>('idle')
  const [error,  setError]  = useState<string | null>(null)
  const setKeysRegistered   = useChatStore(s => s.setKeysRegistered)

  async function setup() {
    setStep('generating')
    setError(null)
    try {
      const ik  = await getOrCreateIdentityKey()
      const spk = await getOrCreateSignedPreKey()
      const opks = await generateOneTimePreKeys(100)

      setStep('uploading')
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

      setStep('done')
      setTimeout(() => setKeysRegistered(true), 1000)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('chat_key_error_unknown'))
      setStep('error')
    }
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 text-center p-8">
      <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center">
        <Shield className="w-8 h-8 text-blue-600" />
      </div>

      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          {t('chat_key_heading')}
        </h2>
        <p className="text-sm text-gray-500 max-w-sm">
          {t('chat_key_intro')}
        </p>
      </div>

      <div className="flex flex-col items-center gap-2 text-sm text-gray-500">
        <div className="flex items-center gap-2">
          <Lock className="w-4 h-4 text-green-500" />
          <span>{t('chat_key_feature_local')}</span>
        </div>
        <div className="flex items-center gap-2">
          <Lock className="w-4 h-4 text-green-500" />
          <span>{t('chat_key_feature_server_blind')}</span>
        </div>
        <div className="flex items-center gap-2">
          <Lock className="w-4 h-4 text-green-500" />
          <span>{t('chat_key_feature_protocol')}</span>
        </div>
      </div>

      {step === 'idle' && (
        <Button onClick={setup}>
          {t('chat_key_setup_btn')}
        </Button>
      )}

      {(step === 'generating' || step === 'uploading') && (
        <div className="flex items-center gap-2 text-blue-600">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>{step === 'generating' ? t('chat_key_generating') : t('chat_key_uploading')}</span>
        </div>
      )}

      {step === 'done' && (
        <div className="text-green-600 font-medium">{t('chat_key_done')}</div>
      )}

      {step === 'error' && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-red-600 text-sm">{error}</p>
          <Button onClick={setup} variant="danger" size="sm">
            {t('chat_key_retry')}
          </Button>
        </div>
      )}
    </div>
  )
}
