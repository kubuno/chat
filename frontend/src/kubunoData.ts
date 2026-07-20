/**
 * Cross-module data sharing over the clipboard (JSON envelopes) — consumer side.
 *
 * VENDORED from core `@kubuno/sdk` (`DataTransferRegistry`): replace the local
 * copy with `import { … } from '@kubuno/sdk'` once `@kubuno/sdk >= 0.1.3` is
 * published on npm. The runtime contract (envelope shape, `data-kubuno` HTML
 * marker, `core.data-card` extension point) is shared with the host and all
 * producer modules, so the two copies MUST stay in sync.
 *
 * A producer (maps, paintsharp…) copies `text/plain` (human summary) plus
 * `text/html` containing `<span data-kubuno="<base64 JSON>">`. Chat detects
 * the marker in its paste handler and renders the envelope as a rich card,
 * resolving the renderer the producer registered on `core.data-card` —
 * falling back to a generic JSON card when the producer is not installed.
 */
import { ExtensionRegistry } from '@kubuno/sdk'
import type React from 'react'

export interface KubunoDataEnvelope {
  kubuno: 1
  type: string
  module: string
  title?: string
  text?: string
  href?: string
  data: unknown
}

export const DATA_CARD_EXTENSION = 'core.data-card'

export interface DataCardProps { envelope: KubunoDataEnvelope }

export interface DataCardStaticRender {
  svg?: string
  dataUrl?: string
  width: number
  height: number
}

export interface DataCardRenderer {
  types: string[]
  Component?: React.ComponentType<DataCardProps>
  renderStatic?: (envelope: KubunoDataEnvelope) => Promise<DataCardStaticRender | null>
}

/** Renderer component registered by the producer module, or undefined. */
export function resolveDataCardRenderer(type: string): React.ComponentType<DataCardProps> | undefined {
  return ExtensionRegistry.getAll<DataCardRenderer>(DATA_CARD_EXTENSION)
    .find(r => Array.isArray(r.types) && r.types.includes(type))?.Component
}

function decodeBase64Utf8(b64: string): string {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

export function isKubunoDataEnvelope(value: unknown): value is KubunoDataEnvelope {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return v.kubuno === 1
    && typeof v.type === 'string' && v.type.includes('.')
    && typeof v.module === 'string' && v.module.length > 0
    && 'data' in v
}

/** Parses a raw string (pasted plain text) as an envelope, or null. */
export function parseKubunoData(raw: string): KubunoDataEnvelope | null {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return isKubunoDataEnvelope(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Extracts an envelope from a paste/drop `DataTransfer`, if any. */
export function readKubunoData(dt: DataTransfer | null): KubunoDataEnvelope | null {
  if (!dt) return null
  const html = dt.getData('text/html')
  const match = html ? /data-kubuno="([A-Za-z0-9+/=]+)"/.exec(html) : null
  if (match) {
    try {
      const parsed: unknown = JSON.parse(decodeBase64Utf8(match[1]))
      if (isKubunoDataEnvelope(parsed)) return parsed
    } catch { /* corrupt marker: fall through to plain text */ }
  }
  return parseKubunoData(dt.getData('text/plain') || '')
}
