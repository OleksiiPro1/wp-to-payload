#!/usr/bin/env node
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { type Command, UsageError } from './command.js'
import { commands } from './commands.js'
import { err, fail, out, paint } from './output.js'
import { VERSION } from '../version.js'

const printGlobalHelp = (): void => {
  out(`${paint('bold', 'wp-to-payload')} ${VERSION}`)
  out('Migrate a WordPress site to Payload CMS 3 from a WXR export file.')
  out()
  out('Usage: wp-to-payload <command> [options]')
  out()
  out('Commands:')
  const width = Math.max(...commands.map((c) => c.name.length))
  for (const c of commands) out(`  ${c.name.padEnd(width)}  ${c.summary}`)
  out()
  out('Run `wp-to-payload <command> --help` for the options of a command.')
}

const printCommandHelp = (command: Command): void => {
  out(`Usage: wp-to-payload ${command.usage}`)
  out()
  out(command.summary)
  if (command.help.length > 0) {
    out()
    out('Options:')
    const width = Math.max(...command.help.map(([flag]) => flag.length))
    for (const [flag, text] of command.help) out(`  ${flag.padEnd(width)}  ${text}`)
  }
}

export const main = async (argv: string[]): Promise<number> => {
  const [name, ...rest] = argv
  if (!name || name === '--help' || name === '-h' || name === 'help') {
    printGlobalHelp()
    return 0
  }
  if (name === '--version' || name === '-v') {
    out(VERSION)
    return 0
  }
  const command = commands.find((c) => c.name === name)
  if (!command) {
    fail(`unknown command "${name}"`)
    err('Run `wp-to-payload --help` for the list of commands.')
    return 2
  }
  try {
    const { values, positionals } = parseArgs({
      args: rest,
      options: { ...command.options, help: { type: 'boolean', short: 'h' } },
      allowPositionals: true,
      strict: true,
    })
    if (values.help) {
      printCommandHelp(command)
      return 0
    }
    return await command.run({ values, positionals, cwd: process.cwd() })
  } catch (error) {
    if (
      error instanceof UsageError ||
      (error as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')
    ) {
      fail((error as Error).message)
      err(`Usage: wp-to-payload ${command.usage}`)
      return 2
    }
    fail(error instanceof Error ? error.message : String(error))
    if (process.env.DEBUG && error instanceof Error && error.stack) err(error.stack)
    return 1
  }
}

const isEntryPoint = (): boolean => {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isEntryPoint()) {
  process.exitCode = await main(process.argv.slice(2))
}
