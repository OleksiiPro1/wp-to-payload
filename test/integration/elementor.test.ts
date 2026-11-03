/** Imports the site built with Elementor (scripts/fixtures) into a Payload project. */
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
  new URL('../fixtures/wxr/wordpress/elementor.xml', import.meta.url),
)

interface Report {
  phases: Record<string, { created: number; updated: number; skipped: number; failed: number }>
  errors: unknown[]
  warnings: { code: string; wpId?: number; subject?: string; message: string }[]
}

interface Page {
  nodes: string[]
  links: string[]
  text: string
}

describe.skipIf(!projectInstalled())('import of a site built with Elementor', () => {
  let dir: string
  const report = () =>
    JSON.parse(
      readFileSync(join(dir, 'wp-to-payload-report', 'import-report.json'), 'utf8'),
    ) as Report

  beforeAll(async () => {
    buildPackage()
    dir = createRun('elementor')
    const index = await buildSiteIndex(exportFile)
    for (const attachment of index.attachments.values()) {
      const path = join(dir, 'uploads', attachment.file ?? attachment.filename)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, solidPng(6, 4, [60, 140, 60]))
    }
    const scaffold = runCli(dir, ['scaffold', exportFile])
    expect(scaffold.status, scaffold.output).toBe(0)
    writePayloadConfig(dir)
  })
  afterAll(() => {
    if (!process.env.WP2P_KEEP_RUNS) rmSync(dir, { recursive: true, force: true })
  })

  it('converts Elementor widgets into rich text', () => {
    const run = runCli(dir, ['import', exportFile, '--uploads-dir', 'uploads', '--offline'])
    expect(run.status, run.output).toBe(0)
    const r = report()
    expect(r.errors).toEqual([])
    expect(r.phases).toMatchObject({
      media: { created: 4, failed: 0 },
      pages: { created: 4, failed: 0 },
      posts: { created: 2, failed: 0 },
    })
    const data = queryPayload<Record<string, Page>>(
      dir,
      `
      const page = async (collection: string, wpId: number) => {
        const doc = (await payload.find({ collection: collection as never, where: { wpId: { equals: wpId } }, depth: 0 })).docs[0] as any
        const links: string[] = []
        const texts: string[] = []
        const walk = (n: any) => {
          if (n?.type === 'link') links.push(n.fields.url)
          if (n?.type === 'text') texts.push(n.text)
          ;(n?.children ?? []).forEach(walk)
        }
        walk(doc.content?.root)
        return {
          nodes: (doc.content?.root.children ?? []).map((n: any) =>
            n.type === 'heading' ? n.tag : n.type === 'block' ? 'block:' + n.fields.blockType : n.type),
          links,
          text: texts.join(' ').replace(/\\s+/g, ' '),
        }
      }
      return { home: await page('pages', 9), spring: await page('posts', 11), about: await page('pages', 13), plain: await page('posts', 8), atomic: await page('pages', 15) }`,
    )
    // Widgets in reading order: headings, text, a button, images, a list, a gallery, a YouTube
    // embed block, a quote, accordion and tab items, a divider, HTML, an alert, an inner section.
    expect(data.home?.nodes).toEqual([
      'h1',
      'paragraph',
      'paragraph',
      'paragraph',
      'upload',
      'paragraph',
      'list',
      'upload',
      'h3',
      'paragraph',
      'h4',
      'paragraph',
      'upload',
      'upload',
      'block:embed',
      'upload',
      'quote',
      'h3',
      'paragraph',
      'h3',
      'paragraph',
      'h3',
      'paragraph',
      'h3',
      'paragraph',
      'h3',
      'paragraph',
      'horizontalrule',
      'paragraph',
      'paragraph',
      'paragraph',
      'h3',
    ])
    expect(data.home?.links).toEqual(['/kontakt', '/kontakt', '/kontakt', '/kontakt'])
    expect(data.home?.text).toContain('Unser Garten blüht wie nie. — Maria Beispiel, Kundin')
    expect(data.spring).toEqual({
      nodes: ['paragraph', 'upload'],
      links: [],
      text: 'Jetzt ist die Zeit für den Rückschnitt.',
    })
    // Broken Elementor data: the HTML Elementor stored in the content.
    expect(data.about).toEqual({
      nodes: ['h2', 'paragraph'],
      links: [],
      text: 'Über uns Eine kleine Gärtnerei.',
    })
    expect(data.plain?.nodes).toEqual(['paragraph'])
    // A page made with the elements of Elementor 4's editor.
    expect(data.atomic).toEqual({
      nodes: [
        'h2',
        'paragraph',
        'paragraph',
        'upload',
        'horizontalrule',
        'block:embed',
        'paragraph',
      ],
      links: ['/kontakt', 'https://example.org/gartenblog'],
      text: 'Unsere Leistungen Planung, Pflege und Teichbau aus einer Hand. Zum Kontakt Mehr auf unserem Blog.',
    })
    expect(r.warnings.map((w) => [w.code, w.wpId ?? null, w.subject])).toEqual([
      ['TYPE_SKIPPED', null, 'elementor_library'],
      ['BUILDER_MARKUP', 9, 'elementor'],
      ['BUILDER_WIDGET_UNKNOWN', 9, 'counter'],
      ['BUILDER_WIDGET_UNKNOWN', 9, 'google_maps'],
      ['SHORTCODE_REMOVED', 9, '[contact-form-7]'],
      ['ELEMENT_REMOVED', 9, 'script'],
      ['BUILDER_MARKUP', 11, 'elementor'],
      ['BUILDER_DATA_INVALID', 13, 'elementor'],
      ['BUILDER_MARKUP', 13, 'elementor'],
      ['BUILDER_MARKUP', 15, 'elementor'],
    ])
  })
})
