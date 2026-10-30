import { describe, expect, it } from 'vitest'
import { buildSiteIndex, siteUrlOf } from '../../../src/wxr/site-index.js'
import { fixture } from '../../helpers.js'

describe('buildSiteIndex', () => {
  it('indexes attachments, posts and terms without content', async () => {
    const index = await buildSiteIndex(fixture('blog-gutenberg.xml'))
    expect(siteUrlOf(index.site)).toBe('https://blog.example.com')
    expect([...index.authors.keys()]).toEqual(['anna', 'ben'])
    expect([...index.attachments.keys()]).toEqual([101, 102, 103])
    expect(index.attachments.get(101)).toMatchObject({
      file: '2024/01/hero.png',
      filename: 'hero.png',
      mimeType: 'image/png',
      alt: 'Bakery counter at sunrise',
      caption: 'Morning light in the bakery',
    })
    // Menus are skipped; the custom post type is kept.
    expect([...index.posts.keys()]).toEqual([10, 11, 12, 13, 20, 21, 22, 40])
    expect(index.posts.get(10)?.oldSlugs).toEqual(['hello-world', 'first-post'])
    expect(index.posts.get(12)).toMatchObject({ slug: 'upcoming-recipe', slugDerived: true })
    expect(JSON.stringify([...index.posts.values()])).not.toContain('Welcome to our')
  })
})
