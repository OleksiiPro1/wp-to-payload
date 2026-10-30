import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ConfigError, DEFAULT_CONFIG, loadConfig, parseConfig } from '../../src/config.js'

describe('config', () => {
  it('uses defaults without a file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wp2p-config-'))
    expect(await loadConfig(dir)).toEqual(DEFAULT_CONFIG)
  })

  it('merges settings with the defaults', () => {
    const config = parseConfig({
      paths: { post: '/blog/:slug', recipe: '/recipes/:slug' },
      collections: { posts: 'articles' },
      fields: { featuredImage: 'heroImage' },
      seo: { separator: '|' },
    })
    expect(config.paths).toEqual({ post: '/blog/:slug', page: '/:slug', recipe: '/recipes/:slug' })
    expect(config.collections.posts).toBe('articles')
    expect(config.collections.media).toBe('media')
    expect(config.fields.featuredImage).toBe('heroImage')
    expect(config.seo.separator).toBe('|')
  })

  it('rejects unknown keys and bad patterns', () => {
    expect(() => parseConfig({ path: {} })).toThrow(ConfigError)
    expect(() => parseConfig({ paths: { post: 'blog' } })).toThrow(/must start with/)
    expect(() => parseConfig({ collections: { users: 'users' } })).toThrow(/unknown collection/)
  })

  it('reports an explicitly given file that is missing or broken', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wp2p-config-'))
    await expect(loadConfig(dir, 'missing.json')).rejects.toThrow(/cannot read/)
    writeFileSync(join(dir, 'bad.json'), '{ nope')
    await expect(loadConfig(dir, 'bad.json')).rejects.toThrow(/not valid JSON/)
  })
})
