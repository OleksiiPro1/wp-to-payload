/** Imports an export of a real WordPress site (scripts/fixtures) into a Payload project. */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildSiteIndex } from '../../src/wxr/site-index.js'
import {
  buildPackage,
  createRun,
  projectInstalled,
  queryPayload,
  runCli,
  writePayloadConfig,
} from '../support/payload-project.js'
import { solidPng } from '../support/png.js'

const exportFile = fileURLToPath(new URL('../fixtures/wxr/wordpress/core.xml', import.meta.url))

interface Imported {
  hello: {
    slug: string
    status: string
    author?: string
    categories: string[]
    tags: string[]
    featured?: string
    nodes: string[]
  }
  team: { parent?: string; image?: string }
  draft: { slug: string; status: string }
  pending: { slug: string; status: string }
  secret: string
  bread?: string
  rye: {
    slug: string
    status: string
    author?: string
    excerpt?: string
    featured?: string
    categories: string[]
  }
  rollsLinks: string[]
  rye_flour: { parent?: string; links: string[] }
  sourdoughBread?: string
  redirects: string[]
}

interface Report {
  phases: Record<string, { created: number; updated: number; skipped: number; failed: number }>
  errors: unknown[]
  warnings: { code: string; wpId?: number }[]
}

describe.skipIf(!projectInstalled())('import of a real WordPress export', () => {
  let dir: string
  const args = [
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
  const report = () =>
    JSON.parse(
      readFileSync(join(dir, 'wp-to-payload-report', 'import-report.json'), 'utf8'),
    ) as Report

  beforeAll(async () => {
    buildPackage()
    dir = createRun('wordpress-core')
    // The export has no files; put a generated image where each attachment's file would be.
    const index = await buildSiteIndex(exportFile)
    for (const attachment of index.attachments.values()) {
      const file = join(dir, 'uploads', attachment.file ?? attachment.filename)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, solidPng(8, 5, [attachment.id * 40, 100, 50]))
    }
    const scaffold = runCli(dir, ['scaffold', exportFile])
    expect(scaffold.status, scaffold.output).toBe(0)
    writePayloadConfig(dir, '', ['posts', 'pages', 'guides', 'recipes'])
    // Archives of the custom taxonomy get new URLs; its old base is the rewrite slug.
    writeFileSync(
      join(dir, 'wp-to-payload.config.json'),
      JSON.stringify({
        taxonomies: {
          recipe_category: { base: 'rezeptkategorie', path: '/rezepte/kategorie/:path' },
        },
      }),
    )
  })

  afterAll(() => {
    if (dir && !process.env.WP2P_KEEP_RUNS) rmSync(dir, { recursive: true, force: true })
  })

  it('imports everything without errors', () => {
    const run = runCli(dir, args)
    expect(run.status, run.output).toBe(0)
    const r = report()
    expect(r.errors).toEqual([])
    expect(r.phases).toMatchObject({
      media: { created: 3, failed: 0 },
      categories: { created: 5 },
      tags: { created: 2 },
      authors: { created: 3 },
      'recipe-categories': { created: 3 },
      // Eight posts, one of them in the trash.
      posts: { created: 7, failed: 0 },
      pages: { created: 3, failed: 0 },
      guides: { created: 2, failed: 0 },
      recipes: { created: 2, failed: 0 },
      redirects: { created: 11 },
    })
    const codes = new Set(r.warnings.map((w) => w.code))
    expect([...codes].sort()).toEqual(['BLOCK_REMOVED', 'PASSWORD_PROTECTED', 'SHORTCODE_REMOVED'])

    const data = queryPayload<Imported>(
      dir,
      `
      const one = async (collection: string, wpId: number) =>
        (await payload.find({ collection: collection as never, where: { wpId: { equals: wpId } }, depth: 1, draft: true })).docs[0] as any
      const hello = await one('posts', 10)
      const team = await one('pages', 6)
      const draft = await one('posts', 12)
      const pending = await one('posts', 16)
      const secret = await one('posts', 15)
      const rye = await one('recipes', 19)
      const rolls = await one('recipes', 20)
      const ryeFlour = await one('guides', 29)
      const links = (root: any) => {
        const found: string[] = []
        const walk = (n: any) => { if (n.type === 'link') found.push(n.fields.url); (n.children ?? []).forEach(walk) }
        walk(root)
        return found
      }
      return {
        hello: {
          slug: hello.slug, status: hello._status, author: hello.author?.name,
          categories: hello.categories.map((c: any) => c.slug).sort(), tags: hello.tags.map((t: any) => t.slug),
          featured: hello.featuredImage?.filename,
          nodes: hello.content.root.children.map((n: any) => n.type === 'upload' ? 'upload:' + n.value.filename : n.type === 'block' ? 'block:' + n.fields.blockType : n.type),
        },
        team: { parent: team.parent?.slug, image: team.content.root.children.find((n: any) => n.type === 'upload')?.value?.filename },
        draft: { slug: draft.slug, status: draft._status },
        pending: { slug: pending.slug, status: pending._status },
        secret: secret._status,
        bread: (await payload.find({ collection: 'categories', where: { slug: { equals: 'brot' } }, depth: 1 })).docs[0]?.parent?.slug,
        rye: {
          slug: rye.slug, status: rye._status, author: rye.author?.name, excerpt: rye.excerpt,
          featured: rye.featuredImage?.filename, categories: rye.recipeCategories.map((c: any) => c.slug).sort(),
        },
        rollsLinks: links(rolls.content.root),
        rye_flour: { parent: ryeFlour.parent?.slug, links: links(ryeFlour.content.root) },
        sourdoughBread: (await payload.find({ collection: 'recipe-categories', where: { slug: { equals: 'sauerteigbrot' } }, depth: 1 })).docs[0]?.parent?.slug,
        redirects: (await payload.find({ collection: 'redirects', depth: 0, pagination: false, sort: 'from' })).docs
          .filter((d: any) => !d.from.startsWith('/20'))
          .map((d: any) => d.from + ' ' + (d.to.type === 'reference' ? d.to.reference.relationTo : d.to.url)),
      }`,
    )
    expect(data.hello).toEqual({
      slug: 'hallo-sauerteig',
      status: 'published',
      author: 'Anna Beispiel',
      categories: ['brot', 'rezepte'],
      tags: ['sauerteig'],
      featured: 'backstube-scaled.png',
      nodes: [
        'paragraph',
        'heading',
        'list',
        'upload:brot.png',
        'paragraph',
        'quote',
        'block:Code',
        'table',
        'horizontalrule',
        'paragraph',
        'block:embed',
        'upload:brot.png',
        'upload:croissant.png',
        'paragraph',
        'paragraph',
      ],
    })
    expect(data.team).toEqual({ parent: 'ueber-uns', image: 'backstube-scaled.png' })
    // WordPress keeps no slug for drafts and pending posts; it comes from the title.
    expect(data.draft).toEqual({ slug: 'bald-roggenbrot', status: 'draft' })
    expect(data.pending).toEqual({ slug: 'wartet-auf-freigabe', status: 'draft' })
    expect(data.secret).toBe('draft')
    expect(data.bread).toBe('rezepte')

    // A custom post type with its own hierarchical taxonomy.
    expect(data.rye).toEqual({
      slug: 'roggenbrot',
      status: 'published',
      author: 'Anna Beispiel',
      excerpt: 'Kräftig und saftig.',
      featured: 'brot.png',
      categories: ['brot', 'sauerteigbrot'],
    })
    expect(data.sourdoughBread).toBe('brot')
    expect(data.rollsLinks).toEqual(['/recipes/roggenbrot', '/rezepte/kategorie/suesses'])
    // A hierarchical custom post type.
    expect(data.rye_flour).toEqual({ parent: 'mehlsorten', links: ['/recipes/roggenbrot'] })
    expect(data.redirects).toEqual([
      '/ratgeber/mehlsorten/ guides',
      '/ratgeber/mehlsorten/roggenmehl/ guides',
      '/rezepte/roggenbrot/ recipes',
      '/rezepte/zimtschnecken/ recipes',
      '/rezeptkategorie/brot/ /rezepte/kategorie/brot',
      '/rezeptkategorie/sauerteigbrot/ /rezepte/kategorie/brot/sauerteigbrot',
      '/rezeptkategorie/suesses/ /rezepte/kategorie/suesses',
    ])
  })

  it('updates everything on a second run', () => {
    const run = runCli(dir, args)
    expect(run.status, run.output).toBe(0)
    const phases = report().phases
    for (const phase of Object.keys(phases)) expect(phases[phase]?.created, phase).toBe(0)
    expect(phases.posts?.updated).toBe(7)
    expect(phases.recipes?.updated).toBe(2)
    expect(phases['recipe-categories']?.updated).toBe(3)
  })
})
