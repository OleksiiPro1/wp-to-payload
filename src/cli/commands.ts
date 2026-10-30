import { analyzeCommand } from '../commands/analyze.js'
import { importCommand } from '../commands/import.js'
import { redirectsCommand } from '../commands/redirects.js'
import { scaffoldCommand } from '../commands/scaffold.js'
import type { Command } from './command.js'

export const commands: Command[] = [
  analyzeCommand,
  scaffoldCommand,
  importCommand,
  redirectsCommand,
]
