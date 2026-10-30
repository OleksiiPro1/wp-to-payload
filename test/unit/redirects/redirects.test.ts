import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SiteUrls } from '../../../src/paths/site-urls.js'
import { buildRedirects } from '../../../src/redirects/build.js'
import { FORMATS, formatRedirects } from '../../../src/redirects/formats.js'
import { buildSiteIndex } from '../../../src/wxr/site-index.js'
import { fixture, fromString, wxr } from '../../helpers.js'

const post = (id: number, slug: string, link: string, type = 'post', status = 'publish') =>
  `<item><title>T${id}</title><link>${link}</link><wp:post_id>${id}</wp:post_id><wp:post_name><![CDATA[${slug}]]></wp:post_name><wp:status>${status}</wp:status><wp:post_type>${type}</wp:post_type><wp:post_date>2024-05-06 10:00:00</wp:post_date></item>`

const tricky = wxr(
  [
    post(1, '%c3%bcber-uns', 'https://site.example.com/%c3%bcber-uns/', 'page'),
    post(2, 'a-b-c', 'https://site.example.com/2024/05/a b (c)/'),
    post(3, 'quote', 'https://site.example.com/say-"hi":now/'),
    post(4, 'about', 'https://site.example.com/about/', 'page'),
    post(5, 'about', 'https://site.example.com/company/about/', 'page'),
    post(6, 'draft', 'https://site.example.com/?p=6', 'post', 'draft'),
  ].join('\n'),
)

const golden = (name: string, actual: string) => {
  const file = fileURLToPath(new URL(`../../golden/${name}`, import.meta.url))
  if (process.env.UPDATE_GOLDEN) writeFileSync(file, actual)
  expect(actual).toBe(readFileSync(file, 'utf8'))
}

describe('buildRedirects', () => {
  it('maps permalinks and earlier slugs, skipping unchanged URLs', async () => {
    const index = await buildSiteIndex(fixture('blog-gutenberg.xml'))
    const urls = new SiteUrls(index, { patterns: { post: '/blog/:slug', page: '/:path' } })
    const { redirects, warnings } = buildRedirects(index, urls)
    expect(warnings).toEqual([])
    expect(redirects.map((r) => `${r.kind} ${r.from} -> ${r.to}`)).toEqual([
      'old-slug /2024/01/15/first-post/ -> /blog/hello-sourdough',
      'permalink /2024/01/15/hello-sourdough/ -> /blog/hello-sourdough',
      'old-slug /2024/01/15/hello-world/ -> /blog/hello-sourdough',
      'permalink /2024/02/01/bakery-news/ -> /blog/bakery-news',
    ])
  })

  it('reports two items with the same new path', async () => {
    const index = await buildSiteIndex(fromString(tricky))
    const urls = new SiteUrls(index, { patterns: { post: '/blog/:slug', page: '/:slug' } })
    const { redirects, warnings } = buildRedirects(index, urls)
    expect(warnings.map((w) => w.code)).toEqual(['REDIRECT_CONFLICT'])
    expect(warnings[0]?.message).toContain('both get the new path /about')
    // Item 5 conflicts with item 4, so its old URL is not redirected anywhere.
    expect(redirects.find((r) => r.from.includes('about'))).toBeUndefined()
  })

  it.each(FORMATS)('writes %s with special characters escaped', async (format) => {
    const index = await buildSiteIndex(fromString(tricky))
    const urls = new SiteUrls(index, { patterns: { post: '/blog/:year/:slug', page: '/:path' } })
    const { redirects } = buildRedirects(index, urls)
    golden(`redirects.${format}.txt`, formatRedirects(format, redirects))
  })
})
