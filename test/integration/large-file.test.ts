import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { readWxr } from '../../src/wxr/reader.js'
import { writeLargeWxr } from '../support/large-wxr.js'

const dir = join(process.cwd(), '.tmp', 'large-file')
const file = join(dir, 'large.xml')
const SIZE_MB = Number(process.env.WP2P_LARGE_MB ?? 300)

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('streaming a large export', () => {
  it(`reads a ${SIZE_MB} MB file with bounded memory`, async () => {
    mkdirSync(dir, { recursive: true })
    const expected = await writeLargeWxr(file, SIZE_MB * 1024 * 1024)
    global.gc?.()
    const baseline = process.memoryUsage().heapUsed
    let peak = 0
    let count = 0
    for await (const record of readWxr(file)) {
      if (record.kind !== 'item') continue
      count++
      if (count % 500 === 0) peak = Math.max(peak, process.memoryUsage().heapUsed - baseline)
    }
    expect(count).toBe(expected)
    // The whole file is far larger than this; only a few items are held at a time.
    expect(peak).toBeLessThan(150 * 1024 * 1024)
  })
})
