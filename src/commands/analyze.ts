import { mkdir, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { analyzeExport } from '../analyze/analyze.js'
import { printSummary } from '../analyze/console.js'
import { renderMarkdown } from '../analyze/markdown.js'
import { AcfJsonError } from '../acf/definitions.js'
import { type Command, requireExportFile, stringOption, UsageError } from '../cli/command.js'
import { out, success } from '../cli/output.js'
import { ACF_HELP, ACF_OPTIONS, applyAcfOptions } from '../cli/shared.js'
import { DEFAULT_CONFIG } from '../config.js'

export const analyzeCommand: Command = {
  name: 'analyze',
  summary: 'Report what an export contains and how complex the migration is. Needs no Payload.',
  usage: 'analyze <export.xml> [--out <dir>] [--json] [--acf-json <path>]',
  help: [
    ['--out <dir>', 'Where to write report.json and report.md (default: wp-to-payload-report)'],
    ['--json', 'Print the JSON report to stdout instead of writing files'],
    ...ACF_HELP,
  ],
  options: {
    out: { type: 'string' },
    json: { type: 'boolean' },
    ...ACF_OPTIONS,
  },
  async run(ctx) {
    const file = resolve(ctx.cwd, requireExportFile(ctx))
    const { acfJson } = applyAcfOptions(ctx, structuredClone(DEFAULT_CONFIG))
    const report = await analyzeExport(file, { acfJson }).catch((error: unknown) => {
      throw error instanceof AcfJsonError ? new UsageError(error.message) : error
    })
    if (ctx.values.json) {
      out(JSON.stringify(report, null, 2))
      return 0
    }
    const dir = resolve(ctx.cwd, stringOption(ctx, 'out') ?? 'wp-to-payload-report')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
    await writeFile(join(dir, 'report.md'), renderMarkdown(report))
    printSummary(report)
    out()
    success(`Report written to ${relative(ctx.cwd, dir) || '.'}/report.json and report.md`)
    return 0
  },
}
