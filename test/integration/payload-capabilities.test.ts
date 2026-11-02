/**
 * Payload behaviour the import relies on, checked against the version in test/payload-project.
 * If an update of Payload changes one of these, this test says which.
 */
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRun, projectInstalled, queryPayload } from '../support/payload-project.js'

const installed = projectInstalled()

describe.skipIf(!installed)('Payload capabilities (SQLite)', () => {
  let dir: string

  beforeAll(() => {
    dir = createRun('capabilities')
    writeFileSync(
      join(dir, 'src', 'payload.config.ts'),
      `import { sqliteAdapter } from '@payloadcms/db-sqlite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildConfig } from 'payload'

const dirname = path.dirname(fileURLToPath(import.meta.url))

export default buildConfig({
  secret: 'capabilities-test-secret',
  db: sqliteAdapter({ client: { url: \`file:\${path.resolve(dirname, '../db.sqlite')}\` } }),
  localization: {
    locales: ['de', 'en'],
    defaultLocale: 'de',
    fallback: true,
  },
  collections: [
    {
      slug: 'things',
      fields: [
        { name: 'title', type: 'text', localized: true },
        { name: 'slug', type: 'text', localized: true, unique: true, index: true },
        { name: 'wpId', type: 'number', index: true },
        { name: 'wpIds', type: 'number', hasMany: true, index: true },
      ],
    },
  ],
})
`,
    )
  })

  afterAll(() => {
    if (dir && !process.env.WP2P_KEEP_RUNS) rmSync(dir, { recursive: true, force: true })
  })

  it('queries hasMany number fields and localized fields as the import needs', () => {
    const r = queryPayload<Record<string, unknown>>(
      dir,
      `
      const doc = await payload.create({
        collection: 'things',
        locale: 'de',
        data: { title: 'Hallo', slug: 'kontakt', wpId: 10, wpIds: [10, 11] },
      })
      await payload.update({ collection: 'things', id: doc.id, locale: 'en', data: { title: 'Hello', slug: 'contact' } })
      const ids = async (where: Record<string, unknown>, locale = 'de') =>
        (await payload.find({ collection: 'things', where, locale: locale as never, depth: 0 })).docs.map((d: any) => d.id)

      // Any WordPress ID of a translation group finds its document.
      const byIn = await ids({ wpIds: { in: [11, 99] } })
      const byNone = await ids({ wpIds: { in: [99] } })
      const byEquals = await ids({ wpIds: { equals: 11 } })

      // Slugs are looked up per language.
      const enSlug = await ids({ slug: { equals: 'contact' } }, 'en')
      const deSlugInEn = await ids({ slug: { equals: 'kontakt' } }, 'en')

      const all = (await payload.findByID({ collection: 'things', id: doc.id, locale: 'all' as never, depth: 0 })) as any

      // A unique localized slug: may another document use "contact" in German?
      let sameSlugOtherLocale = 'allowed'
      try {
        await payload.create({ collection: 'things', locale: 'de', data: { title: 'Kontakt 2', slug: 'contact', wpId: 20, wpIds: [20] } })
      } catch (error) {
        sameSlugOtherLocale = 'rejected'
      }
      let sameSlugSameLocale = 'allowed'
      try {
        await payload.create({ collection: 'things', locale: 'de', data: { title: 'Kontakt 3', slug: 'kontakt', wpId: 30, wpIds: [30] } })
      } catch (error) {
        sameSlugSameLocale = 'rejected'
      }

      // Without fallback, a missing translation stays empty.
      const onlyGerman = await payload.create({ collection: 'things', locale: 'de', data: { title: 'Nur Deutsch', slug: 'nur-deutsch', wpId: 40, wpIds: [40] } })
      const english = (await payload.findByID({ collection: 'things', id: onlyGerman.id, locale: 'en' as never, fallbackLocale: false as never, depth: 0 })) as any

      return {
        id: doc.id, byIn, byNone, byEquals, enSlug, deSlugInEn,
        title: all.title, slug: all.slug, wpIds: all.wpIds,
        sameSlugOtherLocale, sameSlugSameLocale, englishTitle: english.title ?? null,
      }`,
    )
    expect(r.byIn).toEqual([r.id])
    expect(r.byNone).toEqual([])
    expect(r.byEquals).toEqual([r.id])
    expect(r.enSlug).toEqual([r.id])
    expect(r.deSlugInEn).toEqual([])
    expect(r.title).toEqual({ de: 'Hallo', en: 'Hello' })
    expect(r.slug).toEqual({ de: 'kontakt', en: 'contact' })
    expect(r.wpIds).toEqual([10, 11])
    // Uniqueness of a localized field is per language.
    expect(r.sameSlugOtherLocale).toBe('allowed')
    expect(r.sameSlugSameLocale).toBe('rejected')
    expect(r.englishTitle).toBeNull()
  })
})
