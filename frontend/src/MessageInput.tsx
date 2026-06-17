import { useState, useRef, useCallback, useEffect, KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Send, Paperclip, X, Mic, Trash2, Loader2, BarChart3, Timer } from 'lucide-react'
import { DecodedMessage } from './api'

interface Props {
  onSend:    (text: string) => Promise<void>
  onSendFiles?: (files: File[]) => Promise<void>
  onSendVoice?: (blob: Blob, durationSec: number, waveform: number[]) => Promise<void>
  onCreatePoll?: () => void
  ephemeralSecs?: number
  onCycleEphemeral?: () => void
  members?: { userId: string; name: string; username: string }[]
  onTyping?: (isTyping: boolean) => void
  replyTo?:  DecodedMessage | null
  onCancelReply?: () => void
  disabled?: boolean
}

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

export default function MessageInput({ onSend, onSendFiles, onSendVoice, onCreatePoll, ephemeralSecs = 0, onCycleEphemeral, members = [], onTyping, replyTo, onCancelReply, disabled }: Props) {
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
    setText(t2 => t2.replace(/@\w*$/, `@${username} `))
    textareaRef.current?.focus()
  }
  const typingTimer = useRef<number | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
    setText(val)
    if (onTyping) {
      onTyping(true)
      if (typingTimer.current) clearTimeout(typingTimer.current)
      typingTimer.current = window.setTimeout(() => onTyping(false), 3000)
    }
    const ta = textareaRef.current
    if (ta) {
      ta.style.height = 'auto'
      ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'
    }
  }, [onTyping])

  const handleSend = useCallback(async () => {
    const trimmed = text.trim()
    if (!trimmed || sending || disabled) return
    setSending(true)
    try {
      await onSend(trimmed)
      setText('')
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
      onTyping?.(false)
    } finally {
      setSending(false)
    }
  }, [text, sending, disabled, onSend, onTyping])

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
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
    <div className="border-t border-gray-200 bg-white relative">
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
        className="hidden"
        onChange={e => handleFiles(e.target.files)}
      />

      {recording ? (
        // ── Barre d'enregistrement vocal ─────────────────────────────────────────
        <div className="flex items-center gap-3 px-4 py-3">
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
        <div className="flex items-end gap-2 px-3 py-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || sending || !onSendFiles}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100 disabled:opacity-40"
            title={t('chat_attach_file')}
          >
            {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Paperclip className="w-5 h-5" />}
          </button>

          {onCreatePoll && (
            <button onClick={onCreatePoll} disabled={disabled} className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100 disabled:opacity-40" title={t('chat_poll', { defaultValue: 'Sondage' })}>
              <BarChart3 className="w-5 h-5" />
            </button>
          )}

          {onCycleEphemeral && (
            <button onClick={onCycleEphemeral} disabled={disabled}
              className={`p-2 rounded-full hover:bg-gray-100 disabled:opacity-40 relative ${ephemeralSecs ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
              title={t('chat_ephemeral', { defaultValue: 'Message éphémère' })}>
              <Timer className="w-5 h-5" />
              {ephemeralSecs > 0 && (
                <span className="absolute -top-0.5 -right-0.5 text-[8px] bg-blue-600 text-white rounded-full px-1 leading-tight">
                  {ephemeralSecs >= 86400 ? `${Math.round(ephemeralSecs / 86400)}j` : `${Math.round(ephemeralSecs / 3600)}h`}
                </span>
              )}
            </button>
          )}

          <textarea
            ref={textareaRef}
            value={text}
            onChange={e => handleChange(e.target.value)}
            onKeyDown={handleKey}
            placeholder={t('chat_message_placeholder')}
            rows={1}
            disabled={disabled || sending}
            className="flex-1 resize-none rounded-2xl border border-gray-200 px-4 py-2 text-sm focus:outline-none focus:border-blue-400 placeholder-gray-400 max-h-[120px] overflow-y-auto"
          />

          {text.trim() ? (
            <button
              onClick={handleSend}
              disabled={sending || disabled}
              className="p-2 bg-blue-600 text-white rounded-full hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
              title={t('chat_send')}
            >
              <Send className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={startRecording}
              disabled={disabled || !onSendVoice}
              className="p-2 text-gray-500 hover:text-blue-600 rounded-full hover:bg-gray-100 disabled:opacity-40 transition-colors flex-shrink-0"
              title={t('chat_record_voice', { defaultValue: 'Message vocal' })}
            >
              <Mic className="w-5 h-5" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
