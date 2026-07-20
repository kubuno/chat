/**
 * Turns any picture into a sticker: square PNG, transparent background,
 * optionally with the (near-)white background knocked out.
 *
 * The result is stored in the device-local pack (stickers.ts) and can be sent
 * straight away. Nothing about the pack reaches the server — a sent sticker is
 * encrypted per-message like any other media.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Loader2 } from 'lucide-react'
import { Button, Toggle } from '@ui'
import { addSticker, STICKER_SIZE, type Sticker } from './stickers'

interface Props {
  file:    File
  onDone:  (sticker: Sticker, send: boolean) => void
  onClose: () => void
}

type Fit = 'contain' | 'cover'

/** Knock out near-white, low-saturation pixels (typical scanned/flat backgrounds). */
function removeWhiteBackground(data: ImageData): void {
  const px = data.data
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2]
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    if (min > 232 && max - min < 18) {
      px[i + 3] = 0
    } else if (min > 214 && max - min < 26) {
      // Soften the edge so cut-outs don't look jagged.
      px[i + 3] = Math.round(px[i + 3] * 0.35)
    }
  }
}

export default function StickerStudio({ file, onDone, onClose }: Props) {
  const { t } = useTranslation('chat')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bitmapRef = useRef<ImageBitmap | null>(null)
  const [fit, setFit] = useState<Fit>('contain')
  const [cutout, setCutout] = useState(false)
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const bitmap = bitmapRef.current
    if (!canvas || !bitmap) return
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return

    const size = STICKER_SIZE
    canvas.width = size
    canvas.height = size
    ctx.clearRect(0, 0, size, size)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    const scale = fit === 'contain'
      ? Math.min(size / bitmap.width, size / bitmap.height)
      : Math.max(size / bitmap.width, size / bitmap.height)
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)
    ctx.drawImage(bitmap, Math.round((size - w) / 2), Math.round((size - h) / 2), w, h)

    if (cutout) {
      const data = ctx.getImageData(0, 0, size, size)
      removeWhiteBackground(data)
      ctx.putImageData(data, 0, 0)
    }
  }, [fit, cutout])

  useEffect(() => {
    let alive = true
    createImageBitmap(file)
      .then(bitmap => {
        if (!alive) { bitmap.close(); return }
        bitmapRef.current = bitmap
        setReady(true)
      })
      .catch(() => { if (alive) onClose() })
    return () => {
      alive = false
      bitmapRef.current?.close()
      bitmapRef.current = null
    }
  }, [file, onClose])

  useEffect(() => { if (ready) draw() }, [ready, draw])

  async function save(send: boolean) {
    const canvas = canvasRef.current
    if (!canvas || saving) return
    setSaving(true)
    try {
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
      if (!blob) return
      const sticker = await addSticker(blob, STICKER_SIZE, STICKER_SIZE)
      onDone(sticker, send)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[2147483100] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-[380px] max-w-full overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">{t('chat_sticker_new', { defaultValue: 'Nouveau sticker' })}</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded" title={t('common_cancel')}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-4">
          {/* Checkerboard so transparency is visible. */}
          <div
            className="mx-auto rounded-xl border border-gray-200 overflow-hidden"
            style={{
              width: 240,
              height: 240,
              backgroundImage:
                'linear-gradient(45deg, #f3f4f6 25%, transparent 25%, transparent 75%, #f3f4f6 75%),' +
                'linear-gradient(45deg, #f3f4f6 25%, transparent 25%, transparent 75%, #f3f4f6 75%)',
              backgroundSize: '16px 16px',
              backgroundPosition: '0 0, 8px 8px',
            }}
          >
            {ready
              ? <canvas ref={canvasRef} className="w-full h-full" />
              : <div className="w-full h-full flex items-center justify-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>}
          </div>

          <div className="flex items-center justify-center gap-1 bg-gray-100 rounded-full p-0.5 self-center">
            {(['contain', 'cover'] as Fit[]).map(f => (
              <button
                key={f}
                onClick={() => setFit(f)}
                className={`px-4 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  fit === f ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {f === 'contain'
                  ? t('chat_sticker_fit', { defaultValue: 'Ajuster' })
                  : t('chat_sticker_fill', { defaultValue: 'Remplir' })}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3 text-sm text-gray-700">
            <Toggle
              label={t('chat_sticker_cutout', { defaultValue: 'Supprimer le fond blanc' })}
              checked={cutout}
              onChange={e => setCutout(e.target.checked)}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-100 bg-gray-50">
          <Button variant="ghost" onClick={onClose} disabled={saving}>{t('common_cancel')}</Button>
          <Button variant="secondary" onClick={() => save(false)} disabled={!ready || saving}>
            {t('chat_sticker_add', { defaultValue: 'Ajouter au pack' })}
          </Button>
          <Button onClick={() => save(true)} disabled={!ready || saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t('chat_send')}
          </Button>
        </div>
      </div>
    </div>
  )
}
