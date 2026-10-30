import type { ParseArgsConfig } from 'node:util'

export type OptionSpec = NonNullable<ParseArgsConfig['options']>

export interface CommandContext {
  positionals: string[]
  values: Record<string, string | boolean | string[] | undefined>
  cwd: string
}

export interface Command {
  name: string
  summary: string
  usage: string
  /** Help lines for options, shown by `<command> --help`. */
  help: [flag: string, description: string][]
  options: OptionSpec
  run(ctx: CommandContext): Promise<number>
}

/** Thrown for invalid usage; the CLI prints the message and exits with code 2. */
export class UsageError extends Error {
  override name = 'UsageError'
}

export const stringOption = (ctx: CommandContext, key: string): string | undefined => {
  const value = ctx.values[key]
  return typeof value === 'string' ? value : undefined
}

export const listOption = (ctx: CommandContext, key: string): string[] => {
  const value = ctx.values[key]
  if (Array.isArray(value)) return value.flatMap((v) => v.split(',')).filter(Boolean)
  if (typeof value === 'string') return value.split(',').filter(Boolean)
  return []
}

export const intOption = (ctx: CommandContext, key: string, fallback: number): number => {
  const raw = stringOption(ctx, key)
  if (raw === undefined) return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0) throw new UsageError(`--${key} expects a non-negative integer`)
  return n
}

export const requireExportFile = (ctx: CommandContext): string => {
  const file = ctx.positionals[0]
  if (!file) throw new UsageError('missing <export.xml> argument')
  return file
}
