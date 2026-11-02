import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type Command,
  intOption,
  listOption,
  requireExportFile,
  stringOption,
  UsageError,
} from '../cli/command.js'
import { fail, info, out, warn } from '../cli/output.js'
import { configFromOptions, PATH_HELP, PATH_OPTIONS } from '../cli/shared.js'
import { type Phase, PHASES } from '../import/phases.js'
import { findPackageDir } from '../import/project.js'
import { OPTIONS_ENV, type RunnerOptions, type RunnerResult } from '../import/runner-options.js'

export const importCommand: Command = {
  name: 'import',
  summary: 'Import the export into the Payload project in the current directory (Local API).',
  usage: 'import <export.xml> [--uploads-dir <dir>] [--dry-run] [options]',
  help: [
    ['--uploads-dir <dir>', 'Local copy of wp-content/uploads; files there are not downloaded'],
    ['--offline', 'Never download media; use only --uploads-dir'],
    ['--dry-run', 'Check everything and report what would change, without writing'],
    [
      '--only <list>',
      `Run only these steps: ${PHASES.join(', ')}, or the collection of a custom post type or taxonomy`,
    ],
    ['--write-redirects', 'Also write redirects into the @payloadcms/plugin-redirects collection'],
    ['--limit <n>', 'Import at most n items of each post type (for a first test)'],
    ['--concurrency <n>', 'Parallel media downloads (default: 4)'],
    ['--refresh-media', 'Upload media files again even if they were imported before'],
    ['--media-host <host>', 'Another host media may be downloaded from (CDN); repeatable'],
    ['--max-media-mb <n>', 'Skip media files larger than this (default: 100)'],
    [
      '--report-dir <dir>',
      'Where to write import-report.json and .md (default: wp-to-payload-report)',
    ],
    ...PATH_HELP,
  ],
  options: {
    'uploads-dir': { type: 'string' },
    offline: { type: 'boolean' },
    'dry-run': { type: 'boolean' },
    only: { type: 'string', multiple: true },
    'write-redirects': { type: 'boolean' },
    limit: { type: 'string' },
    concurrency: { type: 'string' },
    'refresh-media': { type: 'boolean' },
    'media-host': { type: 'string', multiple: true },
    'max-media-mb': { type: 'string' },
    'report-dir': { type: 'string' },
    ...PATH_OPTIONS,
  },
  async run(ctx) {
    const file = resolve(ctx.cwd, requireExportFile(ctx))
    if (!existsSync(file)) throw new UsageError(`${file} does not exist`)
    // Steps of custom types depend on the export; the import checks them against it.
    const only = listOption(ctx, 'only')
    for (const phase of only) {
      if (!/^[a-z0-9][a-z0-9_-]*$/.test(phase)) {
        throw new UsageError(`"${phase}" is not a step for --only (known: ${PHASES.join(', ')})`)
      }
    }
    const uploadsDir = stringOption(ctx, 'uploads-dir')
    if (uploadsDir && !existsSync(resolve(ctx.cwd, uploadsDir))) {
      throw new UsageError(`--uploads-dir ${uploadsDir} does not exist`)
    }
    const config = await configFromOptions(ctx)

    const payloadDir = findPackageDir('payload', ctx.cwd)
    if (!payloadDir) {
      fail('Payload is not installed here. Run this command in the root of your Payload 3 project.')
      return 2
    }
    // Payload 3 projects are ES modules. Without "type": "module", tsx compiles the config as
    // CommonJS and Payload gets loaded twice, which fails with obscure errors.
    const projectPackage = join(ctx.cwd, 'package.json')
    if (existsSync(projectPackage)) {
      try {
        const pkg = JSON.parse(await readFile(projectPackage, 'utf8')) as { type?: string }
        if (pkg.type !== 'module') {
          warn(
            'package.json has no "type": "module". Payload 3 projects are ES modules; add it if the import fails.',
          )
        }
      } catch {
        // An unreadable package.json is Payload's problem to report.
      }
    }
    const runner = fileURLToPath(new URL('../import/runner.js', import.meta.url))
    const temp = await mkdtemp(join(tmpdir(), 'wp-to-payload-'))
    const limit = stringOption(ctx, 'limit') === undefined ? undefined : intOption(ctx, 'limit', 0)
    const options: RunnerOptions = {
      file,
      config,
      ...(uploadsDir ? { uploadsDir: resolve(ctx.cwd, uploadsDir) } : {}),
      offline: ctx.values.offline === true,
      dryRun: ctx.values['dry-run'] === true,
      only: only as Phase[],
      writeRedirects: ctx.values['write-redirects'] === true,
      ...(limit === undefined ? {} : { limit }),
      concurrency: Math.max(1, intOption(ctx, 'concurrency', 4)),
      refreshMedia: ctx.values['refresh-media'] === true,
      mediaHosts: listOption(ctx, 'media-host'),
      maxMediaBytes: intOption(ctx, 'max-media-mb', 100) * 1024 * 1024,
      resultFile: join(temp, 'result.json'),
      reportDir: resolve(ctx.cwd, stringOption(ctx, 'report-dir') ?? 'wp-to-payload-report'),
    }

    info(
      `Starting Payload (${relative(ctx.cwd, payloadDir) || payloadDir})${options.dryRun ? ' for a dry run' : ''}…`,
    )
    const exitCode = await new Promise<number | null>((done, reject) => {
      const child = spawn(process.execPath, [join(payloadDir, 'bin.js'), 'run', runner], {
        cwd: ctx.cwd,
        stdio: 'inherit',
        env: { ...process.env, [OPTIONS_ENV]: JSON.stringify(options) },
      })
      child.on('error', reject)
      child.on('close', done)
    })

    let result: RunnerResult | undefined
    try {
      result = JSON.parse(await readFile(options.resultFile, 'utf8')) as RunnerResult
    } catch {
      result = undefined
    } finally {
      await rm(temp, { recursive: true, force: true })
    }
    if (!result) {
      fail(
        `The Payload process stopped before the import finished (exit code ${exitCode ?? 'unknown'}).`,
      )
      return 1
    }
    if (result.fatal) {
      fail(result.fatal)
      return result.setupError ? 2 : 1
    }
    out()
    out(`Report: ${result.reportFiles.map((p) => relative(ctx.cwd, p)).join(', ')}`)
    return result.ok ? 0 : 1
  },
}
