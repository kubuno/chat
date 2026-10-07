// Who is speaking, right now.
//
// The meeting is peer to peer, so nothing tells us who has the floor: it is
// heard, by measuring the loudness of each participant's own audio track. A
// short tail keeps the mark on someone through the pauses between words, so a
// tile does not flicker on every syllable.

/** Loudness, as a fraction of full scale, above which a voice counts. */
const THRESHOLD = 0.045
/** How long someone keeps the floor after falling quiet. */
const TAIL_MS = 700
/** How often the levels are read. */
const PERIOD_MS = 150

interface Watched {
  stream:   MediaStream
  source:   MediaStreamAudioSourceNode
  analyser: AnalyserNode
  data:     Uint8Array<ArrayBuffer>
  lastLoud: number
}

export interface SpeakingWatch {
  /** The people to listen to, refreshed as they come and go. */
  update(entries: { id: string; stream: MediaStream | null }[]): void
  /**
   * Loudness of each person, from 0 to 1, updated in place. Read it straight
   * from an animation frame: a moving level must not re-render the meeting
   * several times a second.
   */
  levels: Map<string, number>
  close(): void
}

/**
 * Watches who is speaking and reports the set whenever it changes — never on
 * every reading, so the meeting is not re-rendered a dozen times a second.
 */
export function watchSpeaking(onChange: (ids: Set<string>) => void): SpeakingWatch {
  let audio: AudioContext | null = null
  const watched = new Map<string, Watched>()
  const levels = new Map<string, number>()
  let current = new Set<string>()

  const drop = (id: string) => {
    const w = watched.get(id)
    if (!w) return
    try { w.source.disconnect() } catch { /* already gone */ }
    watched.delete(id)
    levels.delete(id)
  }

  const update = (entries: { id: string; stream: MediaStream | null }[]) => {
    const alive = new Set<string>()
    for (const { id, stream } of entries) {
      if (!stream || stream.getAudioTracks().length === 0) continue
      alive.add(id)
      const existing = watched.get(id)
      if (existing && existing.stream.id === stream.id) continue
      if (existing) drop(id)
      try {
        audio ??= new AudioContext()
        const source = audio.createMediaStreamSource(stream)
        const analyser = audio.createAnalyser()
        analyser.fftSize = 512
        source.connect(analyser)
        // The analyser is a dead end: nothing is connected to the output, so
        // listening to the levels never plays the sound a second time.
        watched.set(id, { stream, source, analyser, data: new Uint8Array(new ArrayBuffer(analyser.fftSize)), lastLoud: 0 })
      } catch { /* a stream without a usable audio track is simply skipped */ }
    }
    for (const id of Array.from(watched.keys())) if (!alive.has(id)) drop(id)
  }

  const tick = () => {
    const now = Date.now()
    const speaking = new Set<string>()
    for (const [id, w] of watched) {
      w.analyser.getByteTimeDomainData(w.data)
      let sum = 0
      for (let i = 0; i < w.data.length; i++) {
        const v = (w.data[i] - 128) / 128
        sum += v * v
      }
      const rms = Math.sqrt(sum / w.data.length)
      // Scaled so ordinary speech fills the gauge, then smoothed: it rises with
      // the voice and falls back gently, the way a level meter behaves.
      const target = Math.min(1, rms / 0.25)
      const previous = levels.get(id) ?? 0
      levels.set(id, target > previous ? target : previous + (target - previous) * 0.35)
      if (rms > THRESHOLD) w.lastLoud = now
      if (now - w.lastLoud < TAIL_MS) speaking.add(id)
    }
    if (speaking.size !== current.size || [...speaking].some(id => !current.has(id))) {
      current = speaking
      onChange(speaking)
    }
  }

  const timer = window.setInterval(tick, PERIOD_MS)

  return {
    update,
    levels,
    close() {
      window.clearInterval(timer)
      for (const id of Array.from(watched.keys())) drop(id)
      audio?.close().catch(() => { /* already closed */ })
      audio = null
    },
  }
}
