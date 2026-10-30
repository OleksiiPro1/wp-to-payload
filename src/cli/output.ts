import { styleText } from 'node:util'

type Style = Parameters<typeof styleText>[0]

const useColor = (stream: NodeJS.WriteStream): boolean =>
  stream.isTTY === true && !('NO_COLOR' in process.env) && process.env.TERM !== 'dumb'

export const paint = (style: Style, text: string, stream: NodeJS.WriteStream = process.stdout) =>
  useColor(stream) ? styleText(style, text, { validateStream: false }) : text

export const out = (line = ''): void => {
  process.stdout.write(`${line}\n`)
}

export const err = (line = ''): void => {
  process.stderr.write(`${line}\n`)
}

export const heading = (text: string): void => out(paint('bold', text))
export const info = (text: string): void => out(`${paint('cyan', 'i')} ${text}`)
export const success = (text: string): void => out(`${paint('green', '✓')} ${text}`)
export const warn = (text: string): void => err(`${paint('yellow', '!', process.stderr)} ${text}`)
export const fail = (text: string): void => err(`${paint('red', '✗', process.stderr)} ${text}`)

/** Left-aligned two-column table for console summaries. */
export const table = (rows: [string, string | number][], indent = 2): void => {
  const width = Math.max(0, ...rows.map(([k]) => k.length))
  for (const [key, value] of rows) out(`${' '.repeat(indent)}${key.padEnd(width)}  ${value}`)
}
