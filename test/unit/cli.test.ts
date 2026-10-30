import { describe, expect, it, vi } from 'vitest'
import { main } from '../../src/cli/index.js'

const capture = async (argv: string[]) => {
  const chunks: string[] = []
  const spyOut = vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    chunks.push(String(c))
    return true
  })
  const spyErr = vi.spyOn(process.stderr, 'write').mockImplementation((c) => {
    chunks.push(String(c))
    return true
  })
  try {
    const code = await main(argv)
    return { code, text: chunks.join('') }
  } finally {
    spyOut.mockRestore()
    spyErr.mockRestore()
  }
}

describe('cli', () => {
  it('prints global help', async () => {
    const { code, text } = await capture(['--help'])
    expect(code).toBe(0)
    expect(text).toContain('Usage: wp-to-payload <command>')
  })

  it('rejects unknown commands with exit code 2', async () => {
    const { code, text } = await capture(['nope'])
    expect(code).toBe(2)
    expect(text).toContain('unknown command "nope"')
  })
})

describe('cli commands', () => {
  it('analyze writes report.json and report.md', async () => {
    const { mkdtempSync, readFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { fixture } = await import('../helpers.js')
    const dir = mkdtempSync(join(tmpdir(), 'wp2p-cli-'))
    const { code } = await capture(['analyze', fixture('blog-gutenberg.xml'), '--out', dir])
    expect(code).toBe(0)
    expect(JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')).counts.posts.total).toBe(4)
    expect(readFileSync(join(dir, 'report.md'), 'utf8')).toContain('# WordPress export analysis')
  })

  it('redirects writes one file per format', async () => {
    const { mkdtempSync, readFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { fixture } = await import('../helpers.js')
    const dir = mkdtempSync(join(tmpdir(), 'wp2p-cli-'))
    const { code } = await capture([
      'redirects',
      fixture('blog-gutenberg.xml'),
      '--format',
      'csv,netlify',
      '--post-path',
      '/blog/:slug',
      '--out',
      dir,
    ])
    expect(code).toBe(0)
    const csv = readFileSync(join(dir, 'redirects.csv'), 'utf8')
    expect(csv).toContain('/2024/02/01/bakery-news/,/blog/bakery-news,301')
    // A custom post type gets a default path.
    expect(csv).toContain('/recipe/rye-bread/,/recipes/rye-bread,301')
    expect(readFileSync(join(dir, '_redirects'), 'utf8')).toContain('/blog/bakery-news 301')
  })

  it('rejects unknown formats and bad patterns with exit code 2', async () => {
    const { fixture } = await import('../helpers.js')
    expect(
      (await capture(['redirects', fixture('blog-gutenberg.xml'), '--format', 'iis'])).code,
    ).toBe(2)
    expect(
      (await capture(['redirects', fixture('blog-gutenberg.xml'), '--post-path', 'x'])).code,
    ).toBe(2)
  })
})
