import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { summarizeWarnings } from '../report/warnings.js'
import { VERSION } from '../version.js'
import type { ImportResult } from './importer.js'
import { PHASES } from './phases.js'

const LABELS = {
  media: 'Media',
  categories: 'Categories',
  tags: 'Tags',
  authors: 'Authors',
  posts: 'Posts',
  pages: 'Pages',
  redirects: 'Redirects',
} as const

export const summaryLines = (result: ImportResult): string[] => {
  const lines: string[] = []
  lines.push(
    result.dryRun
      ? 'Dry run: nothing was written. This is what an import would do:'
      : 'Import finished:',
  )
  const width = Math.max(...Object.values(LABELS).map((l) => l.length))
  for (const phase of PHASES) {
    const s = result.phases[phase]
    if (s.created + s.updated + s.skipped + s.failed === 0) continue
    const parts = [
      `${s.created} ${result.dryRun ? 'to create' : 'created'}`,
      `${s.updated} ${result.dryRun ? 'to update' : 'updated'}`,
    ]
    if (s.skipped > 0) parts.push(`${s.skipped} skipped`)
    if (s.failed > 0) parts.push(`${s.failed} failed`)
    lines.push(`  ${LABELS[phase].padEnd(width)}  ${parts.join(', ')}`)
  }
  const summary = summarizeWarnings(result.warnings)
  if (summary.length > 0) {
    lines.push('', `Warnings (${result.warnings.length}):`)
    for (const { code, count } of summary) lines.push(`  ${code.padEnd(18)} ${count}`)
  }
  if (result.errors.length > 0) {
    lines.push('', `Errors (${result.errors.length}):`)
    for (const e of result.errors.slice(0, 20)) {
      lines.push(`  ${e.phase}${e.wpId === undefined ? '' : ` #${e.wpId}`}: ${e.message}`)
    }
    if (result.errors.length > 20)
      lines.push(`  … and ${result.errors.length - 20} more in the report`)
  }
  lines.push('', `Took ${(result.durationMs / 1000).toFixed(1)} s.`)
  return lines
}

const markdown = (result: ImportResult): string => {
  const lines = [
    `# Import report`,
    '',
    `wp-to-payload ${VERSION}${result.dryRun ? ' (dry run)' : ''}`,
    '',
  ]
  lines.push(
    '| Collection | Created | Updated | Skipped | Failed |',
    '| --- | --- | --- | --- | --- |',
  )
  for (const phase of PHASES) {
    const s = result.phases[phase]
    lines.push(`| ${LABELS[phase]} | ${s.created} | ${s.updated} | ${s.skipped} | ${s.failed} |`)
  }
  if (result.errors.length > 0) {
    lines.push('', '## Errors', '')
    for (const e of result.errors)
      lines.push(`- ${e.phase}${e.wpId === undefined ? '' : ` #${e.wpId}`}: ${e.message}`)
  }
  if (result.warnings.length > 0) {
    lines.push('', '## Warnings', '')
    for (const { code, count } of summarizeWarnings(result.warnings)) {
      lines.push(`### ${code} (${count})`, '')
      for (const w of result.warnings.filter((x) => x.code === code).slice(0, 200)) {
        const where = w.wpId === undefined ? '' : `${w.wpType ?? 'item'} ${w.wpId}: `
        lines.push(`- ${where}${w.message.replace(/\n/g, ' ')}`)
      }
      if (count > 200) lines.push(`- … ${count - 200} more in import-report.json`)
      lines.push('')
    }
  }
  return `${lines.join('\n').trimEnd()}\n`
}

export const writeImportReport = async (result: ImportResult, dir: string): Promise<string[]> => {
  await mkdir(dir, { recursive: true })
  const json = join(dir, 'import-report.json')
  const md = join(dir, 'import-report.md')
  await writeFile(
    json,
    `${JSON.stringify({ tool: { name: 'wp-to-payload', version: VERSION }, ...result }, null, 2)}\n`,
  )
  await writeFile(md, markdown(result))
  return [json, md]
}
