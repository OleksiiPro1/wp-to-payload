/** Imports the site with Secure Custom Fields (scripts/fixtures) into scaffolded collections. */
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
  new URL('../fixtures/wxr/wordpress/custom-fields.xml', import.meta.url),
)
const acfJson = fileURLToPath(new URL('../../scripts/fixtures/acf-json', import.meta.url))

interface Report {
  phases: Record<string, { created: number; updated: number; skipped: number; failed: number }>
  errors: unknown[]
  warnings: { code: string; wpId?: number; subject?: string; message: string }[]
}

interface Imported {
  rye: {
    plain: Record<string, unknown>
    media: { hero?: number; pdf?: number; pdfType?: string; photos: number[] }
    relations: { post?: number; page?: number; recipes: number[]; categories: string[] }
    moreInfo: unknown
    nutrition: unknown
    ingredients: unknown
    sections: unknown[]
    instructions: { links: string[]; uploads: number }
    absent: string[]
  }
  cake: Record<string, unknown>
  book: Record<string, unknown>
  bread: { color?: string; icon?: number }
}

const report = (dir: string) =>
  JSON.parse(
    readFileSync(join(dir, 'wp-to-payload-report', 'import-report.json'), 'utf8'),
  ) as Report

describe.skipIf(!projectInstalled())('import of ACF fields', () => {
  let dir: string
  beforeAll(async () => {
    buildPackage()
    dir = createRun('custom-fields')
    const index = await buildSiteIndex(exportFile)
    for (const attachment of index.attachments.values()) {
      const path = join(dir, 'uploads', attachment.file ?? attachment.filename)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(
        path,
        attachment.mimeType === 'application/pdf'
          ? '%PDF-1.4\n% made-up recipe sheet\n'
          : solidPng(6, 4, [150, 110, 70]),
      )
    }
    const scaffold = runCli(dir, ['scaffold', exportFile, '--acf-json', acfJson])
    expect(scaffold.status, scaffold.output).toBe(0)
    writePayloadConfig(dir, '', ['posts', 'pages', 'recipes'])
  })
  afterAll(() => {
    if (!process.env.WP2P_KEEP_RUNS) rmSync(dir, { recursive: true, force: true })
  })

  const importArgs = (...extra: string[]) => [
    'import',
    exportFile,
    '--uploads-dir',
    'uploads',
    '--offline',
    '--time-zone',
    'Europe/Vienna',
    ...extra,
  ]

  it('fills every supported field type, and reports the others', () => {
    const run = runCli(dir, importArgs('--acf-json', acfJson))
    expect(run.status, run.output).toBe(0)
    const r = report(dir)
    expect(r.errors).toEqual([])
    expect(r.phases).toMatchObject({
      media: { created: 4, failed: 0 },
      categories: { created: 3 },
      posts: { created: 1 },
      pages: { created: 1 },
      recipes: { created: 2, failed: 0 },
    })
    const acfWarnings = r.warnings
      .filter((w) => w.code.startsWith('ACF_'))
      .map((w) => `${w.code} ${w.subject}`)
      .sort()
    expect(acfWarnings).toEqual([
      'ACF_FIELD_RENAMED recipes.excerpt',
      'ACF_FIELD_SKIPPED recipes.Grundlagen',
      'ACF_FIELD_SKIPPED recipes.Hinweis',
      'ACF_FIELD_SKIPPED recipes.chef',
      'ACF_FIELD_SKIPPED recipes.location',
      'ACF_FIELD_SKIPPED recipes.secret_code',
      'ACF_FIELD_SKIPPED recipes.title_clone',
    ])
    expect(r.warnings.filter((w) => w.code === 'REFERENCE_MISSING')).toEqual([])

    const data = queryPayload<Imported>(
      dir,
      `
      const find = async (collection: string, wpId: number) =>
        (await payload.find({ collection: collection as never, where: { wpId: { equals: wpId } }, depth: 1, draft: true })).docs[0] as any
      const nodes = (root: any, type: string) => {
        const found: any[] = []
        const walk = (n: any) => { if (n?.type === type) found.push(n); (n?.children ?? []).forEach(walk) }
        walk(root)
        return found
      }
      const text = (state: any) => nodes(state?.root, 'text').map((n) => n.text).join('')
      const rye = await find('recipes', 51)
      const cake = await find('recipes', 52)
      const book = await find('posts', 6)
      const bread = await find('categories', 2)
      const pick = (doc: any, keys: string[]) => Object.fromEntries(keys.map((k) => [k, doc[k]]))
      return {
        rye: {
          plain: pick(rye, ['subtitle', 'notes', 'baking_time', 'contact_email', 'source_url', 'difficulty', 'diets', 'oven', 'seasonal', 'published_on', 'next_course', 'acf_excerpt', 'excerpt', 'origin', 'region']),
          media: { hero: rye.hero?.wpId, pdf: rye.recipe_pdf?.wpId, pdfType: rye.recipe_pdf?.mimeType, photos: rye.photos.map((p: any) => p.wpId) },
          relations: {
            post: rye.related_post?.wpId,
            page: rye.about_page?.wpId,
            recipes: rye.related_recipes.map((x: any) => x.wpId),
            categories: rye.recipe_categories.map((c: any) => c.slug),
          },
          moreInfo: rye.more_info,
          nutrition: rye.nutrition,
          ingredients: rye.ingredients.map((row: any) => ({ amount: row.amount, ingredient: row.ingredient })),
          sections: rye.sections.map((b: any) => (b.blockType === 'quote' ? [b.blockType, b.quote, b.author] : [b.blockType, text(b.text)])),
          instructions: {
            links: nodes(rye.instructions?.root, 'link').map((n) => n.fields.url),
            uploads: nodes(rye.instructions?.root, 'upload').length,
          },
          absent: ['location', 'chef', 'secret_code', 'title_clone', 'title_clone_subtitle'].filter((k) => rye[k] !== undefined),
        },
        cake: pick(cake, ['subtitle', 'ingredients', 'seasonal', 'baking_time']),
        book: pick(book, ['subtitle', 'reading_time']),
        bread: { color: bread.color, icon: bread.icon?.wpId },
      }`,
    )
    expect(data.rye.plain).toEqual({
      subtitle: 'Mit Sauerteig',
      notes: 'Über Nacht gehen lassen.\nMorgens backen.',
      baking_time: 55,
      contact_email: 'kurse@example.com',
      source_url: 'https://example.org/roggen',
      difficulty: 'medium',
      diets: ['vegan', 'vegetarisch'],
      oven: 'umluft',
      seasonal: true,
      published_on: '2024-03-01T12:00:00.000Z',
      // 18:00 in Vienna, summer time.
      next_course: '2024-05-01T16:00:00.000Z',
      acf_excerpt: 'Ein Brot für jeden Tag.',
      excerpt: null,
      origin: 'Waldviertel',
      region: 'nord',
    })
    expect(data.rye.media).toEqual({
      hero: 1,
      pdf: 4,
      pdfType: 'application/pdf',
      photos: [2, 3],
    })
    // The related recipe comes after this one in the export; it is set once it exists.
    expect(data.rye.relations).toEqual({ post: 6, page: 5, recipes: [52], categories: ['brot'] })
    expect(data.rye.moreInfo).toEqual({
      label: 'Roggen im Lexikon',
      url: 'https://example.org/lexikon/roggen',
      newTab: true,
    })
    expect(data.rye.nutrition).toEqual({ calories: 240, allergens: ['gluten'] })
    expect(data.rye.ingredients).toEqual([
      { amount: '500 g', ingredient: 'Roggenmehl' },
      { amount: '350 ml', ingredient: 'Wasser' },
    ])
    expect(data.rye.sections).toEqual([
      ['text_block', 'Der Sauerteig braucht Zeit.'],
      ['quote', 'Brot ist Geduld.', 'Anna'],
    ])
    // The link to the post points to its new path, the image became an upload node.
    expect(data.rye.instructions).toEqual({ links: ['/posts/unser-rezeptbuch'], uploads: 1 })
    expect(data.rye.absent).toEqual([])
    expect(data.cake).toMatchObject({
      subtitle: 'Für den Sonntag',
      ingredients: [],
      seasonal: false,
    })
    expect(data.book).toEqual({ subtitle: 'Neu im Shop', reading_time: 3 })
    expect(data.bread).toEqual({ color: '#c08040', icon: 3 })

    // A second run finds every document again.
    const again = runCli(dir, importArgs('--acf-json', acfJson))
    expect(again.status, again.output).toBe(0)
    for (const [phase, stats] of Object.entries(report(dir).phases)) {
      expect(stats.created, phase).toBe(0)
    }
  })

  it('names the fields whose definitions are missing without --acf-json', () => {
    const run = runCli(dir, importArgs())
    expect(run.status, run.output).toBe(0)
    const unknown = report(dir).warnings.filter((w) => w.code === 'ACF_FIELD_UNKNOWN')
    expect(unknown.map((w) => w.message)).toEqual([
      "Items of recipe have values of ACF fields that are not defined in the export: origin (field_local_origin), region (field_local_region). They were not imported; pass the field groups with --acf-json (a theme's acf-json folder or an ACF export).",
    ])
    // What an earlier run imported stays.
    const rye = queryPayload<{ origin: string }>(
      dir,
      `return (await payload.find({ collection: 'recipes', where: { wpId: { equals: 51 } }, depth: 0 })).docs[0] as any`,
    )
    expect(rye.origin).toBe('Waldviertel')
  })
})
