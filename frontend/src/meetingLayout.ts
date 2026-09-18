// Placement of the objects of a meeting: participant tiles and the shared
// screen. Kept apart from the meeting window so it can be exercised on its
// own, and because it is pure geometry — no React, no DOM.

export interface Slot { x: number; y: number; size: number }
export interface StageLayout {
  tiles: Slot[]
  /** Where the presentation goes, when there is one. */
  stage: { x: number; y: number; w: number; h: number } | null
}

/**
 * Places every object of the meeting itself, rather than letting the browser
 * reflow them. Each tile gets a position and a size, so a change of layout is
 * a change of coordinates that the browser can interpolate smoothly — measuring
 * elements that are already moving is what made them shake.
 *
 * Without a presentation the tiles form the largest grid of equal squares that
 * fits; with one they line up in a strip above it. Tiles are always identical
 * to one another.
 */
export function meetingLayout(box: { w: number; h: number } | null, count: number, presenting: boolean, gap = 12): StageLayout {
  const empty: StageLayout = { tiles: [], stage: null }
  if (!box || box.w <= 0 || box.h <= 0 || count <= 0) return empty

  if (presenting) {
    // The strip keeps a readable tile and wraps onto another row when the width
    // runs out, rather than squeezing everyone into a single line. It is only
    // made smaller when even the wrapped rows would eat the presentation.
    const wanted = Math.max(110, Math.min(200, box.h * 0.22))
    const maxStripH = box.h * 0.5
    let size = 60, perRow = 1, rows = count
    for (let s = Math.round(wanted); s >= 60; s -= 2) {
      const fit = Math.max(1, Math.floor((box.w + gap) / (s + gap)))
      const r = Math.ceil(count / fit)
      if (r * s + (r - 1) * gap <= maxStripH) { size = s; perRow = fit; rows = r; break }
      if (s <= 62) { size = s; perRow = fit; rows = r }
    }
    const tiles: Slot[] = []
    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / perRow)
      const inRow = Math.min(perRow, count - row * perRow)
      const left = Math.round((box.w - (inRow * size + (inRow - 1) * gap)) / 2)
      tiles.push({ x: Math.max(0, left) + (i % perRow) * (size + gap), y: row * (size + gap), size })
    }
    const top = rows * size + (rows - 1) * gap + gap
    return { tiles, stage: { x: 0, y: top, w: box.w, h: Math.max(0, box.h - top) } }
  }

  let size = 0, cols = 1
  for (let c = 1; c <= count; c++) {
    const r = Math.ceil(count / c)
    const s = Math.min((box.w - gap * (c - 1)) / c, (box.h - gap * (r - 1)) / r)
    if (s > size) { size = s; cols = c }
  }
  size = Math.max(0, Math.floor(size))
  const rows = Math.ceil(count / cols)
  const top = Math.round((box.h - (rows * size + (rows - 1) * gap)) / 2)
  const tiles: Slot[] = []
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols)
    const inRow = Math.min(cols, count - row * cols)
    const left = Math.round((box.w - (inRow * size + (inRow - 1) * gap)) / 2)
    tiles.push({ x: left + (i % cols) * (size + gap), y: top + row * (size + gap), size })
  }
  return { tiles, stage: null }
}

