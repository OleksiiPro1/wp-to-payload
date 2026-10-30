import { describe, expect, it } from 'vitest'
import { collect, fixture, fromString, wxr } from '../../helpers.js'
import { metaValue, type WxrItem } from '../../../src/wxr/model.js'

const items = (records: Awaited<ReturnType<typeof collect>>['records']): WxrItem[] =>
  records.flatMap((r) => (r.kind === 'item' ? [r.item] : []))

describe('readWxr', () => {
  it('reads the channel, authors, terms and items of a full export', async () => {
    const { records, issues } = await collect(fixture('blog-gutenberg.xml'))
    expect(issues).toEqual([])

    const site = records.find((r) => r.kind === 'site')
    expect(site?.kind === 'site' && site.site).toMatchObject({
      title: 'Example Bakery Blog',
      baseBlogUrl: 'https://blog.example.com',
      wxrVersion: '1.2',
      language: 'en-US',
    })

    const authors = records.flatMap((r) => (r.kind === 'author' ? [r.author] : []))
    expect(authors).toEqual([
      {
        id: 1,
        login: 'anna',
        email: 'anna@example.com',
        displayName: 'Anna Example',
        firstName: 'Anna',
        lastName: 'Example',
      },
      { id: 2, login: 'ben', email: 'ben@example.com', displayName: 'Ben Sample' },
    ])

    const terms = records.flatMap((r) => (r.kind === 'term' ? [r.term] : []))
    expect(terms.map((t) => `${t.taxonomy}:${t.slug}`)).toEqual([
      'category:news',
      'category:bread',
      'category:recipes',
      'post_tag:sourdough',
      'post_tag:tips',
      'nav_menu:main-menu',
    ])
    expect(terms.find((t) => t.slug === 'bread')?.parentSlug).toBe('recipes')
    expect(terms.find((t) => t.slug === 'recipes')).toMatchObject({
      name: 'Recipes & Baking',
      description: 'Everything we bake',
    })

    const all = items(records)
    expect(all.map((i) => `${i.type}:${i.id}`)).toEqual([
      'post:10',
      'post:11',
      'post:12',
      'post:13',
      'page:20',
      'page:21',
      'page:22',
      'attachment:101',
      'attachment:102',
      'attachment:103',
      'nav_menu_item:30',
      'recipe:40',
    ])

    const post = all[0] as WxrItem
    expect(post).toMatchObject({
      title: 'Hello Sourdough',
      slug: 'hello-sourdough',
      status: 'publish',
      creator: 'anna',
      isSticky: true,
      hasPassword: false,
      postDateGmt: '2024-01-15 09:30:00',
      commentCount: 2,
    })
    expect(post.content).toContain('<!-- wp:paragraph -->')
    expect(post.content).toContain('<!-- wp:latest-posts {"postsToShow":3} /-->')
    expect(post.terms).toEqual([
      { taxonomy: 'category', slug: 'bread', name: 'Bread' },
      { taxonomy: 'category', slug: 'recipes', name: 'Recipes & Baking' },
      { taxonomy: 'post_tag', slug: 'sourdough', name: 'Sourdough' },
    ])
    expect(metaValue(post, '_thumbnail_id')).toBe('101')
    expect(post.meta.get('_wp_old_slug')).toEqual(['hello-world', 'first-post'])
    // Comment content is not kept.
    expect(JSON.stringify([...post.meta])).not.toContain('Looks tasty')

    const attachment = all.find((i) => i.id === 101)
    expect(attachment?.attachmentUrl).toBe(
      'https://blog.example.com/wp-content/uploads/2024/01/hero.png',
    )
    expect(all.find((i) => i.id === 21)?.parentId).toBe(20)
  })

  it('accepts other namespace prefixes and versions', async () => {
    const xml = `<?xml version="1.0"?>
<rss xmlns:x="http://wordpress.org/export/1.1/" xmlns:c="http://purl.org/rss/1.0/modules/content/">
<channel><title>T</title><item><title>A</title><c:encoded><![CDATA[<p>Hi</p>]]></c:encoded>
<x:post_id>7</x:post_id><x:post_type>post</x:post_type></item></channel></rss>`
    const { records } = await collect(fromString(xml))
    expect(items(records)[0]).toMatchObject({ id: 7, type: 'post', content: '<p>Hi</p>' })
  })

  it('joins split CDATA sections and strips a byte order mark', async () => {
    const xml = `\uFEFF${wxr(
      `<item><title>A</title><content:encoded><![CDATA[a]]]]><![CDATA[>b]]></content:encoded><wp:post_id>1</wp:post_id></item>`,
    )}`
    const { records, issues } = await collect(fromString(xml))
    expect(issues).toEqual([])
    expect(items(records)[0]?.content).toBe('a]]>b')
  })

  it('reports XML errors with a line number and keeps reading', async () => {
    const xml = wxr(
      `<item><title>Fish & chips</title><wp:post_id>1</wp:post_id></item>
<item><title>Fine</title><wp:post_id>2</wp:post_id></item>`,
    )
    const { records, issues } = await collect(fromString(xml))
    expect(issues.length).toBeGreaterThan(0)
    expect(issues[0]?.line).toBe(10)
    expect(items(records).map((i) => i.id)).toEqual([1, 2])
    expect(items(records)[0]?.title).toBe('Fish & chips')
  })

  it('reads a file in small chunks', async () => {
    const { Readable } = await import('node:stream')
    const xml = wxr(
      `<item><title>Chunked</title><content:encoded><![CDATA[${'x'.repeat(5000)}]]></content:encoded><wp:post_id>3</wp:post_id></item>`,
    )
    const chunks = xml.match(/[\s\S]{1,7}/g) ?? []
    const { records } = await collect(Readable.from(chunks))
    expect(items(records)[0]?.content).toHaveLength(5000)
  })
})
