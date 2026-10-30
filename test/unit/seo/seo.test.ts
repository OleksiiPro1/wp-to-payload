import { beforeAll, describe, expect, it } from 'vitest'
import { MediaMatcher } from '../../../src/content/media-match.js'
import { WarningCollector } from '../../../src/report/warnings.js'
import { extractSeo, type SeoContext } from '../../../src/seo/seo.js'
import type { WxrItem } from '../../../src/wxr/model.js'
import { buildSiteIndex } from '../../../src/wxr/site-index.js'
import { collect, fixture } from '../../helpers.js'

const load = async (file: string) => {
  const index = await buildSiteIndex(fixture(file))
  const { records } = await collect(fixture(file))
  const items = new Map<number, WxrItem>(
    records.flatMap((r) => (r.kind === 'item' ? [[r.item.id, r.item] as const] : [])),
  )
  const context = (item: WxrItem): SeoContext => ({
    site: index.site,
    separator: '-',
    media: new MediaMatcher(index.attachments),
    categoryNames: item.terms.filter((t) => t.taxonomy === 'category').map((t) => t.name),
    tagNames: item.terms.filter((t) => t.taxonomy === 'post_tag').map((t) => t.name),
    authorName: index.authors.get(item.creator)?.displayName ?? '',
    warnings: new WarningCollector(),
  })
  return { items, context }
}

const item = (items: Map<number, WxrItem>, id: number): WxrItem => {
  const found = items.get(id)
  if (!found) throw new Error(`fixture item ${id} missing`)
  return found
}

describe('extractSeo', () => {
  let blog: Awaited<ReturnType<typeof load>>
  let plugins: Awaited<ReturnType<typeof load>>
  beforeAll(async () => {
    blog = await load('blog-gutenberg.xml')
    plugins = await load('plugins.xml')
  })

  it('reads Yoast meta and resolves template variables', () => {
    const post = item(blog.items, 10)
    expect(extractSeo(post, blog.context(post))).toEqual({
      source: 'yoast',
      title: 'Hello Sourdough - Example Bakery Blog',
      description: 'Learn to bake your first sourdough loaf.',
      canonical: 'https://other.example.org/sourdough-guide/',
      imageWpId: 102,
    })
  })

  it('removes variables that need a live request and warns', () => {
    const post = item(blog.items, 11)
    const ctx = blog.context(post)
    expect(extractSeo(post, ctx).description).toBe('Opening hours change in.')
    expect(ctx.warnings.warnings.map((w) => w.code)).toEqual(['SEO_VARIABLE'])
  })

  it('reads Rank Math meta', () => {
    const post = item(plugins.items, 10)
    expect(extractSeo(post, plugins.context(post))).toEqual({
      source: 'rankmath',
      title: 'Hallo Welt - Beispiel Shop',
      description: 'Ein erster Beitrag.',
      imageWpId: 30,
    })
    const other = item(plugins.items, 11)
    expect(extractSeo(other, plugins.context(other)).title).toBe('Hello - Shop')
  })

  it('returns nothing for items without SEO meta', () => {
    const page = item(blog.items, 22)
    expect(extractSeo(page, blog.context(page))).toEqual({})
  })
})
