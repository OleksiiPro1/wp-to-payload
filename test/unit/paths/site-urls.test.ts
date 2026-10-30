import { beforeAll, describe, expect, it } from 'vitest'
import { fillPattern, validatePattern } from '../../../src/paths/patterns.js'
import { SiteUrls } from '../../../src/paths/site-urls.js'
import { buildSiteIndex, type SiteIndex } from '../../../src/wxr/site-index.js'
import { fixture } from '../../helpers.js'

let index: SiteIndex
const post = (id: number) => {
  const p = index.posts.get(id)
  if (!p) throw new Error(`no post ${id}`)
  return p
}
beforeAll(async () => {
  index = await buildSiteIndex(fixture('blog-gutenberg.xml'))
})

describe('patterns', () => {
  it('fills tokens and normalizes slashes', () => {
    expect(fillPattern('/blog/:year/:slug/', { year: '2024', slug: 'a' })).toBe('/blog/2024/a')
    expect(fillPattern('/:path', { path: '' })).toBe('/')
  })

  it('rejects unknown tokens and relative patterns', () => {
    expect(validatePattern('/blog/:slug')).toBeUndefined()
    expect(validatePattern('blog/:slug')).toMatch(/must start/)
    expect(validatePattern('/:foo')).toMatch(/unknown token ":foo"/)
  })
})

describe('SiteUrls', () => {
  it('computes new paths from patterns', () => {
    const urls = new SiteUrls(index, {
      patterns: { post: '/blog/:year/:category/:slug', page: '/:path' },
    })
    expect(urls.newPath(10)).toBe('/blog/2024/recipes/bread/hello-sourdough')
    expect(urls.newPath(21)).toBe('/about/team')
    expect(urls.newPath(40)).toBeUndefined()
  })

  it('uses the Payload website template routes by default', () => {
    const urls = new SiteUrls(index)
    expect(urls.newPath(10)).toBe('/posts/hello-sourdough')
    expect(urls.newPath(21)).toBe('/team')
  })

  it('lists old paths, including earlier slugs, only for published items', () => {
    const urls = new SiteUrls(index)
    expect(urls.oldPaths(post(10))).toEqual([
      '/2024/01/15/hello-sourdough/',
      '/2024/01/15/hello-world/',
      '/2024/01/15/first-post/',
    ])
    expect(urls.oldPaths(post(12))).toEqual([])
  })

  it('rewrites internal links in every common form', () => {
    const urls = new SiteUrls(index, { patterns: { category: '/blog/category/:path' } })
    expect(urls.rewriteHref('https://blog.example.com/2024/02/01/bakery-news/')).toBe(
      '/posts/bakery-news',
    )
    expect(urls.rewriteHref('http://www.blog.example.com/about/team')).toBe('/team')
    expect(urls.rewriteHref('/2024/01/15/hello-world/#steps')).toBe('/posts/hello-sourdough#steps')
    expect(urls.rewriteHref('https://blog.example.com/?p=11')).toBe('/posts/bakery-news')
    expect(urls.rewriteHref('https://blog.example.com/?page_id=20')).toBe('/about')
    expect(urls.rewriteHref('https://blog.example.com/category/recipes/bread/')).toBe(
      '/blog/category/recipes/bread',
    )
    expect(urls.rewriteHref('https://blog.example.com/tag/sourdough/')).toBeUndefined()
    expect(urls.rewriteHref('https://elsewhere.example.org/about/')).toBeUndefined()
    expect(urls.rewriteHref('mailto:hello@example.com')).toBeUndefined()
    expect(urls.rewriteHref('https://blog.example.com/wp-content/uploads/a.png')).toBeUndefined()
  })
})
