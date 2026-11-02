import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('warning codes', () => {
  it('are all documented in docs/warnings.md', () => {
    const codes = [...read('../../src/report/warnings.ts').matchAll(/^\s+\| '([A-Z_]+)'$/gm)].map(
      (m) => m[1],
    )
    expect(codes.length).toBeGreaterThan(30)
    const docs = read('../../docs/warnings.md')
    expect(codes.filter((code) => !docs.includes(`| \`${code}\``))).toEqual([])
  })
})
