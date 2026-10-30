/**
 * Runs analyze, redirects and import on the official WordPress Theme Unit Test data. The file is
 * downloaded to the system temp directory for each run and never stored in this repository (it
 * is licensed under the GPL). Skipped when the network does not allow the download.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { analyzeExport } from '../../src/analyze/analyze.js'
import { SiteUrls } from '../../src/paths/site-urls.js'
import { buildRedirects } from '../../src/redirects/build.js'
import { FORMATS, formatRedirects } from '../../src/redirects/formats.js'
import { buildSiteIndex } from '../../src/wxr/site-index.js'
import {
  buildPackage,
  createRun,
  projectInstalled,
  runCliAsync,
  writePayloadConfig,
} from '../support/payload-project.js'

const SOURCE =
  process.env.WP2P_THEME_UNIT_TEST_URL ??
  'https://raw.githubusercontent.com/WordPress/theme-test-data/master/themeunittestdata.wordpress.xml'

const tempDir = mkdtempSync(join(tmpdir(), 'wp2p-theme-unit-test-'))
const file = join(tempDir, 'themeunittestdata.wordpress.xml')

const download = async (): Promise<boolean> => {
  try {
    const response = await fetch(SOURCE, { signal: AbortSignal.timeout(60_000) })
    if (!response.ok) return false
    writeFileSync(file, Buffer.from(await response.arrayBuffer()))
    return true
  } catch {
    return false
  }
}

const available = await download()
if (!available) console.warn(`Skipping: could not download ${SOURCE}`)

afterAll(() => rmSync(tempDir, { recursive: true, force: true }))

describe.skipIf(!available)('WordPress Theme Unit Test data', () => {
  it('analyzes the export', async () => {
    const report = await analyzeExport(file)
    expect(report.issues).toEqual([])
    expect(report.counts.posts.total).toBeGreaterThan(40)
    expect(report.counts.pages.total).toBeGreaterThan(10)
    expect(report.counts.attachments).toBeGreaterThan(20)
    expect(report.counts.categories).toBeGreaterThan(20)
    expect(report.content.shortcodes.map((s) => s.name)).toContain('caption')
    // Every block the export uses has a defined handling except plugin blocks.
    const unknownCore = report.content.blocks.filter(
      (b) => b.support === 'unknown' && b.name.startsWith('core/'),
    )
    expect(unknownCore).toEqual([])
  })

  it('writes redirects in every format', async () => {
    const index = await buildSiteIndex(file)
    const urls = new SiteUrls(index, { patterns: { post: '/blog/:slug', page: '/:path' } })
    const { redirects } = buildRedirects(index, urls)
    expect(redirects.length).toBeGreaterThan(40)
    for (const format of FORMATS)
      expect(formatRedirects(format, redirects).length).toBeGreaterThan(100)
  })

  describe.skipIf(!projectInstalled())('import', () => {
    let dir: string

    beforeAll(() => {
      buildPackage()
      dir = createRun('theme-unit-test')
    })

    afterAll(() => {
      if (dir && !process.env.WP2P_KEEP_RUNS) rmSync(dir, { recursive: true, force: true })
    })

    const args = () => [
      'import',
      file,
      '--media-host',
      'wpthemetestdata.files.wordpress.com',
      '--page-path',
      '/:path',
      '--write-redirects',
    ]
    const report = () =>
      JSON.parse(readFileSync(join(dir, 'wp-to-payload-report', 'import-report.json'), 'utf8')) as {
        phases: Record<string, { created: number; updated: number; failed: number }>
        errors: unknown[]
      }

    it('imports every post and page without errors', async () => {
      expect((await runCliAsync(dir, ['scaffold'])).status).toBe(0)
      writePayloadConfig(dir)
      const run = await runCliAsync(dir, args())
      expect(run.status, run.output).toBe(0)
      const r = report()
      expect(r.errors).toEqual([])
      expect(r.phases.posts?.created).toBeGreaterThan(40)
      expect(r.phases.pages?.created).toBeGreaterThan(10)
      // Media may be blocked by the network; that is reported but is not an error.
    })

    it('updates everything on a second run', async () => {
      const run = await runCliAsync(dir, args())
      expect(run.status, run.output).toBe(0)
      const r = report()
      expect(r.phases.posts?.created).toBe(0)
      expect(r.phases.pages?.created).toBe(0)
      expect(r.phases.categories?.created).toBe(0)
    })
  })
})
