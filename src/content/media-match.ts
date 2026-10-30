import type { IndexedAttachment } from '../wxr/site-index.js'

/**
 * Key for matching an image URL to an attachment: the path below `wp-content/uploads`, without
 * the size, `-scaled`, `-rotated` or edit suffixes WordPress adds to generated files. Hosts and
 * schemes are ignored, so CDN and http/https variants match too.
 */
export const mediaKey = (url: string): string | undefined => {
  let path: string
  try {
    path = decodeURIComponent(new URL(url, 'https://placeholder.invalid').pathname)
  } catch {
    return undefined
  }
  const at = path.indexOf('/uploads/')
  const rel = at === -1 ? path : path.slice(at + '/uploads/'.length)
  const dot = rel.lastIndexOf('.')
  if (dot <= 0) return undefined
  let base = rel.slice(0, dot)
  const ext = rel.slice(dot).toLowerCase()
  base = base
    .replace(/-\d+x\d+$/, '')
    .replace(/-e\d{13}$/, '')
    .replace(/-(scaled|rotated)$/, '')
  return `${base.toLowerCase()}${ext}`
}

export class MediaMatcher {
  private readonly byKey = new Map<string, number>()

  constructor(private readonly attachments: Map<number, IndexedAttachment>) {
    for (const a of attachments.values()) {
      for (const url of [a.url, a.file ?? '']) {
        const key = url ? mediaKey(url) : undefined
        if (key && !this.byKey.has(key)) this.byKey.set(key, a.id)
      }
    }
  }

  /** The attachment ID for an image, from its `wp-image-<id>` class or its URL. */
  match(src: string, className = ''): number | undefined {
    const fromClass = /\bwp-image-(\d+)\b/.exec(className)?.[1]
    if (fromClass && this.attachments.has(Number(fromClass))) return Number(fromClass)
    const key = mediaKey(src)
    return key ? this.byKey.get(key) : undefined
  }

  get(id: number): IndexedAttachment | undefined {
    return this.attachments.get(id)
  }
}
