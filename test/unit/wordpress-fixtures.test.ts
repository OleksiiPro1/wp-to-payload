/**
 * Exports of real WordPress sites built by scripts/fixtures/generate.sh: core.xml comes from
 * WordPress's own exporter (Tools → Export), core.wp-cli.xml from `wp export`.
 */
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { analyzeExport } from '../../src/analyze/analyze.js'
import { prepareContent } from '../../src/content/pipeline.js'
import { SiteUrls } from '../../src/paths/site-urls.js'
import { buildRedirects } from '../../src/redirects/build.js'
import { parsePhpSerialized, phpGet } from '../../src/util/php-serialize.js'
import type { WxrItem } from '../../src/wxr/model.js'
import { buildSiteIndex, type SiteIndex } from '../../src/wxr/site-index.js'
import { collect } from '../helpers.js'
import { contentContext } from '../support/content-context.js'

const wordpressFixture = (name: string) =>
  fileURLToPath(new URL(`../fixtures/wxr/wordpress/${name}`, import.meta.url))

const EXPORTS = ['core.xml', 'core.wp-cli.xml'] as const

const itemsOf = async (name: string) => {
  const { records, issues } = await collect(wordpressFixture(name))
  const items = records.flatMap((r) => (r.kind === 'item' ? [r.item] : []))
  const terms = records.flatMap((r) => (r.kind === 'term' ? [r.term] : []))
  return { items, terms, issues }
}

describe('real WordPress exports', () => {
  it.each(EXPORTS)('%s reads without XML errors', async (name) => {
    const { items, issues } = await itemsOf(name)
    expect(issues).toEqual([])
    expect(items).toHaveLength(24)
  })

  it('both exporters write the same items and terms', async () => {
    const core = await itemsOf('core.xml')
    const cli = await itemsOf('core.wp-cli.xml')
    const summary = (items: WxrItem[]) =>
      items
        .map(
          (i) =>
            `${i.id}:${i.type}:${i.status}:${i.slug}:${i.parentId}:${[...i.meta.keys()].sort().join(',')}`,
        )
        .sort()
    expect(summary(cli.items)).toEqual(summary(core.items))
    const terms = (list: typeof core.terms) =>
      list.map((t) => `${t.taxonomy}:${t.slug}:${t.parentSlug ?? ''}`).sort()
    expect(terms(cli.terms)).toEqual(terms(core.terms))
  })

  it('only the WordPress exporter includes term meta', async () => {
    const core = await itemsOf('core.xml')
    const cli = await itemsOf('core.wp-cli.xml')
    const recipes = (list: typeof core.terms) => list.find((t) => t.slug === 'rezepte')?.meta
    expect(recipes(core.terms)).toEqual(
      new Map([
        ['color', ['#c08040']],
        ['featured', ['1']],
      ]),
    )
    expect(recipes(cli.terms)?.size).toBe(0)
  })

  it('attachment metadata parses without repairs, including the scaled image', async () => {
    const { items } = await itemsOf('core.xml')
    const attachments = items.filter((i) => i.type === 'attachment')
    expect(attachments).toHaveLength(3)
    for (const attachment of attachments) {
      const { value, repairs } = parsePhpSerialized(
        attachment.meta.get('_wp_attachment_metadata')?.[0] ?? '',
      )
      expect(repairs).toBe(0)
      expect(typeof phpGet(value, 'width')).toBe('number')
      expect(phpGet(value, 'sizes')).toBeInstanceOf(Map)
    }
    const scaled = attachments.find((a) => a.attachmentUrl?.endsWith('backstube-scaled.png'))
    const meta = parsePhpSerialized(scaled?.meta.get('_wp_attachment_metadata')?.[0] ?? '').value
    expect(phpGet(meta, 'original_image')).toBe('backstube.png')
  })

  it.each(EXPORTS)('analyze reports %s', async (name) => {
    const r = await analyzeExport(wordpressFixture(name))
    expect(r.site).toMatchObject({
      title: 'Bäckerei Beispiel',
      wordpressVersion: '7.1.4',
      multisite: false,
    })
    expect(r.counts).toMatchObject({
      posts: {
        total: 8,
        byStatus: { publish: 3, draft: 1, future: 1, private: 1, pending: 1, trash: 1 },
      },
      pages: { total: 3 },
      attachments: 3,
      categories: 5,
      tags: 2,
      authors: 3,
      comments: 3,
      menuItems: 7,
      customPostTypes: { recipe: 2 },
      otherTerms: { nav_menu: 2, recipe_category: 2 },
    })
    expect(r.content).toMatchObject({ gutenbergItems: 11, classicItems: 1, passwordProtected: 1 })
    const support = Object.fromEntries(r.content.blocks.map((b) => [b.name, b.support]))
    expect(support).toMatchObject({
      'core/block': 'dropped',
      'core/latest-posts': 'dropped',
      'core/embed': 'supported',
    })
    expect(r.content.blocks.filter((b) => b.support === 'unknown')).toEqual([])
    expect(r.content.shortcodes.map((s) => s.name)).toEqual(['caption', 'contact-form-7'])
  })

  describe('content and URLs', () => {
    let index: SiteIndex
    let items: WxrItem[]
    beforeAll(async () => {
      index = await buildSiteIndex(wordpressFixture('core.xml'))
      items = (await itemsOf('core.xml')).items
    })
    const item = (slug: string) => {
      const found = items.find((i) => i.slug === slug)
      if (!found) throw new Error(`no item ${slug}`)
      return found
    }

    it('matches every image, whatever size or scaled copy the content uses', () => {
      const ctx = contentContext(index, { postId: item('hallo-sauerteig').id })
      const { html, blocks } = prepareContent(item('hallo-sauerteig').content, ctx)
      const uploads = [...html.matchAll(/data-lexical-upload-id="m(\d+)"/g)].map((m) =>
        Number(m[1]),
      )
      const ids = Object.fromEntries([...index.attachments.values()].map((a) => [a.filename, a.id]))
      expect(uploads).toEqual([ids['brot.png'], ids['brot.png'], ids['croissant.png']])
      // Placeholders stand where the blocks were, in document order.
      const byToken = new Map(blocks.map((b) => [b.token, b.blockType]))
      const order = [...html.matchAll(/WP2PBLOCK\d+X/g)].map((m) => byToken.get(m[0]))
      expect(order).toEqual(['code', 'embed'])
      expect(html).toContain('href="/blog/neue-oeffnungszeiten"')
      expect(ctx.warnings.warnings.map((w) => `${w.code}:${w.subject}`)).toEqual([
        'BLOCK_REMOVED:core/block',
        'BLOCK_REMOVED:core/latest-posts',
      ])
      const team = contentContext(index, { postId: item('team').id })
      const teamHtml = prepareContent(item('team').content, team).html
      expect(teamHtml).toContain(`data-lexical-upload-id="m${ids['backstube-scaled.png']}"`)
    })

    it('redirects the earlier slug and leaves unchanged URLs alone', () => {
      const urls = new SiteUrls(index, {
        patterns: { post: '/blog/:slug', page: '/:path', recipe: '/rezepte/:slug' },
      })
      const { redirects, warnings } = buildRedirects(index, urls)
      expect(warnings).toEqual([])
      expect(redirects.map((r) => `${r.from} -> ${r.to}`)).toEqual([
        '/2024/01/15/erster-beitrag/ -> /blog/hallo-sauerteig',
        '/2024/01/15/hallo-sauerteig/ -> /blog/hallo-sauerteig',
        '/2024/02/01/neue-oeffnungszeiten/ -> /blog/neue-oeffnungszeiten',
        '/2024/02/11/geheimrezept/ -> /blog/geheimrezept',
      ])
    })
  })
})
