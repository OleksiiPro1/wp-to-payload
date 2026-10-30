import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fixture } from '../helpers.js'
import {
  buildPackage,
  createRun,
  projectInstalled,
  queryPayload,
  runCli,
  writePayloadConfig,
} from '../support/payload-project.js'
import { solidPng } from '../support/png.js'

const installed = projectInstalled()
if (!installed) {
  console.warn(
    'Skipping: install the test project first with `npm ci --prefix test/payload-project`.',
  )
}

interface ImportReport {
  dryRun: boolean
  phases: Record<string, { created: number; updated: number; skipped: number; failed: number }>
  errors: unknown[]
  warnings: { code: string; wpId?: number }[]
}

const COLLECTIONS = ['media', 'categories', 'tags', 'authors', 'posts', 'pages', 'redirects']
const countAll = `
  const counts: Record<string, number> = {}
  for (const collection of ${JSON.stringify(COLLECTIONS)}) {
    counts[collection] = (await payload.count({ collection: collection as never })).totalDocs
  }
  return counts`

describe.skipIf(!installed)('import into a Payload 3 project with SQLite', () => {
  let dir: string
  const exportFile = fixture('blog-gutenberg.xml')
  const importArgs = [
    'import',
    exportFile,
    '--uploads-dir',
    'uploads',
    '--offline',
    '--post-path',
    '/blog/:slug',
    '--page-path',
    '/:path',
    '--write-redirects',
  ]
  const report = (): ImportReport =>
    JSON.parse(
      readFileSync(join(dir, 'wp-to-payload-report', 'import-report.json'), 'utf8'),
    ) as ImportReport

  beforeAll(() => {
    buildPackage()
    dir = createRun('import')
    const uploads: [string, [number, number, number]][] = [
      ['2024/01/hero.png', [200, 120, 40]],
      ['2024/01/loaf.png', [150, 90, 30]],
      ['2024/02/croissant.png', [230, 180, 60]],
    ]
    for (const [path, color] of uploads) {
      const file = join(dir, 'uploads', path)
      mkdirSync(join(file, '..'), { recursive: true })
      writeFileSync(file, solidPng(4, 3, color))
    }
  })

  afterAll(() => {
    if (dir && !process.env.WP2P_KEEP_RUNS) rmSync(dir, { recursive: true, force: true })
  })

  it('scaffolds the collections', () => {
    const run = runCli(dir, ['scaffold'])
    expect(run.status, run.output).toBe(0)
    for (const file of ['index.ts', 'Posts.ts', 'Pages.ts', 'Media.ts', 'fields.ts', 'editor.ts']) {
      expect(existsSync(join(dir, 'src', 'collections', 'wp', file))).toBe(true)
    }
    expect(run.output).toContain("import { wpCollections } from './collections/wp'")
    writePayloadConfig(dir)
  })

  it('writes nothing in a dry run', () => {
    const run = runCli(dir, [...importArgs, '--dry-run'])
    expect(run.status, run.output).toBe(0)
    expect(run.output).toContain('Dry run: nothing was written')
    expect(report()).toMatchObject({
      dryRun: true,
      phases: { posts: { created: 3 }, pages: { created: 3 } },
    })
    const counts = queryPayload<Record<string, number>>(dir, countAll)
    expect(Object.values(counts).every((n) => n === 0)).toBe(true)
  })

  it('imports media, terms, authors, posts, pages and redirects with their relations', () => {
    const run = runCli(dir, importArgs)
    expect(run.status, run.output).toBe(0)
    const r = report()
    expect(r.errors).toEqual([])
    expect(r.phases).toMatchObject({
      media: { created: 3, failed: 0 },
      categories: { created: 3 },
      tags: { created: 2 },
      authors: { created: 2 },
      posts: { created: 3 },
      pages: { created: 3 },
      redirects: { created: 4 },
    })
    expect(r.warnings.map((w) => w.code).sort()).toEqual([
      'BLOCK_REMOVED',
      'SEO_CANONICAL',
      'SEO_VARIABLE',
      'SHORTCODE_REMOVED',
    ])

    const data = queryPayload<{
      counts: Record<string, number>
      post: Record<string, unknown>
      ids: Record<string, Record<number, number>>
      nodes: string[]
      draft: { status: string; slug: string }
      teamParent: number | null
      breadParent: number | null
      redirects: string[]
    }>(
      dir,
      `${countAll.replace('return counts', '')}
      const ids: Record<string, Record<number, number>> = {}
      for (const collection of ['media', 'categories', 'tags', 'authors', 'posts', 'pages']) {
        const docs = (await payload.find({ collection: collection as never, depth: 0, pagination: false, draft: true })).docs as any[]
        ids[collection] = Object.fromEntries(docs.map((d) => [d.wpId, d.id]))
      }
      const post = (await payload.find({ collection: 'posts', where: { wpId: { equals: 10 } }, depth: 0 })).docs[0] as any
      const nodes = post.content.root.children.map((n: any) =>
        n.type === 'block' ? 'block:' + n.fields.blockType : n.type === 'upload' ? 'upload:' + n.value : n.type)
      const draft = (await payload.find({ collection: 'posts', where: { wpId: { equals: 12 } }, depth: 0, draft: true })).docs[0] as any
      const team = (await payload.find({ collection: 'pages', where: { wpId: { equals: 21 } }, depth: 0 })).docs[0] as any
      const bread = (await payload.find({ collection: 'categories', where: { slug: { equals: 'bread' } }, depth: 0 })).docs[0] as any
      const redirects = (await payload.find({ collection: 'redirects', depth: 0, pagination: false, sort: 'from' })).docs
        .map((d: any) => d.from + ' ' + d.to.type + ':' + (d.to.reference?.value ?? d.to.url))
      const links: string[] = []
      const walk = (n: any) => { if (n.type === 'link') links.push(n.fields.url); (n.children ?? []).forEach(walk) }
      walk(post.content.root)
      return { counts, ids, post: { ...post, content: undefined, links }, nodes,
        draft: { status: draft._status, slug: draft.slug }, teamParent: team.parent ?? null,
        breadParent: bread.parent ?? null, redirects }`,
    )

    expect(data.counts).toEqual({
      media: 3,
      categories: 3,
      tags: 2,
      authors: 2,
      posts: 3,
      pages: 3,
      redirects: 4,
    })
    const { ids, post } = data
    const media = ids.media as Record<number, number>
    const categories = ids.categories as Record<number, number>
    expect(post).toMatchObject({
      title: 'Hello Sourdough',
      slug: 'hello-sourdough',
      _status: 'published',
      publishedAt: '2024-01-15T09:30:00.000Z',
      excerpt: 'Our first post about sourdough.',
      author: ids.authors?.[1],
      categories: [categories[4], categories[3]],
      tags: [ids.tags?.[5]],
      featuredImage: media[101],
      meta: {
        title: 'Hello Sourdough - Example Bakery Blog',
        description: 'Learn to bake your first sourdough loaf.',
        image: media[102],
      },
    })
    expect(post.links).toEqual(['/blog/bakery-news', '/about', '/contact'])
    expect(data.nodes).toEqual([
      'paragraph',
      'heading',
      'list',
      `upload:${media[102]}`,
      'paragraph',
      'quote',
      'block:Code',
      'paragraph',
      'horizontalrule',
      'paragraph',
      'block:embed',
      'table',
      `upload:${media[102]}`,
      `upload:${media[103]}`,
      'paragraph',
      'paragraph',
    ])
    expect(data.draft).toEqual({ status: 'draft', slug: 'upcoming-recipe' })
    expect(data.teamParent).toBe(ids.pages?.[20])
    expect(data.breadParent).toBe(categories[3])
    expect(data.redirects).toEqual([
      `/2024/01/15/first-post/ reference:${ids.posts?.[10]}`,
      `/2024/01/15/hello-sourdough/ reference:${ids.posts?.[10]}`,
      `/2024/01/15/hello-world/ reference:${ids.posts?.[10]}`,
      `/2024/02/01/bakery-news/ reference:${ids.posts?.[11]}`,
    ])
  })

  it('updates instead of duplicating when run again', () => {
    const run = runCli(dir, importArgs)
    expect(run.status, run.output).toBe(0)
    expect(report().phases).toMatchObject({
      media: { created: 0, updated: 3 },
      posts: { created: 0, updated: 3 },
      pages: { created: 0, updated: 3 },
      redirects: { created: 0, updated: 4 },
    })
    const counts = queryPayload<Record<string, number>>(dir, countAll)
    expect(counts).toEqual({
      media: 3,
      categories: 3,
      tags: 2,
      authors: 2,
      posts: 3,
      pages: 3,
      redirects: 4,
    })
  })
})

describe.skipIf(!installed)('import preflight', () => {
  let dir: string

  beforeAll(() => {
    buildPackage()
    dir = createRun('preflight')
  })

  afterAll(() => {
    if (dir && !process.env.WP2P_KEEP_RUNS) rmSync(dir, { recursive: true, force: true })
  })

  it('stops with a clear message when a collection lacks wpId', () => {
    expect(runCli(dir, ['scaffold']).status).toBe(0)
    writeFileSync(
      join(dir, 'src', 'collections', 'wp', 'Tags.ts'),
      "import type { CollectionConfig } from 'payload'\n" +
        "export const Tags: CollectionConfig = { slug: 'tags', fields: [{ name: 'title', type: 'text' }] }\n",
    )
    writePayloadConfig(dir)
    const run = runCli(dir, [
      'import',
      fixture('blog-gutenberg.xml'),
      '--only',
      'tags',
      '--offline',
    ])
    expect(run.status, run.output).toBe(2)
    expect(run.output).toContain('collection "tags" has no "wpId" field')
  })
})
