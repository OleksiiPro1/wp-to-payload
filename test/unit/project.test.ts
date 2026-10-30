import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findPackageDir, resolveFromProject } from '../../src/import/project.js'

const fakePackage = (root: string, name: string, pkg: object) => {
  const dir = join(root, 'node_modules', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, ...pkg }))
  return dir
}

describe('resolveFromProject', () => {
  it('finds packages in parent directories and resolves export conditions', () => {
    const root = mkdtempSync(join(tmpdir(), 'wp2p-project-'))
    const dir = fakePackage(root, 'payload', {
      exports: {
        '.': { types: './dist/index.d.ts', import: './dist/index.js' },
        './node': { import: { types: './x.d.ts', default: './dist/node.js' } },
      },
    })
    const scoped = fakePackage(root, '@payloadcms/richtext-lexical', { exports: './dist/main.js' })
    const nested = join(root, 'apps', 'web')
    mkdirSync(nested, { recursive: true })
    expect(findPackageDir('payload', nested)).toBe(dir)
    expect(resolveFromProject('payload', nested)).toBe(join(dir, 'dist/index.js'))
    expect(resolveFromProject('payload/node', nested)).toBe(join(dir, 'dist/node.js'))
    expect(resolveFromProject('@payloadcms/richtext-lexical', nested)).toBe(
      join(scoped, 'dist/main.js'),
    )
    expect(() => resolveFromProject('payload/missing', nested)).toThrow(/not exported/)
    expect(() => resolveFromProject('nope', nested)).toThrow(/cannot find "nope"/)
  })
})
