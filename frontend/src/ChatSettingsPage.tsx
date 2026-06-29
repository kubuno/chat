import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { MessageSquare, ArrowLeft, ExternalLink, Check } from 'lucide-react'
import { Toggle, Button, Radio } from '@ui'
import { useModulePrefs } from './userPrefs'

// ── Per-user preferences (backend, cross-device via core users.preferences) ─────

// A `type` alias (not `interface`) so it carries an implicit index signature and
// satisfies the `Record<string, unknown>` constraint of `useModulePrefs`.
type ChatPrefs = {
  density:       string   // 'compact' | 'cozy' | 'comfortable'
  enterToSend:   boolean  // Enter sends (Shift+Enter = newline) vs the opposite
  linkPreviews:  boolean
  notifSounds:   boolean
  readReceipts:  boolean
  bubbleTheme:   string   // 'default' | 'rounded' | 'minimal'
}

const DEFAULT_PREFS: ChatPrefs = {
  density: 'cozy', enterToSend: true, linkPreviews: true,
  notifSounds: true, readReceipts: true, bubbleTheme: 'default',
}

// ── Mail-style layout helpers ───────────────────────────────────────────────────

function SettingsRow({ label, description, children }: {
  label: string; description?: string; children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-8 py-4 border-b border-[#e8eaed] last:border-0">
      <div className="w-60 flex-shrink-0">
        <p className="text-sm text-[#202124] font-normal">{label}</p>
        {description && <p className="text-xs text-text-tertiary mt-0.5 leading-relaxed">{description}</p>}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  )
}

function RadioGroup({ options, value, onChange }: {
  options: { value: string; label: string }[]; value: string; onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-col items-start gap-2">
      {options.map(opt => (
        <Radio key={opt.value} checked={value === opt.value} onChange={() => onChange(opt.value)} label={opt.label} />
      ))}
    </div>
  )
}

// ── Préférences tab (per-user) ──────────────────────────────────────────────────

function PreferencesTab() {
  const { t } = useTranslation('chat')
  const { prefs: saved, update } = useModulePrefs<ChatPrefs>('chat', DEFAULT_PREFS)
  const [prefs, setPrefs] = useState<ChatPrefs>(saved)
  const [savedFlag, setSavedFlag] = useState(false)
  const [busy, setBusy] = useState(false)

  const set = <K extends keyof ChatPrefs>(key: K, value: ChatPrefs[K]) =>
    setPrefs(p => ({ ...p, [key]: value }))

  const save = async () => {
    setBusy(true)
    try {
      await update(prefs)
      setSavedFlag(true)
      setTimeout(() => setSavedFlag(false), 2500)
    } finally { setBusy(false) }
  }

  return (
    <div>
      <SettingsRow
        label={t('chat_pref_density', { defaultValue: 'Densité des messages' })}
        description={t('chat_pref_density_desc', { defaultValue: 'Espacement vertical entre les messages.' })}
      >
        <RadioGroup
          value={prefs.density}
          onChange={v => set('density', v)}
          options={[
            { value: 'compact',     label: t('chat_pref_density_compact',     { defaultValue: 'Compacte (plus de messages)' }) },
            { value: 'cozy',        label: t('chat_pref_density_cozy',        { defaultValue: 'Normale' }) },
            { value: 'comfortable', label: t('chat_pref_density_comfortable', { defaultValue: 'Aérée' }) },
          ]}
        />
      </SettingsRow>

      <SettingsRow
        label={t('chat_pref_enter', { defaultValue: 'Envoi des messages' })}
        description={t('chat_pref_enter_desc', { defaultValue: 'Choisissez quelle touche envoie le message.' })}
      >
        <RadioGroup
          value={prefs.enterToSend ? 'enter' : 'mod'}
          onChange={v => set('enterToSend', v === 'enter')}
          options={[
            { value: 'enter', label: t('chat_pref_enter_send',    { defaultValue: 'Entrée envoie (Maj+Entrée = nouvelle ligne)' }) },
            { value: 'mod',   label: t('chat_pref_enter_newline', { defaultValue: 'Maj+Entrée envoie (Entrée = nouvelle ligne)' }) },
          ]}
        />
      </SettingsRow>

      <SettingsRow
        label={t('chat_pref_bubble', { defaultValue: 'Thème des bulles' })}
        description={t('chat_pref_bubble_desc', { defaultValue: 'Apparence des bulles de message.' })}
      >
        <RadioGroup
          value={prefs.bubbleTheme}
          onChange={v => set('bubbleTheme', v)}
          options={[
            { value: 'default', label: t('chat_pref_bubble_default', { defaultValue: 'Par défaut' }) },
            { value: 'rounded', label: t('chat_pref_bubble_rounded', { defaultValue: 'Arrondi' }) },
            { value: 'minimal', label: t('chat_pref_bubble_minimal', { defaultValue: 'Minimal' }) },
          ]}
        />
      </SettingsRow>

      <SettingsRow label={t('chat_pref_link_previews', { defaultValue: 'Aperçus de liens' })}>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <Toggle checked={prefs.linkPreviews} onChange={() => set('linkPreviews', !prefs.linkPreviews)} />
          <span className="text-sm text-text-primary">{t('chat_pref_link_previews_on', { defaultValue: 'Afficher un aperçu des liens partagés' })}</span>
        </label>
      </SettingsRow>

      <SettingsRow label={t('chat_pref_sounds', { defaultValue: 'Sons de notification' })}>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <Toggle checked={prefs.notifSounds} onChange={() => set('notifSounds', !prefs.notifSounds)} />
          <span className="text-sm text-text-primary">{t('chat_pref_sounds_on', { defaultValue: 'Jouer un son aux nouveaux messages' })}</span>
        </label>
      </SettingsRow>

      <SettingsRow label={t('chat_pref_receipts', { defaultValue: 'Accusés de lecture' })}>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <Toggle checked={prefs.readReceipts} onChange={() => set('readReceipts', !prefs.readReceipts)} />
          <span className="text-sm text-text-primary">{t('chat_pref_receipts_on', { defaultValue: 'Afficher les accusés de lecture' })}</span>
        </label>
      </SettingsRow>

      <div className="pt-5 flex items-center gap-3">
        <Button onClick={save} loading={busy}>
          {savedFlag
            ? <><Check size={14} className="mr-1.5 inline" />{t('chat_settings_saved', { defaultValue: 'Enregistré' })}</>
            : t('chat_settings_save_changes', { defaultValue: 'Enregistrer les modifications' })}
        </Button>
        <Button variant="ghost" onClick={() => setPrefs(saved)}>
          {t('common_cancel', { defaultValue: 'Annuler' })}
        </Button>
      </div>
    </div>
  )
}

// ── About tab ───────────────────────────────────────────────────────────────────

function AboutTab() {
  const { t } = useTranslation('chat')
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-border bg-surface-1">
        <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
          <MessageSquare size={20} className="text-blue-600" />
        </div>
        <div>
          <p className="text-sm font-semibold text-text-primary">Kubuno Chat</p>
          <p className="text-xs text-text-tertiary">v0.1.0 · {t('chat_official_module', { defaultValue: 'Module officiel' })}</p>
        </div>
        <span className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">Rust</span>
      </div>
      <div className="px-5 py-4">
        <a href="https://github.com/kubuno/kubuno" target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
          <ExternalLink size={13} /> github.com/kubuno/kubuno
        </a>
      </div>
    </div>
  )
}

// ── Main page (mail-style breadcrumb + tab bar) ─────────────────────────────────

type Tab = 'preferences' | 'about'

export default function ChatSettingsPage() {
  const { t } = useTranslation('chat')
  const [tab, setTab] = useState<Tab>('preferences')

  // Instance-wide settings now live in the core admin console; only per-user
  // preferences remain here.
  const visibleTabs: { id: Tab; label: string }[] = [
    { id: 'preferences', label: t('chat_tab_preferences', { defaultValue: 'Préférences' }) },
    { id: 'about',       label: t('chat_tab_about', { defaultValue: 'À propos' }) },
  ]

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      {/* Breadcrumb header */}
      <div className="flex items-center gap-2 px-6 py-2.5 border-b border-[#e8eaed] flex-shrink-0" style={{ background: '#f8f9fa' }}>
        <Link to="/chat" className="flex items-center gap-1.5 text-sm text-[#1a73e8] hover:underline">
          <ArrowLeft size={14} />
          Chat
        </Link>
        <span className="text-text-tertiary text-sm">/</span>
        <div className="flex items-center gap-1.5">
          <MessageSquare size={15} className="text-text-secondary" />
          <span className="text-sm text-text-primary">{t('chat_settings_title', { defaultValue: 'Réglages' })}</span>
        </div>
      </div>

      {/* Tab bar (Gmail-style) */}
      <div className="flex items-end border-b border-[#e8eaed] px-4 flex-shrink-0 overflow-x-auto" style={{ background: '#fff' }}>
        {visibleTabs.map(tb => (
          <button key={tb.id} onClick={() => setTab(tb.id)}
            className={`px-4 py-3 text-sm border-b-2 -mb-px transition-colors whitespace-nowrap ${
              tab === tb.id ? 'border-[#1a73e8] text-[#1a73e8] font-medium' : 'border-transparent text-[#5f6368] hover:text-[#202124] hover:bg-[#f1f3f4]'}`}>
            {tb.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-8 py-6">
          {tab === 'preferences' && <PreferencesTab />}
          {tab === 'about'      && <AboutTab />}
        </div>
      </div>
    </div>
  )
}
