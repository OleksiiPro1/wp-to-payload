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
