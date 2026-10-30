/**
 * Runs inside the user's Payload project through `payload run`, which loads `.env`, compiles the
 * TypeScript config and prepares Lexical. Started by `wp-to-payload import`; not meant to be run
 * directly.
 */
import { writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { importExport, ImportSetupError } from './importer.js'
import type { LexicalModule, PayloadLike } from './payload-types.js'
import { importFromProject } from './project.js'
import { summaryLines, writeImportReport } from './report.js'
import { OPTIONS_ENV, type RunnerOptions, type RunnerResult } from './runner-options.js'

const log = (line: string) => process.stdout.write(`${line}\n`)

const run = async (): Promise<void> => {
  const raw = process.env[OPTIONS_ENV]
  if (!raw)
    throw new Error(`${OPTIONS_ENV} is not set; start the import with \`wp-to-payload import\``)
  const options = JSON.parse(raw) as RunnerOptions
  const output: RunnerResult = { ok: false, failed: 0, reportFiles: [] }
  let payload: PayloadLike | undefined
  try {
    const cwd = process.cwd()
    const { findConfig } = await importFromProject<{ findConfig: () => string }>(
      'payload/node',
      cwd,
    )
    const { getPayload } = await importFromProject<{
      getPayload: (args: { config: unknown }) => Promise<PayloadLike>
    }>('payload', cwd)
    const lexical = await importFromProject<LexicalModule>('@payloadcms/richtext-lexical', cwd)
    const configPath = findConfig()
    log(`Payload config: ${configPath}`)
    const mod = (await import(pathToFileURL(configPath).href)) as { default?: unknown }
    payload = await getPayload({ config: await (mod.default ?? mod) })
    const result = await importExport(payload, lexical, { ...options, log })
    output.reportFiles = await writeImportReport(result, options.reportDir)
    log('')
    for (const line of summaryLines(result)) log(line)
    output.failed = result.errors.length
    output.ok = result.errors.length === 0
  } catch (error) {
    output.fatal = error instanceof Error ? error.message : String(error)
    output.setupError = error instanceof ImportSetupError
    if (process.env.DEBUG && error instanceof Error && error.stack) log(error.stack)
  } finally {
    await writeFile(options.resultFile, JSON.stringify(output))
    await payload?.destroy?.().catch(() => undefined)
  }
}

await run()
