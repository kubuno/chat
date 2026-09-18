// Recording of a meeting, done in the browser of the person who starts it.
//
// The meeting is a peer-to-peer mesh: no server ever sees the media, so there
// is no server-side mixer to record from. The recorder therefore paints what
// the meeting shows onto a canvas — the presentation when someone is sharing,
// the participants otherwise — mixes every audio track into one stream, and
// hands the pair to `MediaRecorder`. The result is a single video file.
//
// It deliberately records the meeting, not the window: side panels, menus and
// notices never appear in the file.

/** What the recorder should paint and mix, read afresh on every frame. */
export interface RecorderSources {
  /** The screen being shared, when there is one. */
  screen: () => MediaStream | null
  /** The participants, in the order the meeting shows them. */
  tiles: () => { name: string; stream: MediaStream | null; camOff: boolean }[]
  /** Every stream whose sound belongs in the recording. */
  audio: () => MediaStream[]
}

export interface MeetingRecording {
  /** Milliseconds since the recording started. */
  elapsed: () => number
  /** Ends the recording and gives back the finished file. */
  stop: () => Promise<{ blob: Blob; mime: string; durationMs: number }>
}

const WIDTH = 1280
const HEIGHT = 720
const FPS = 24
/**
 * A recording never runs unattended for longer than this. The whole file is
 * held in memory until it is saved, so the ceiling is a practical one.
 */
const MAX_MS = 2 * 60 * 60 * 1000

/** True when this browser can record at all. */
export function canRecordMeeting(): boolean {
  return typeof MediaRecorder !== 'undefined'
    && typeof HTMLCanvasElement.prototype.captureStream === 'function'
}

/** The best container this browser can write, or null when it can write none. */
function pickMime(): string | null {
  const wanted = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ]
  return wanted.find(m => MediaRecorder.isTypeSupported(m)) ?? null
}

/** Draws `video` inside the box, filling it without distortion or cropping. */
function drawContain(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, x: number, y: number, w: number, h: number) {
  const vw = video.videoWidth, vh = video.videoHeight
  if (!vw || !vh) return
  const scale = Math.min(w / vw, h / vh)
  const dw = vw * scale, dh = vh * scale
  ctx.drawImage(video, Math.round(x + (w - dw) / 2), Math.round(y + (h - dh) / 2), Math.round(dw), Math.round(dh))
}

/** Draws `video` filling the box, cropping what does not fit — as a tile does. */
function drawCover(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, x: number, y: number, w: number, h: number) {
  const vw = video.videoWidth, vh = video.videoHeight
  if (!vw || !vh) return
  const scale = Math.max(w / vw, h / vh)
  const dw = vw * scale, dh = vh * scale
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  ctx.drawImage(video, Math.round(x + (w - dw) / 2), Math.round(y + (h - dh) / 2), Math.round(dw), Math.round(dh))
  ctx.restore()
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/**
 * Starts recording. The returned handle stops it and yields the file.
 * Throws when the browser cannot record, so the caller can say so plainly.
 */
export function startMeetingRecording(sources: RecorderSources, onAutoStop?: () => void): MeetingRecording {
  const mime = canRecordMeeting() ? pickMime() : null
  if (!mime) throw new Error('recording-unsupported')

  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('recording-unsupported')

  // One hidden <video> per stream, kept across frames: a canvas can only draw
  // a live stream through a media element.
  const players = new Map<string, HTMLVideoElement>()
  const playerFor = (stream: MediaStream): HTMLVideoElement => {
    const existing = players.get(stream.id)
    if (existing) return existing
    const el = document.createElement('video')
    el.srcObject = stream
    el.muted = true
    el.autoplay = true
    el.playsInline = true
    el.play().catch(() => { /* a stream with no live track simply stays blank */ })
    players.set(stream.id, el)
    return el
  }

  function label(text: string, x: number, y: number, w: number, size: number) {
    if (!ctx || !text) return
    ctx.save()
    ctx.font = `${size}px system-ui, sans-serif`
    ctx.textBaseline = 'bottom'
    const grad = ctx.createLinearGradient(0, y - size * 2.2, 0, y)
    grad.addColorStop(0, 'rgba(0,0,0,0)')
    grad.addColorStop(1, 'rgba(0,0,0,0.55)')
    ctx.fillStyle = grad
    ctx.fillRect(x, y - size * 2.2, w, size * 2.2)
    ctx.fillStyle = '#fff'
    let shown = text
    while (ctx.measureText(shown).width > w - size && shown.length > 1) shown = shown.slice(0, -1)
    ctx.fillText(shown, x + size * 0.6, y - size * 0.5)
    ctx.restore()
  }

  function avatar(text: string, x: number, y: number, w: number, h: number) {
    if (!ctx) return
    const d = Math.min(w, h) * 0.42
    ctx.save()
    ctx.fillStyle = '#5b6470'
    ctx.beginPath()
    ctx.arc(x + w / 2, y + h / 2, d / 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.font = `${Math.round(d * 0.42)}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText((text[0] ?? '?').toUpperCase(), x + w / 2, y + h / 2)
    ctx.restore()
  }

  function drawFrame() {
    if (!ctx) return
    ctx.fillStyle = '#202124'
    ctx.fillRect(0, 0, WIDTH, HEIGHT)

    const screen = sources.screen()
    const tiles = sources.tiles()
    const pad = 12

    if (screen) {
      // The presentation fills the frame; the people ride along the bottom.
      const stripH = tiles.length ? 132 : 0
      drawContain(ctx, playerFor(screen), 0, 0, WIDTH, HEIGHT - stripH)
      const shown = tiles.slice(0, 6)
      const size = stripH - pad * 2
      const rowW = shown.length * size + (shown.length - 1) * pad
      let x = Math.round((WIDTH - rowW) / 2)
      const y = HEIGHT - stripH + pad
      for (const tile of shown) {
        ctx.save()
        roundedRect(ctx, x, y, size, size, 12)
        ctx.clip()
        ctx.fillStyle = '#3c4043'
        ctx.fillRect(x, y, size, size)
        if (tile.stream && !tile.camOff) drawCover(ctx, playerFor(tile.stream), x, y, size, size)
        else avatar(tile.name, x, y, size, size)
        label(tile.name, x, y + size, size, 13)
        ctx.restore()
        x += size + pad
      }
      return
    }

    // Nobody is presenting: the same grid of equal squares the meeting shows.
    const count = Math.max(1, Math.min(tiles.length, 9))
    let size = 0, cols = 1
    for (let c = 1; c <= count; c++) {
      const rows = Math.ceil(count / c)
      const s = Math.min((WIDTH - pad * (c - 1)) / c, (HEIGHT - pad * (rows - 1)) / rows)
      if (s > size) { size = s; cols = c }
    }
    size = Math.floor(size)
    const rows = Math.ceil(count / cols)
    const top = Math.round((HEIGHT - (rows * size + (rows - 1) * pad)) / 2)
    for (let i = 0; i < count; i++) {
      const tile = tiles[i]
      if (!tile) break
      const row = Math.floor(i / cols)
      const inRow = Math.min(cols, count - row * cols)
      const left = Math.round((WIDTH - (inRow * size + (inRow - 1) * pad)) / 2)
      const x = left + (i % cols) * (size + pad)
      const y = top + row * (size + pad)
      ctx.save()
      roundedRect(ctx, x, y, size, size, 16)
      ctx.clip()
      ctx.fillStyle = '#3c4043'
      ctx.fillRect(x, y, size, size)
      if (tile.stream && !tile.camOff) drawCover(ctx, playerFor(tile.stream), x, y, size, size)
      else avatar(tile.name, x, y, size, size)
      label(tile.name, x, y + size, size, 16)
      ctx.restore()
    }
  }

  const painter = window.setInterval(drawFrame, Math.round(1000 / FPS))
  drawFrame()

  // Every voice in one track. New arrivals are picked up as they connect.
  const audioCtx = new AudioContext()
  const mixer = audioCtx.createMediaStreamDestination()
  const mixed = new Set<string>()
  const collect = () => {
    for (const stream of sources.audio()) {
      if (mixed.has(stream.id) || stream.getAudioTracks().length === 0) continue
      try {
        audioCtx.createMediaStreamSource(stream).connect(mixer)
        mixed.add(stream.id)
      } catch { /* a stream without a usable audio track is simply skipped */ }
    }
  }
  collect()
  const collector = window.setInterval(collect, 2000)

  const canvasStream = canvas.captureStream(FPS)
  const combined = new MediaStream([...canvasStream.getVideoTracks(), ...mixer.stream.getAudioTracks()])
  const recorder = new MediaRecorder(combined, { mimeType: mime, videoBitsPerSecond: 1_500_000 })
  const chunks: Blob[] = []
  recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
  recorder.start(1000)

  const startedAt = Date.now()
  let stopped = false

  const cleanup = () => {
    window.clearInterval(painter)
    window.clearInterval(collector)
    canvasStream.getTracks().forEach(tr => tr.stop())
    players.forEach(el => { el.srcObject = null })
    players.clear()
    audioCtx.close().catch(() => { /* already closed */ })
  }

  const stop = (): Promise<{ blob: Blob; mime: string; durationMs: number }> => new Promise(resolve => {
    if (stopped) { resolve({ blob: new Blob(chunks, { type: mime }), mime, durationMs: Date.now() - startedAt }); return }
    stopped = true
    const durationMs = Date.now() - startedAt
    recorder.onstop = () => {
      cleanup()
      resolve({ blob: new Blob(chunks, { type: mime }), mime, durationMs })
    }
    try { recorder.stop() } catch { cleanup(); resolve({ blob: new Blob(chunks, { type: mime }), mime, durationMs }) }
  })

  // A recording left running is stopped on its own rather than filling memory.
  const guard = window.setTimeout(() => { if (!stopped) onAutoStop?.() }, MAX_MS)
  const wrapped: MeetingRecording = {
    elapsed: () => Date.now() - startedAt,
    stop: () => { window.clearTimeout(guard); return stop() },
  }
  return wrapped
}
