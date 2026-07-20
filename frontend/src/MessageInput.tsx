import { useState, useRef, useCallback, useEffect, lazy, Suspense, KeyboardEvent, ClipboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { MenuDropdown, useMenuDropdown, type MenuItem } from '@ui'
import { ModuleServiceRegistry } from '@kubuno/sdk'
import { Send, Plus, X, Mic, Trash2, Loader2, BarChart3, Timer, Package, Smile, FileText, Image, Camera, Music, User, CalendarDays, Bold, Italic, Strikethrough, Code, Link, ChevronUp } from 'lucide-react'
import { DecodedMessage, type GifResult } from './api'
import { readKubunoData, type KubunoDataEnvelope } from './kubunoData'
import type { Sticker } from './stickers'

// Contract for a module able to hand us one of its records as a data card.
// Discovered at runtime: no hard dependency on contacts or calendar — the menu
// entry simply doesn't show up when the module isn't installed.
type CardPicker = () => Promise<KubunoDataEnvelope | null>
const cardPicker = (moduleId: string, service: string): CardPicker | undefined =>
  ModuleServiceRegistry.get<CardPicker>(moduleId, service)

// Heavy, rarely-opened UI: kept out of the composer's chunk.
const ExpressionPanel = lazy(() => import('./ExpressionPanel'))
const CameraCapture   = lazy(() => import('./CameraCapture'))
const StickerStudio   = lazy(() => import('./StickerStudio'))

interface Props {
  /** scheduledAt (ISO) is set when the user picked "send later". */
  onSend:    (text: string, scheduledAt?: string) => Promise<void>
  onSendFiles?: (files: File[], caption?: string) => Promise<void>
  onSendVoice?: (blob: Blob, durationSec: number, waveform: number[]) => Promise<void>
  onSendGif?: (gif: GifResult) => Promise<void>
  onSendSticker?: (sticker: Sticker) => Promise<void>
  onCreatePoll?: () => void
  ephemeralSecs?: number
  onCycleEphemeral?: () => void
  members?: { userId: string; name: string; username: string }[]
  onTyping?: (isTyping: boolean) => void
  replyTo?:  DecodedMessage | null
  onCancelReply?: () => void
  disabled?: boolean
  // Cross-module data card pasted into the composer (JSON envelope): the chip
  // is previewed above the textarea and sent along with the next message.
  pendingCard?: KubunoDataEnvelope | null
  onPasteCard?: (card: KubunoDataEnvelope) => void
  onCancelCard?: () => void
}

// Composer height: starts at two lines and grows with the content, up to ~8 lines.
const COMPOSER_MIN_H = 24
const COMPOSER_MAX_H = 240

// Downsample recorded audio into normalized peaks for the waveform display.
async function computeWaveform(blob: Blob, buckets = 32): Promise<number[]> {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer())
    const data = buf.getChannelData(0)
    const block = Math.max(1, Math.floor(data.length / buckets))
    const peaks: number[] = []
    for (let i = 0; i < buckets; i++) {
      let max = 0
      for (let j = 0; j < block; j++) {
        const v = Math.abs(data[i * block + j] || 0)
        if (v > max) max = v
      }
      peaks.push(max)
    }
    await ctx.close()
    const peak = Math.max(...peaks, 0.01)
    return peaks.map(p => Math.min(1, p / peak))
  } catch {
    return Array(buckets).fill(0.4)
  }
}

export default function MessageInput({ onSend, onSendFiles, onSendVoice, onSendGif, onSendSticker, onCreatePoll, ephemeralSecs = 0, onCycleEphemeral, members = [], onTyping, replyTo, onCancelReply, disabled, pendingCard, onPasteCard, onCancelCard }: Props) {
  const { t } = useTranslation('chat')
  const [text,      setText]      = useState('')
  const [sending,   setSending]   = useState(false)
  // @mention autocomplete: active when the text ends with "@token".
  const mentionMatch = /(?:^|\s)@(\w*)$/.exec(text)
  const mentionQuery = mentionMatch ? mentionMatch[1].toLowerCase() : null
  const mentionHits = mentionQuery !== null
    ? members.filter(m => m.username.toLowerCase().includes(mentionQuery) || m.name.toLowerCase().includes(mentionQuery)).slice(0, 6)
    : []

  function pickMention(username: string) {
    pushHistory(true)
    setText(t2 => t2.replace(/@\w*$/, `@${username} `))
    textareaRef.current?.focus()
  }
  const typingTimer = useRef<number | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // ── Undo / redo ──────────────────────────────────────────────────────────────
  // Programmatic rewrites (formatting, emoji, mentions) reset the DOM value and
  // destroy the browser's native undo stack — so the composer keeps its own.
  type Snapshot = { v: string; s: number; e: number }
  const undoRef = useRef<Snapshot[]>([])
  const redoRef = useRef<Snapshot[]>([])
  const lastPushRef = useRef(0)
  // Live mirror of `text`: pushHistory is called from memoized callbacks whose
  // closures are stale — reading the state there would snapshot old values.
  const textRef = useRef(text)
  useEffect(() => { textRef.current = text }, [text])

  const snap = (): Snapshot => {
    const ta = textareaRef.current
    const v = textRef.current
    return { v, s: ta?.selectionStart ?? v.length, e: ta?.selectionEnd ?? v.length }
  }

  /** force=true: programmatic edit → always its own undo step. Typing coalesces (700 ms). */
  function pushHistory(force = false) {
    const now = Date.now()
    if (!force && now - lastPushRef.current < 700 && undoRef.current.length > 0) return
    lastPushRef.current = now
    undoRef.current.push(snap())
    if (undoRef.current.length > 200) undoRef.current.shift()
    redoRef.current = []
  }

  function restore(sn: Snapshot) {
    setText(sn.v)
    requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (!ta) return
      ta.focus()
      ta.setSelectionRange(sn.s, sn.e)
      ta.style.height = 'auto'
      ta.style.height = Math.min(Math.max(ta.scrollHeight, COMPOSER_MIN_H), COMPOSER_MAX_H) + 'px'
    })
  }

  function undo() {
    const prev = undoRef.current.pop()
    if (prev === undefined) return
    redoRef.current.push(snap())
    restore(prev)
  }

  function redo() {
    const next = redoRef.current.pop()
    if (next === undefined) return
    undoRef.current.push(snap())
    restore(next)
  }
  const fileInputRef = useRef<HTMLInputElement>(null)
  const stickerInputRef = useRef<HTMLInputElement>(null)

  // ── Attachment menu / expression panel ───────────────────────────────────────
  const attachMenu = useMenuDropdown()
  // The paperclip opens one file chooser with a different `accept` per entry.
  const [accept, setAccept] = useState('')
  const [showExpressions, setShowExpressions] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [stickerSource, setStickerSource] = useState<File | null>(null)
  // Formatting bar shows only while text is selected inside the textarea.
  const [hasSelection, setHasSelection] = useState(false)
  // Images pasted into the composer, queued above the pill until send.
  const [pendingImages, setPendingImages] = useState<{ file: File; url: string }[]>([])

  function queueImages(files: File[]) {
    const imgs = files.filter(f => f.type.startsWith('image/'))
    if (!imgs.length) return
    setPendingImages(prev => [...prev, ...imgs.map(file => ({ file, url: URL.createObjectURL(file) }))])
  }

  function removePendingImage(url: string) {
    URL.revokeObjectURL(url)
    setPendingImages(prev => prev.filter(p => p.url !== url))
  }
  // Bumped after a sticker is created so the pack tab refetches it.
  const [stickerVersion, setStickerVersion] = useState(0)

  // The file chooser must open only once `accept` has been applied to the input.
  const pickFiles = useCallback((acceptFilter: string) => {
    setAccept(acceptFilter)
    window.setTimeout(() => fileInputRef.current?.click(), 0)
  }, [])

  // The space onboarding card lives in the message list, but only the composer
  // owns the file input — it asks for the chooser through a DOM event.
  useEffect(() => {
    const open = () => pickFiles('')
    window.addEventListener('chat:attach-file', open)
    return () => window.removeEventListener('chat:attach-file', open)
  }, [pickFiles])

  // ── Voice recording state ────────────────────────────────────────────────────
  const [recording, setRecording] = useState(false)
  const [elapsed,   setElapsed]   = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef   = useRef<Blob[]>([])
  const streamRef   = useRef<MediaStream | null>(null)
  const startRef    = useRef(0)
  const canceledRef = useRef(false)
  const elapsedTimer = useRef<number | null>(null)

  useEffect(() => () => {
    if (elapsedTimer.current) clearInterval(elapsedTimer.current)
    streamRef.current?.getTracks().forEach(tr => tr.stop())
  }, [])

  const handleChange = useCallback((val: string) => {
    pushHistory()
    setText(val)
    if (onTyping) {
      onTyping(true)
      if (typingTimer.current) clearTimeout(typingTimer.current)
      typingTimer.current = window.setTimeout(() => onTyping(false), 3000)
    }
    const ta = textareaRef.current
    if (ta) {
      ta.style.height = 'auto'
      ta.style.height = Math.min(Math.max(ta.scrollHeight, COMPOSER_MIN_H), COMPOSER_MAX_H) + 'px'
    }
  }, [onTyping])

  const handleSend = useCallback(async (scheduledAt?: string) => {
    const trimmed = text.trim()
    if ((!trimmed && !pendingCard && pendingImages.length === 0) || sending || disabled) return
    setSending(true)
    try {
      if (pendingImages.length > 0) {
        await onSendFiles?.(pendingImages.map(p => p.file), trimmed || undefined)
        pendingImages.forEach(p => URL.revokeObjectURL(p.url))
        setPendingImages([])
        // The card path still goes through onSend below when present.
        if (pendingCard) await onSend('', scheduledAt)
      } else {
        await onSend(trimmed, scheduledAt)
      }
      setText('')
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
      onTyping?.(false)
    } finally {
      setSending(false)
    }
  }, [text, pendingCard, pendingImages, sending, disabled, onSend, onSendFiles, onTyping])

  // ── Scheduled send ("send later") ────────────────────────────────────────────
  const scheduleMenu = useMenuDropdown()
  const [pickTimeOpen, setPickTimeOpen] = useState(false)
  const [pickedTime, setPickedTime] = useState('')

  function schedulePresets(): MenuItem[] {
    const items: MenuItem[] = [
      { type: 'label', text: t('chat_schedule_send', { defaultValue: "Programmer l'envoi" }) },
    ]
    const now = new Date()
    const fmtTime = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    // Today at 18:00 — only while it is still meaningfully in the future.
    const today18 = new Date(now); today18.setHours(18, 0, 0, 0)
    if (today18.getTime() - now.getTime() > 10 * 60_000) {
      items.push({ type: 'action', label: t('chat_schedule_today', { time: fmtTime(today18), defaultValue: "Aujourd'hui à {{time}}" }), onClick: () => handleSend(today18.toISOString()) })
    }
    const tomorrow8 = new Date(now); tomorrow8.setDate(tomorrow8.getDate() + 1); tomorrow8.setHours(8, 0, 0, 0)
    items.push({ type: 'action', label: t('chat_schedule_tomorrow', { time: fmtTime(tomorrow8), defaultValue: 'Demain à {{time}}' }), onClick: () => handleSend(tomorrow8.toISOString()) })
    const monday8 = new Date(now)
    monday8.setDate(monday8.getDate() + ((8 - monday8.getDay()) % 7 || 7))
    monday8.setHours(8, 0, 0, 0)
    items.push({ type: 'action', label: t('chat_schedule_monday', { time: fmtTime(monday8), defaultValue: 'lundi prochain à {{time}}' }), onClick: () => handleSend(monday8.toISOString()) })
    items.push({ type: 'separator' })
    items.push({ type: 'action', icon: <CalendarDays size={15} />, label: t('chat_schedule_pick', { defaultValue: 'Sélectionner une heure…' }), onClick: () => setPickTimeOpen(true) })
    return items
  }

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const key = e.key.toLowerCase()
      if (key === 'b' || key === 'i') {
        e.preventDefault()
        applyFormat(key === 'b' ? '**' : '*')
        return
      }
      // Own stack: the native one is broken by controlled-value rewrites.
      if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return }
      if (key === 'y' || (key === 'z' && e.shiftKey)) { e.preventDefault(); redo(); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // Detect cross-module JSON envelopes (data-kubuno marker) on paste and turn
  // them into a pending card instead of pasting their plain-text fallback.
  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (onPasteCard) {
      const env = readKubunoData(e.clipboardData)
      if (env) {
        e.preventDefault()
        onPasteCard(env)
        return
      }
    }
    // Pasted images (screenshots, copied pictures) queue above the pill and
    // leave with the message being typed — its text becomes their caption.
    if (onSendFiles) {
      const imgs = [...e.clipboardData.items]
        .filter(it => it.kind === 'file' && it.type.startsWith('image/'))
        .map(it => it.getAsFile())
        .filter((f): f is File => !!f)
      if (imgs.length) {
        e.preventDefault()
        queueImages(imgs)
      }
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files || !files.length || !onSendFiles) return
    setSending(true)
    try { await onSendFiles(Array.from(files)) }
    finally {
      setSending(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // ── Attachment menu (paperclip) ──────────────────────────────────────────────
  function attachItems(): MenuItem[] {
    const items: MenuItem[] = []
    if (onSendFiles) {
      items.push(
        { type: 'action', label: t('chat_attach_document', { defaultValue: 'Document' }), icon: <FileText size={17} className="text-violet-500" />,
          onClick: () => pickFiles('.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.txt,.csv,.zip,.kbdoc,.kbsheet,.kbslide') },
        { type: 'action', label: t('chat_attach_media', { defaultValue: 'Photos et vidéos' }), icon: <Image size={17} className="text-blue-500" />,
          onClick: () => pickFiles('image/*,video/*') },
        { type: 'action', label: t('chat_camera', { defaultValue: 'Caméra' }), icon: <Camera size={17} className="text-pink-500" />,
          onClick: () => setCameraOpen(true) },
        { type: 'action', label: t('chat_attach_audio', { defaultValue: 'Audio' }), icon: <Music size={17} className="text-orange-500" />,
          onClick: () => pickFiles('audio/*') },
      )
    }
    // Records offered by other installed modules, as data cards.
    if (onPasteCard) {
      const pickContact = cardPicker('contacts', 'pickContact')
      if (pickContact) {
        items.push({ type: 'action', label: t('chat_attach_contact', { defaultValue: 'Contact' }), icon: <User size={17} className="text-sky-500" />, onClick: () => pickCard(pickContact) })
      }
    }
    if (onCreatePoll) {
      items.push({ type: 'action', label: t('chat_poll', { defaultValue: 'Sondage' }), icon: <BarChart3 size={17} className="text-amber-500" />, onClick: onCreatePoll })
    }
    if (onPasteCard) {
      const pickEvent = cardPicker('calendar', 'pickEvent')
      if (pickEvent) {
        items.push({ type: 'action', label: t('chat_attach_event', { defaultValue: 'Événement' }), icon: <CalendarDays size={17} className="text-rose-500" />, onClick: () => pickCard(pickEvent) })
      }
    }
    if (onSendSticker) {
      items.push({ type: 'action', label: t('chat_sticker_new', { defaultValue: 'Nouveau sticker' }), icon: <StickerGlyph />, onClick: () => stickerInputRef.current?.click() })
    }
    if (onCycleEphemeral) {
      const state = ephemeralSecs
        ? (ephemeralSecs >= 86400 ? `${Math.round(ephemeralSecs / 86400)}j` : `${Math.round(ephemeralSecs / 3600)}h`)
        : null
      items.push({
        type: 'action',
        label: t('chat_ephemeral', { defaultValue: 'Message éphémère' }) + (state ? ` · ${state}` : ''),
        icon: <Timer size={17} className={ephemeralSecs ? 'text-blue-600' : 'text-teal-600'} />,
        onClick: onCycleEphemeral,
        checked: ephemeralSecs > 0,
      })
    }
    return items
  }

  // The picked record lands in the composer as a pending card: the user can add
  // a message next to it, then send — same path as a pasted card.
  async function pickCard(pick: CardPicker) {
    try {
      const envelope = await pick()
      if (envelope) onPasteCard?.(envelope)
    } catch (e) {
      console.error('pickCard', e)
    }
  }

  function pickStickerSource(files: FileList | null) {
    const file = files?.[0]
    if (stickerInputRef.current) stickerInputRef.current.value = ''
    if (file) setStickerSource(file)
  }

  // ── Text formatting ──────────────────────────────────────────────────────────
  // Wraps the selection in the markers understood by renderRich (richText.tsx);
  // wrapping an already-wrapped selection unwraps it, so the buttons toggle.
  function applyFormat(marker: string) {
    const ta = textareaRef.current
    if (!ta) return
    pushHistory(true)
    const start = ta.selectionStart ?? 0
    const end   = ta.selectionEnd ?? 0
    const selected = text.slice(start, end)

    const wrapped = selected.startsWith(marker) && selected.endsWith(marker) && selected.length >= marker.length * 2
    const outside = text.slice(start - marker.length, start) === marker && text.slice(end, end + marker.length) === marker

    let next: string
    let caretFrom: number
    let caretTo: number
    if (wrapped) {
      const inner = selected.slice(marker.length, selected.length - marker.length)
      next = text.slice(0, start) + inner + text.slice(end)
      caretFrom = start
      caretTo = start + inner.length
    } else if (outside) {
      next = text.slice(0, start - marker.length) + selected + text.slice(end + marker.length)
      caretFrom = start - marker.length
      caretTo = caretFrom + selected.length
    } else {
      next = text.slice(0, start) + marker + selected + marker + text.slice(end)
      caretFrom = start + marker.length
      caretTo = caretFrom + selected.length
    }

    handleChange(next)
    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(caretFrom, caretTo)
    })
  }

  // Named link: [label](url) — the URL placeholder is selected so it can be
  // overwritten (or pasted over) right away.
  function insertLink() {
    pushHistory(true)
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart ?? 0
    const end   = ta.selectionEnd ?? 0
    const label = text.slice(start, end) || t('chat_format_link_label', { defaultValue: 'texte' })
    const url   = 'https://'
    const next  = `${text.slice(0, start)}[${label}](${url})${text.slice(end)}`
    handleChange(next)
    requestAnimationFrame(() => {
      ta.focus()
      const urlStart = start + label.length + 3
      ta.setSelectionRange(urlStart, urlStart + url.length)
    })
  }

  const FORMATS: { key: string; marker?: string; icon: typeof Bold; label: string; shortcut?: string }[] = [
    { key: 'bold',   marker: '**', icon: Bold,          label: t('chat_format_bold',   { defaultValue: 'Gras' }),    shortcut: 'Ctrl+B' },
    { key: 'italic', marker: '*',  icon: Italic,        label: t('chat_format_italic', { defaultValue: 'Italique' }), shortcut: 'Ctrl+I' },
    { key: 'strike', marker: '~~', icon: Strikethrough, label: t('chat_format_strike', { defaultValue: 'Barré' }) },
    { key: 'code',   marker: '`',  icon: Code,          label: t('chat_format_code',   { defaultValue: 'Code' }) },
    { key: 'link',                 icon: Link,          label: t('chat_format_link',   { defaultValue: 'Lien' }) },
  ]

  // ── Expression panel (emoji / GIF / sticker) ─────────────────────────────────
  function insertEmoji(emoji: string) {
    pushHistory(true)
    const ta = textareaRef.current
    if (!ta) { handleChange(text + emoji); return }
    // Insert at the caret rather than appending, so it works mid-sentence.
    const start = ta.selectionStart ?? text.length
    const end   = ta.selectionEnd ?? text.length
    const next  = text.slice(0, start) + emoji + text.slice(end)
    handleChange(next)
    requestAnimationFrame(() => {
      ta.focus()
      const caret = start + emoji.length
      ta.setSelectionRange(caret, caret)
    })
  }

  async function pickGif(gif: GifResult) {
    if (!onSendGif) return
    setShowExpressions(false)
    setSending(true)
    try { await onSendGif(gif) } finally { setSending(false) }
  }

  async function pickSticker(sticker: Sticker) {
    if (!onSendSticker) return
    setShowExpressions(false)
    setSending(true)
    try { await onSendSticker(sticker) } finally { setSending(false) }
  }

  // ── Voice recording ──────────────────────────────────────────────────────────
  async function startRecording() {
    if (!onSendVoice || recording || disabled) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : ''
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunksRef.current = []
      canceledRef.current = false
      rec.ondataavailable = e => { if (e.data.size) chunksRef.current.push(e.data) }
      rec.onstop = async () => {
        streamRef.current?.getTracks().forEach(tr => tr.stop())
        if (elapsedTimer.current) clearInterval(elapsedTimer.current)
        const dur = (Date.now() - startRef.current) / 1000
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
        setRecording(false)
        setElapsed(0)
        if (canceledRef.current || dur < 0.4 || !blob.size) return
        const waveform = await computeWaveform(blob)
        await onSendVoice!(blob, dur, waveform)
      }
      recorderRef.current = rec
      startRef.current = Date.now()
      rec.start()
      setRecording(true)
      setElapsed(0)
      elapsedTimer.current = window.setInterval(() => setElapsed((Date.now() - startRef.current) / 1000), 200)
    } catch {
      // Micro refusé / indisponible — on ignore silencieusement.
      streamRef.current?.getTracks().forEach(tr => tr.stop())
    }
  }

  function stopRecording(cancel: boolean) {
    canceledRef.current = cancel
    recorderRef.current?.stop()
  }

  const fmt = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`

  return (
    <div className="relative">
      {/* Autocomplétion des mentions @ */}
      {mentionHits.length > 0 && (
        <div className="absolute bottom-full left-3 mb-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 w-56 z-30 max-h-52 overflow-y-auto">
          {mentionHits.map(m => (
            <button key={m.userId} onClick={() => pickMention(m.username)}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 text-left">
              <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 text-xs font-semibold flex-shrink-0">
                {m.name[0]?.toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="text-sm text-gray-900 truncate">{m.name}</div>
                <div className="text-[11px] text-gray-400 truncate">@{m.username}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Pending cross-module card (pasted JSON envelope) */}
      {pendingCard && (
        <div className="flex items-center justify-between px-4 py-2 bg-indigo-50 border-b border-indigo-100">
          <div className="flex items-center gap-2 text-xs text-indigo-700 truncate">
            <Package className="w-4 h-4 flex-shrink-0" />
            <span className="font-medium truncate">{pendingCard.title ?? pendingCard.type}</span>
            <span className="text-indigo-400 flex-shrink-0">· {pendingCard.module}</span>
          </div>
          <button onClick={onCancelCard} className="ml-2 text-indigo-400 hover:text-indigo-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Aperçu de la réponse */}
      {replyTo && (
        <div className="flex items-center justify-between px-4 py-2 bg-blue-50 border-b border-blue-100">
          <div className="text-xs text-blue-700 truncate">
            <span className="font-medium">{t('chat_reply_prefix')} </span>
            {replyTo.plaintext ?? t('chat_message_encrypted')}
          </div>
          <button onClick={onCancelReply} className="ml-2 text-blue-400 hover:text-blue-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={accept || undefined}
        className="hidden"
        onChange={e => handleFiles(e.target.files)}
      />
      {/* Source image for a new sticker (never sent as-is). */}
      <input
        ref={stickerInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => pickStickerSource(e.target.files)}
      />

      {recording ? (
        // ── Barre d'enregistrement vocal ─────────────────────────────────────────
        <div className="mx-3 my-2 flex items-center gap-3 px-3 py-1.5 bg-white border border-gray-200"
          style={{ borderRadius: 24, boxShadow: '0 1px 2px rgba(0,0,0,0.06)' }}>
          <button onClick={() => stopRecording(true)} className="p-2 text-red-500 hover:bg-red-50 rounded-full" title={t('common_cancel')}>
            <Trash2 className="w-5 h-5" />
          </button>
          <div className="flex-1 flex items-center gap-2 text-sm text-gray-600">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
            <span className="font-mono">{fmt(elapsed)}</span>
            <span className="text-gray-400">{t('chat_recording', { defaultValue: 'Enregistrement…' })}</span>
          </div>
          <button
            onClick={() => stopRecording(false)}
            className="p-2 bg-blue-600 text-white rounded-full hover:bg-blue-700"
            title={t('chat_send')}
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="relative px-3 py-2">
          {/* Formatting bar — floats above the pill while text is selected. */}
          {hasSelection && (
            <div className="absolute bottom-full left-4 mb-1 flex items-center gap-0.5 bg-white border border-gray-200 rounded-lg shadow-lg px-1 py-0.5 z-30">
              {FORMATS.map(f => (
                <button
                  key={f.key}
                  onMouseDown={e => e.preventDefault()}  // keep the textarea selection
                  onClick={() => (f.marker ? applyFormat(f.marker) : insertLink())}
                  disabled={disabled || sending}
                  className="p-1.5 text-gray-500 hover:text-gray-800 rounded hover:bg-gray-100 disabled:opacity-40"
                  title={f.shortcut ? `${f.label} (${f.shortcut})` : f.label}
                >
                  <f.icon className="w-4 h-4" />
                </button>
              ))}
            </div>
          )}

          {/* Pasted images waiting to leave with the message. */}
          {pendingImages.length > 0 && (
            <div
              className="flex items-center gap-2 flex-wrap bg-white border border-gray-200 px-2.5 py-2 mb-2"
              style={{ borderRadius: 16, boxShadow: '0 1px 2px rgba(0,0,0,0.06)' }}
            >
              {pendingImages.map(p => (
                <div key={p.url} className="relative group/img">
                  <img src={p.url} alt="" className="w-16 h-16 rounded-lg object-cover border border-gray-100" />
                  <button
                    onClick={() => removePendingImage(p.url)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-gray-800/80 text-white flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity"
                    title={t('common_delete')}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              <span className="text-xs text-gray-400 ml-1">
                {t('chat_pasted_images', { count: pendingImages.length, defaultValue: '{{count}} image(s) à envoyer' })}
              </span>
            </div>
          )}

          {/* Single WhatsApp-like pill: everything lives inside one rounded field. */}
          <div
            className="flex items-end gap-1 bg-white border border-gray-200 px-1.5 py-1"
            style={{ borderRadius: 24, boxShadow: '0 1px 2px rgba(0,0,0,0.06)' }}
          >
            <button
              onClick={e => attachMenu.open(e)}
              disabled={disabled || sending || attachItems().length === 0}
              className="p-2 text-gray-600 hover:text-gray-900 rounded-full hover:bg-gray-100 disabled:opacity-40 flex-shrink-0"
              title={t('chat_attach_file')}
              aria-haspopup="menu"
            >
              {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
            </button>

            <button
              onClick={() => setShowExpressions(v => !v)}
              disabled={disabled}
              className={`p-2 rounded-full hover:bg-gray-100 disabled:opacity-40 flex-shrink-0 ${showExpressions ? 'text-blue-600' : 'text-gray-600 hover:text-gray-900'}`}
              title={t('chat_expressions', { defaultValue: 'Emojis, GIF et stickers' })}
              aria-expanded={showExpressions}
            >
              <Smile className="w-5 h-5" />
            </button>

            <textarea
              ref={textareaRef}
              value={text}
              onChange={e => handleChange(e.target.value)}
              onKeyDown={handleKey}
              onPaste={handlePaste}
              onSelect={e => {
                const ta = e.target as HTMLTextAreaElement
                setHasSelection(ta.selectionStart !== ta.selectionEnd)
              }}
              onBlur={() => setHasSelection(false)}
              placeholder={t('chat_message_placeholder')}
              rows={1}
              disabled={disabled || sending}
              style={{ minHeight: COMPOSER_MIN_H, maxHeight: COMPOSER_MAX_H }}
              className="flex-1 resize-none bg-transparent border-0 px-2 py-2 text-sm focus:outline-none placeholder-gray-400 overflow-y-auto"
            />

            {/* Active ephemeral timer — visible state, click cycles/disables. */}
            {onCycleEphemeral && ephemeralSecs > 0 && (
              <button
                onClick={onCycleEphemeral}
                className="p-2 text-blue-600 rounded-full hover:bg-blue-50 flex-shrink-0 relative"
                title={t('chat_ephemeral', { defaultValue: 'Message éphémère' })}
              >
                <Timer className="w-5 h-5" />
                <span className="absolute -top-0.5 -right-0.5 text-[8px] bg-blue-600 text-white rounded-full px-1 leading-tight">
                  {ephemeralSecs >= 86400 ? `${Math.round(ephemeralSecs / 86400)}j` : `${Math.round(ephemeralSecs / 3600)}h`}
                </span>
              </button>
            )}

            {text.trim() || pendingCard || pendingImages.length > 0 ? (
              <span className="flex items-center gap-px flex-shrink-0 pb-0.5">
                {pendingImages.length === 0 && (
                <button
                  onClick={e => scheduleMenu.open(e)}
                  disabled={sending || disabled}
                  className="py-1.5 px-1 bg-blue-100 text-blue-600 rounded-l-full hover:bg-blue-200 disabled:opacity-40 transition-colors"
                  title={t('chat_schedule_send', { defaultValue: "Programmer l'envoi" })}
                  aria-haspopup="menu"
                >
                  <ChevronUp className="w-4 h-4" />
                </button>
                )}
                <button
                  onClick={() => handleSend()}
                  disabled={sending || disabled}
                  className={`py-1.5 pl-2 pr-2.5 bg-blue-600 text-white rounded-r-full hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${pendingImages.length > 0 ? 'rounded-l-full' : ''}`}
                  title={t('chat_send')}
                >
                  <Send className="w-4 h-4" />
                </button>
              </span>
            ) : (
              <button
                onClick={startRecording}
                disabled={disabled || !onSendVoice}
                className="p-2 text-gray-600 hover:text-blue-600 rounded-full hover:bg-gray-100 disabled:opacity-40 transition-colors flex-shrink-0"
                title={t('chat_record_voice', { defaultValue: 'Message vocal' })}
              >
                <Mic className="w-5 h-5" />
              </button>
            )}
          </div>

          {showExpressions && (
            <Suspense fallback={null}>
              <ExpressionPanel
                onPickEmoji={insertEmoji}
                onPickGif={pickGif}
                onPickSticker={pickSticker}
                onCreateSticker={() => stickerInputRef.current?.click()}
                stickerVersion={stickerVersion}
                onClose={() => setShowExpressions(false)}
              />
            </Suspense>
          )}
        </div>
      )}

      {attachMenu.pos && <MenuDropdown items={attachItems()} pos={attachMenu.pos} onClose={attachMenu.close} />}
      {scheduleMenu.pos && <MenuDropdown items={schedulePresets()} pos={scheduleMenu.pos} onClose={scheduleMenu.close} />}

      {/* Custom date & time for a scheduled send */}
      {pickTimeOpen && (
        <div className="fixed inset-0 z-[2147483100] bg-black/40 flex items-center justify-center p-4" onClick={() => setPickTimeOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-[320px] max-w-full p-4 flex flex-col gap-3" onClick={e => e.stopPropagation()}>
            <h2 className="text-sm font-semibold text-gray-900">{t('chat_schedule_send', { defaultValue: "Programmer l'envoi" })}</h2>
            <input
              type="datetime-local"
              value={pickedTime}
              min={new Date(Date.now() + 5 * 60_000).toISOString().slice(0, 16)}
              onChange={e => setPickedTime(e.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setPickTimeOpen(false)} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
                {t('common_cancel')}
              </button>
              <button
                onClick={() => {
                  const when = new Date(pickedTime)
                  if (Number.isNaN(when.getTime()) || when.getTime() < Date.now()) return
                  setPickTimeOpen(false)
                  handleSend(when.toISOString())
                }}
                disabled={!pickedTime}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40"
              >
                {t('chat_schedule_confirm', { defaultValue: 'Programmer' })}
              </button>
            </div>
          </div>
        </div>
      )}

      {cameraOpen && (
        <Suspense fallback={null}>
          <CameraCapture
            onCapture={file => onSendFiles?.([file])}
            onClose={() => setCameraOpen(false)}
          />
        </Suspense>
      )}

      {stickerSource && (
        <Suspense fallback={null}>
          <StickerStudio
            file={stickerSource}
            onDone={async (sticker, send) => {
              setStickerSource(null)
              setStickerVersion(v => v + 1)
              if (send) await pickSticker(sticker)
            }}
            onClose={() => setStickerSource(null)}
          />
        </Suspense>
      )}
    </div>
  )
}

/** lucide v1 ships no sticker glyph — same peeled-corner square as the panel. */
function StickerGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500">
      <path d="M15.5 3H7a4 4 0 0 0-4 4v10a4 4 0 0 0 4 4h6l8-8V7a4 4 0 0 0-4-4Z" />
      <path d="M13 21v-4a4 4 0 0 1 4-4h4" />
    </svg>
  )
}
