import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MediaSource, uploadsPath } from '../../src/import/media.js'
import type { IndexedAttachment } from '../../src/wxr/site-index.js'

const attachment = (over: Partial<IndexedAttachment> = {}): IndexedAttachment => ({
  id: 1,
  url: 'https://site.example.com/wp-content/uploads/2024/01/a.png',
  file: '2024/01/a.png',
  filename: 'a.png',
  mimeType: 'image/png',
  title: 'A',
  parentId: 0,
  ...over,
})

const base = {
  allowedHosts: ['site.example.com'],
  offline: false,
  timeoutMs: 1000,
  maxBytes: 1000,
  retries: 1,
}

describe('MediaSource', () => {
  it('reads files from the uploads directory and never outside it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wp2p-uploads-'))
    mkdirSync(join(dir, '2024/01'), { recursive: true })
    writeFileSync(join(dir, '2024/01/a.png'), 'png')
    writeFileSync(join(tmpdir(), 'wp2p-secret.txt'), 'secret')
    const source = new MediaSource({ ...base, uploadsDir: dir, offline: true })
    const ok = await source.get(attachment())
    expect(ok).toMatchObject({ ok: true, source: 'local', file: { name: 'a.png', size: 3 } })
    const escape = await source.get(attachment({ file: '../wp2p-secret.txt' }))
    expect(escape.ok).toBe(false)
  })

  it('downloads only from allowed hosts and retries server errors', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls++
      if (calls === 1) return new Response('busy', { status: 503 })
      return new Response(Buffer.from('data'), { headers: { 'content-type': 'image/png' } })
    }) as unknown as typeof fetch
    const source = new MediaSource({ ...base, fetchImpl })
    expect(await source.get(attachment())).toMatchObject({ ok: true, source: 'download' })
    expect(calls).toBe(2)
    const other = await source.get(
      attachment({ url: 'https://evil.example.net/x.png', file: undefined }),
    )
    expect(other).toMatchObject({ ok: false, skipped: true })
  })

  it('does not retry client errors and rejects HTML pages', async () => {
    let calls = 0
    const notFound = (async () => {
      calls++
      return new Response('nope', { status: 404 })
    }) as unknown as typeof fetch
    expect(
      await new MediaSource({ ...base, retries: 3, fetchImpl: notFound }).get(attachment()),
    ).toMatchObject({
      ok: false,
      reason: 'download failed: HTTP 404',
    })
    expect(calls).toBe(1)
    const html = (async () =>
      new Response('<html>', {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })) as unknown as typeof fetch
    expect((await new MediaSource({ ...base, fetchImpl: html }).get(attachment())).ok).toBe(false)
  })

  it('finds the path below uploads from the URL when meta is missing', () => {
    expect(uploadsPath(attachment({ file: undefined }))).toBe('2024/01/a.png')
  })
})

describe('MediaSource errors', () => {
  it('explains network failures', async () => {
    const failing = (async () => {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('connect'), { code: 'ECONNREFUSED' }),
      })
    }) as unknown as typeof fetch
    const source = new MediaSource({ ...base, retries: 0, fetchImpl: failing })
    expect(await source.get(attachment())).toMatchObject({
      ok: false,
      reason: 'download failed: fetch failed (ECONNREFUSED)',
    })
  })
})

describe('MediaSource redirects', () => {
  const redirecting = (target: string) =>
    (async (url: URL) =>
      url.pathname.endsWith('a.png')
        ? new Response(null, { status: 301, headers: { location: target } })
        : new Response(Buffer.from('png'), {
            headers: { 'content-type': 'image/png' },
          })) as unknown as typeof fetch

  it('follows redirects to allowed hosts', async () => {
    const source = new MediaSource({
      ...base,
      fetchImpl: redirecting('/wp-content/uploads/2024/01/b.png'),
    })
    expect(await source.get(attachment())).toMatchObject({ ok: true, file: { size: 3 } })
  })

  it('does not follow redirects to other hosts', async () => {
    const source = new MediaSource({
      ...base,
      fetchImpl: redirecting('https://elsewhere.example.net/b.png'),
    })
    expect(await source.get(attachment())).toMatchObject({
      ok: false,
      skipped: true,
      reason: 'host elsewhere.example.net is not allowed (add it with --media-host or media.hosts)',
    })
  })
})
