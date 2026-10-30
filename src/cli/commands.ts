import { analyzeCommand } from '../commands/analyze.js'
import { redirectsCommand } from '../commands/redirects.js'
import type { Command } from './command.js'

export const commands: Command[] = [analyzeCommand, redirectsCommand]
