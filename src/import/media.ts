import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type { IndexedAttachment } from '../wxr/site-index.js'
import type { UploadFile } from './payload-types.js'

export interface MediaSourceOptions {
  /** Local copy of `wp-content/uploads`. */
  uploadsDir?: string
  /** Hosts files may be downloaded from. Files elsewhere are skipped. */
  allowedHosts: string[]
  /** Never download; only use `uploadsDir`. */
  offline: boolean
  timeoutMs: number
  maxBytes: number
  retries: number
  fetchImpl?: typeof fetch
}

export type MediaFileResult =
  | { ok: true; file: UploadFile; source: 'local' | 'download' }
  | { ok: false; reason: string; skipped: boolean }

const stripWww = (host: string) => host.toLowerCase().replace(/^www\./, '')

/** Path of the file below `wp-content/uploads`, from `_wp_attached_file` or the URL. */
export const uploadsPath = (attachment: IndexedAttachment): string | undefined => {
  if (attachment.file && !attachment.file.startsWith('/') && !/^[a-z]+:/i.test(attachment.file)) {
    return attachment.file
  }
  try {
    const path = decodeURIComponent(new URL(attachment.url).pathname)
    const at = path.indexOf('/uploads/')
    return at === -1 ? undefined : path.slice(at + '/uploads/'.length)
  } catch {
    return undefined
  }
}

/** fetch() reports network problems as "fetch failed"; the cause says what actually happened. */
const describeFetchError = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error)
  if (error.name === 'TimeoutError') return 'timed out'
  const cause = (error as { cause?: { code?: string; message?: string } }).cause
  const detail = cause?.code ?? cause?.message
  return detail ? `${error.message} (${detail})` : error.message
}

const delay = (ms: number) => new Promise((done) => setTimeout(done, ms))

export class MediaSource {
  private readonly hosts: Set<string>

  constructor(private readonly options: MediaSourceOptions) {
    this.hosts = new Set(options.allowedHosts.map(stripWww))
  }

  async get(attachment: IndexedAttachment): Promise<MediaFileResult> {
    const local = await this.fromUploadsDir(attachment)
    if (local) return { ok: true, file: local, source: 'local' }
    if (this.options.offline) {
      return {
        ok: false,
        skipped: true,
        reason: this.options.uploadsDir
          ? `not found in ${this.options.uploadsDir} (downloads are off)`
          : 'downloads are off and no --uploads-dir was given',
      }
    }
    return this.download(attachment)
  }

  private async fromUploadsDir(attachment: IndexedAttachment): Promise<UploadFile | undefined> {
    const dir = this.options.uploadsDir
    const rel = uploadsPath(attachment)
    if (!dir || !rel) return undefined
    const root = resolve(dir)
    const path = resolve(root, rel)
    const inside = relative(root, path)
    // Never read outside the uploads directory, whatever the export says.
    if (inside.startsWith('..') || isAbsolute(inside)) return undefined
    try {
      const info = await stat(path)
      if (!info.isFile() || info.size > this.options.maxBytes) return undefined
      const data = await readFile(path)
      return { data, mimetype: attachment.mimeType, name: attachment.filename, size: data.length }
    } catch {
      return undefined
    }
  }

  private async download(attachment: IndexedAttachment): Promise<MediaFileResult> {
    let url: URL
    try {
      url = new URL(attachment.url)
    } catch {
      return { ok: false, skipped: true, reason: `invalid URL ${attachment.url}` }
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return { ok: false, skipped: true, reason: `unsupported URL scheme ${url.protocol}` }
    }
    const notAllowed = (host: string): MediaFileResult => ({
      ok: false,
      skipped: true,
      reason: `host ${host} is not allowed (add it with --media-host or media.hosts)`,
    })
    if (!this.hosts.has(stripWww(url.host))) return notAllowed(url.host)
    let lastError = ''
    for (let attempt = 0; attempt <= this.options.retries; attempt++) {
      if (attempt > 0) await delay(500 * 2 ** (attempt - 1))
      try {
        const response = await this.fetchFollowingAllowedRedirects(url)
        if (typeof response === 'string') return notAllowed(response)
        if (!response.ok) {
          lastError = `HTTP ${response.status}`
          // Client errors do not get better with retries.
          if (response.status >= 400 && response.status < 500 && response.status !== 429) break
          continue
        }
        const length = Number(response.headers.get('content-length') ?? 0)
        if (length > this.options.maxBytes) {
          return {
            ok: false,
            skipped: true,
            reason: `larger than the ${this.options.maxBytes} byte limit`,
          }
        }
        const data = Buffer.from(await response.arrayBuffer())
        if (data.length > this.options.maxBytes) {
          return {
            ok: false,
            skipped: true,
            reason: `larger than the ${this.options.maxBytes} byte limit`,
          }
        }
        const type = response.headers.get('content-type')?.split(';')[0]?.trim()
        if (type?.startsWith('text/html')) {
          lastError = 'the server returned an HTML page instead of the file'
          break
        }
        return {
          ok: true,
          source: 'download',
          file: {
            data,
            mimetype: attachment.mimeType,
            name: attachment.filename,
            size: data.length,
          },
        }
      } catch (error) {
        lastError = describeFetchError(error)
      }
    }
    return { ok: false, skipped: false, reason: `download failed: ${lastError}` }
  }

  /**
   * Follows up to five redirects itself, so a redirect cannot lead to a host that is not
   * allowed. Returns the refused host instead of a response.
   */
  private async fetchFollowingAllowedRedirects(start: URL): Promise<Response | string> {
    const fetchImpl = this.options.fetchImpl ?? fetch
    let url = start
    for (let hop = 0; ; hop++) {
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(this.options.timeoutMs),
        redirect: 'manual',
        headers: { 'user-agent': 'wp-to-payload (+https://github.com/OleksiiPro1/wp-to-payload)' },
      })
      const location = response.headers.get('location')
      if (response.status < 300 || response.status >= 400 || !location || hop >= 5) return response
      const next = new URL(location, url)
      const scheme = next.protocol === 'https:' || next.protocol === 'http:'
      if (!scheme || !this.hosts.has(stripWww(next.host))) return next.host || next.protocol
      url = next
    }
  }
}
