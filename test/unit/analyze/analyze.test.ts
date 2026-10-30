import { describe, expect, it } from 'vitest'
import { analyzeExport } from '../../../src/analyze/analyze.js'
import { renderMarkdown } from '../../../src/analyze/markdown.js'
import { scanShortcodes } from '../../../src/content/shortcodes-scan.js'
import { fixture } from '../../helpers.js'

describe('analyzeExport', () => {
  it('counts content and blocks of a simple blog', async () => {
    const r = await analyzeExport(fixture('blog-gutenberg.xml'))
    expect(r.site).toEqual({
      title: 'Example Bakery Blog',
      url: 'https://blog.example.com',
      language: 'en-US',
      wxrVersion: '1.2',
      wordpressVersion: '6.6',
      multisite: false,
    })
    expect(r.counts).toMatchObject({
      posts: { total: 4, byStatus: { publish: 2, draft: 1, trash: 1 } },
      pages: { total: 3 },
      attachments: 3,
      categories: 3,
      tags: 2,
      authors: 2,
      comments: 2,
      menuItems: 1,
      customPostTypes: { recipe: 1 },
    })
    expect(r.content).toMatchObject({ gutenbergItems: 6, classicItems: 1, emptyItems: 0 })
    expect(r.content.blocks.find((b) => b.name === 'core/paragraph')).toEqual({
      name: 'core/paragraph',
      count: 9,
      items: 6,
      support: 'supported',
    })
    expect(r.content.blocks.find((b) => b.name === 'core/latest-posts')?.support).toBe('dropped')
    expect(r.content.shortcodes.map((s) => s.name)).toEqual(['caption', 'contact-form-7'])
    expect(r.seo.yoast).toEqual({ detected: true, items: 3, details: { itemsWithTitle: 2 } })
    expect(r.seo.rankmath.detected).toBe(false)
    expect(r.media).toEqual({ byType: { 'image/png': 3 }, hosts: ['blog.example.com'] })
    expect(r.complexity.level).toBe('simple')
  })

  it('detects page builders, unknown blocks and plugin shortcodes', async () => {
    const r = await analyzeExport(fixture('builders-shortcodes.xml'))
    expect(r.builders.elementor).toMatchObject({ detected: true, items: 1 })
    expect(r.builders.divi).toMatchObject({ detected: true, items: 1 })
    expect(r.builders.wpbakery).toMatchObject({ detected: true, items: 1 })
    expect(r.builders.beaver).toMatchObject({ detected: true, items: 1 })
    expect(r.builders.oxygen.detected).toBe(false)
    const unknown = r.content.blocks.filter((b) => b.support === 'unknown').map((b) => b.name)
    expect(unknown.sort()).toEqual(['acme/slider', 'acme/testimonial'])
    const names = r.content.shortcodes.map((s) => s.name)
    expect(names).toContain('button')
    expect(names).toContain('gallery')
    expect(names).not.toContain('Note')
    expect(names).not.toContain('escaped')
    expect(r.complexity.level).toBe('complex')
    const pluginReason = r.complexity.reasons.find((x) => x.reason.startsWith('plugin shortcodes'))
    expect(pluginReason?.reason).toBe('plugin shortcodes: button')
  })

  it('detects SEO, multilingual, WooCommerce and ACF data', async () => {
    const r = await analyzeExport(fixture('plugins.xml'))
    expect(r.site.multisite).toBe(true)
    expect(r.seo.rankmath).toMatchObject({ detected: true, items: 2 })
    expect(r.multilingual.polylang).toMatchObject({
      detected: true,
      items: 4,
      details: { languages: ['de', 'en'] },
    })
    expect(r.multilingual.wpml).toMatchObject({ detected: true, items: 1 })
    expect(r.woocommerce).toMatchObject({
      detected: true,
      items: 2,
      details: { product: 1, shop_order: 1, product_cat: 1 },
    })
    expect(r.acf).toMatchObject({
      detected: true,
      items: 1,
      details: { fieldGroups: 1, fields: 1 },
    })
    // Shop and ACF internals are not custom content types.
    expect(r.counts.customPostTypes).toEqual({})
    expect(r.media.hosts).toEqual(['cdn.example-cdn.com'])
    expect(r.complexity.level).toBe('complex')
  })

  it('reports XML errors and still counts the items', async () => {
    const r = await analyzeExport(fixture('malformed.xml'))
    expect(r.counts.posts.total).toBe(2)
    expect(r.issues.length).toBeGreaterThan(0)
    expect(r.issues[0]?.line).toBe(5)
    expect(r.complexity.reasons.some((x) => x.reason.includes('XML errors'))).toBe(true)
  })

  it('renders a Markdown report', async () => {
    const r = await analyzeExport(fixture('builders-shortcodes.xml'))
    const md = renderMarkdown({
      ...r,
      generatedAt: '2026-01-01T00:00:00.000Z',
      tool: { name: 'wp-to-payload', version: 'test' },
    })
    expect(md).toContain('# WordPress export analysis: Example Agency')
    expect(md).toContain('| `acme/slider` | 1 | 1 | ❌ no converter (content kept as HTML) |')
    expect(md).toContain('| Elementor | yes | 1 | text kept, layout lost |')
    expect(md).toMatchSnapshot()
  })
})

describe('scanShortcodes', () => {
  it('finds shortcodes but not bracketed text', () => {
    const found = scanShortcodes(
      '[gallery] [foo bar="1"] [self /] [wrap]x[/wrap] [Note] [[escaped attr="1"]] [1]',
    )
    expect([...found.keys()]).toEqual(['gallery', 'foo', 'self', 'wrap'])
  })
})

describe('blockSupport', () => {
  it('treats theme, query and comment blocks as dynamic', async () => {
    const { blockSupport } = await import('../../../src/content/blocks.js')
    expect(blockSupport('post-title')).toBe('dropped')
    expect(blockSupport('core/query-pagination-next')).toBe('dropped')
    expect(blockSupport('core/comments-title')).toBe('dropped')
    expect(blockSupport('core/paragraph')).toBe('supported')
    expect(blockSupport('core/pullquote')).toBe('partial')
    expect(blockSupport('acme/slider')).toBe('unknown')
  })
})
