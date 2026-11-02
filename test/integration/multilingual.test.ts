/** Imports the German and English Polylang site (scripts/fixtures) into localized collections. */
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

const exportFile = fileURLToPath(
  new URL('../fixtures/wxr/wordpress/multilingual.xml', import.meta.url),
)
const LOCALIZATION = `localization: { locales: ['de', 'en'], defaultLocale: 'de', fallback: false },`

interface Imported {
  about: { id: number; wpId: number; wpIds: number[]; de: string[]; en: string[] }
  team: { parent?: number; en: string[] }
  bench: {
    same: boolean
    titles: string[]
    slugs: string[]
    status: string
    categories: string[]
    tags: string[]
    images: (number | undefined)[]
    linksDe: string[]
    linksEn: string[]
    subtitles: string[]
    wood: string[]
  }
  holiday: { status: string; de: string | null; en: string }
  englishOnly: { de: string | null; en: string }
  products: string[]
  furniture: { title: string; parent?: string }
  media: { same: boolean; alt: string[] }
  redirects: string[]
}

interface Report {
  phases: Record<string, { created: number; updated: number; skipped: number; failed: number }>
  errors: unknown[]
  warnings: { code: string; wpId?: number; message: string }[]
}

/** A Payload project with the scaffolded collections and the export's images. */
const prepare = async (name: string, config: string, file = exportFile): Promise<string> => {
  const dir = createRun(name)
  const index = await buildSiteIndex(file)
  for (const attachment of index.attachments.values()) {
    const path = join(dir, 'uploads', attachment.file ?? attachment.filename)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, solidPng(6, 4, [150, 110, 70]))
  }
  const scaffold = runCli(dir, ['scaffold', file])
  expect(scaffold.status, scaffold.output).toBe(0)
  writePayloadConfig(dir, config)
  return dir
}

const importArgs = (file = exportFile) => [
  'import',
  file,
  '--uploads-dir',
  'uploads',
  '--offline',
  '--post-path',
  '/blog/:slug',
  '--page-path',
  '/:path',
  '--write-redirects',
]

const report = (dir: string) =>
  JSON.parse(
    readFileSync(join(dir, 'wp-to-payload-report', 'import-report.json'), 'utf8'),
  ) as Report

describe.skipIf(!projectInstalled())('import of a multilingual Polylang site', () => {
  const dirs: string[] = []
  beforeAll(() => buildPackage())
  afterAll(() => {
    if (!process.env.WP2P_KEEP_RUNS)
      for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  })

  it('makes one document per translation group, with texts per locale', async () => {
    const dir = await prepare('multilingual', LOCALIZATION)
    dirs.push(dir)
    const run = runCli(dir, importArgs())
    expect(run.status, run.output).toBe(0)
    const r = report(dir)
    expect(r.errors).toEqual([])
    expect(r.phases).toMatchObject({
      media: { created: 1, failed: 0 },
      categories: { created: 4 },
      tags: { created: 2 },
      pages: { created: 4, failed: 0 },
      posts: { created: 4, failed: 0 },
    })
    // The German draft of a published post stays out.
    expect(r.warnings.map((w) => [w.code, w.wpId])).toEqual([['TRANSLATION_DRAFT', 15]])

    const data = queryPayload<Imported>(
      dir,
      `
      const one = async (collection: string, wpId: number, locale: string) =>
        (await payload.find({ collection: collection as never, where: { wpIds: { in: [wpId] } }, depth: 1, draft: true, locale: locale as never, fallbackLocale: false as never })).docs[0] as any
      const links = (root: any) => {
        const found: string[] = []
        const walk = (n: any) => { if (n?.type === 'link') found.push(n.fields.url); (n?.children ?? []).forEach(walk) }
        walk(root)
        return found
      }
      const aboutDe = await one('pages', 4, 'de')
      const aboutEn = await one('pages', 4, 'en')
      const teamEn = await one('pages', 6, 'en')
      const benchDe = await one('posts', 11, 'de')
      const benchEn = await one('posts', 11, 'en')
      const holidayDe = await one('posts', 15, 'de')
      const holidayEn = await one('posts', 16, 'en')
      const onlyEnDe = await one('posts', 14, 'de')
      const onlyEnEn = await one('posts', 14, 'en')
      const productsEn = await one('categories', 11, 'en')
      const furnitureDe = await one('categories', 15, 'de')
      const mediaDe = await one('media', 2, 'de')
      const mediaEn = await one('media', 1, 'en')
      return {
        about: { id: aboutDe.id, wpId: aboutDe.wpId, wpIds: aboutDe.wpIds, de: [aboutDe.title, aboutDe.slug], en: [aboutEn.title, aboutEn.slug] },
        team: { parent: teamEn.parent?.id, en: [teamEn.title, teamEn.slug] },
        bench: {
          same: benchDe.id === benchEn.id,
          titles: [benchDe.title, benchEn.title],
          slugs: [benchDe.slug, benchEn.slug],
          status: benchEn._status,
          categories: benchDe.categories.map((c: any) => c.slug).sort(),
          tags: benchDe.tags.map((t: any) => t.slug).sort(),
          images: [benchDe.featuredImage?.id, benchEn.featuredImage?.id],
          linksDe: links(benchDe.content?.root),
          linksEn: links(benchEn.content?.root),
          subtitles: [benchDe.subtitle, benchEn.subtitle],
          wood: [benchDe.wood, benchEn.wood],
        },
        holiday: { status: holidayEn._status, de: holidayDe?.title ?? null, en: holidayEn.title },
        englishOnly: { de: onlyEnDe?.title ?? null, en: onlyEnEn.title },
        products: [productsEn.title, productsEn.slug],
        furniture: { title: furnitureDe.title, parent: furnitureDe.parent?.slug },
        media: { same: mediaDe.id === mediaEn.id, alt: [mediaDe.alt, mediaEn.alt] },
        redirects: (await payload.find({ collection: 'redirects', depth: 0, pagination: false, sort: 'from' })).docs
          .map((d: any) => d.from + ' ' + (d.to.type === 'reference' ? d.to.reference.relationTo : d.to.url)),
      }`,
    )
    expect(data.about).toMatchObject({
      wpId: 3,
      wpIds: [3, 4],
      de: ['Über uns', 'ueber-uns'],
      en: ['About us', 'about-us'],
    })
    expect(data.team).toEqual({ parent: data.about.id, en: ['Our team', 'our-team'] })
    expect(data.bench).toEqual({
      same: true,
      titles: ['Neue Werkbank', 'New workbench'],
      slugs: ['neue-werkbank', 'new-workbench'],
      status: 'published',
      categories: ['moebel', 'produkte'],
      tags: ['eiche', 'handwerk'],
      images: [data.bench.images[0], data.bench.images[0]],
      linksDe: ['/ueber-uns'],
      linksEn: ['/en/about-us'],
      // ACF values per language.
      subtitles: ['Aus heimischer Eiche', 'Made of local oak'],
      wood: ['eiche', 'eiche'],
    })
    expect(data.holiday).toEqual({ status: 'published', de: null, en: 'Summer break' })
    expect(data.englishOnly).toEqual({ de: null, en: 'Visit us in Vienna' })
    expect(data.products).toEqual(['Products', 'products'])
    expect(data.furniture).toEqual({ title: 'Möbel', parent: 'produkte' })
    expect(data.media).toEqual({ same: true, alt: ['Unsere Werkstatt', 'Our workshop'] })
    expect(data.redirects).toEqual(
      expect.arrayContaining([
        '/2024/02/01/neue-werkbank/ posts',
        '/en/2024/02/01/new-bench/ /en/blog/new-workbench',
        '/en/2024/02/01/new-workbench/ /en/blog/new-workbench',
        '/en/2024/03/10/summer-break/ /en/blog/summer-break',
      ]),
    )

    // A second run finds every document by its WordPress IDs.
    const again = runCli(dir, importArgs())
    expect(again.status, again.output).toBe(0)
    for (const [phase, stats] of Object.entries(report(dir).phases)) {
      expect(stats.created, phase).toBe(0)
    }
  })

  it('adds a translation that appears later to the existing document', async () => {
    // The first export lacks the English contact page.
    const xml = readFileSync(exportFile, 'utf8')
    const items = xml.split('<item>')
    const without = [
      items[0],
      ...items.slice(1).filter((i) => !i.includes('<wp:post_id>8</wp:post_id>')),
    ].join('<item>')
    const dir = await prepare('multilingual-later', LOCALIZATION)
    dirs.push(dir)
    const partial = join(dir, 'partial.xml')
    writeFileSync(partial, without)
    expect(runCli(dir, importArgs(partial)).status).toBe(0)
    expect(report(dir).phases.pages).toMatchObject({ created: 4 })
    const run = runCli(dir, importArgs())
    expect(run.status, run.output).toBe(0)
    expect(report(dir).phases.pages).toMatchObject({ created: 0 })
    const contact = queryPayload<{ count: number; en: string; wpIds: number[] }>(
      dir,
      `
      const found = await payload.find({ collection: 'pages', where: { wpIds: { in: [7] } }, locale: 'en', fallbackLocale: false as never, depth: 0 })
      return { count: found.totalDocs, en: (found.docs[0] as any).title, wpIds: (found.docs[0] as any).wpIds }`,
    )
    expect(contact).toEqual({ count: 1, en: 'Contact', wpIds: [7, 8] })
  })

  it('imports only the default language into a Payload without localization', async () => {
    const dir = await prepare('multilingual-plain', '')
    dirs.push(dir)
    const run = runCli(dir, importArgs())
    expect(run.status, run.output).toBe(0)
    const r = report(dir)
    expect(r.errors).toEqual([])
    expect(r.phases).toMatchObject({ pages: { created: 4 }, posts: { created: 3 } })
    const skipped = r.warnings.filter((w) => w.code === 'LANGUAGE_SKIPPED')
    expect(skipped.map((w) => w.message)).toEqual([
      '6 items and 5 terms in en were not imported: the Payload config has no localization.',
    ])
  })
})
