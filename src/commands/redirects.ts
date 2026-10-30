import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import {
  type Command,
  type CommandContext,
  listOption,
  requireExportFile,
  stringOption,
  UsageError,
} from '../cli/command.js'
import { out, success, warn } from '../cli/output.js'
import { configFromOptions, PATH_HELP, PATH_OPTIONS } from '../cli/shared.js'
import { SiteUrls } from '../paths/site-urls.js'
import { buildRedirects } from '../redirects/build.js'
import { FILE_NAMES, FORMATS, formatRedirects, type RedirectFormat } from '../redirects/formats.js'
import { buildSiteIndex } from '../wxr/site-index.js'

export const redirectsCommand: Command = {
  name: 'redirects',
  summary:
    'Write a map from old WordPress URLs to new URLs (CSV, JSON, Next.js, Apache, nginx, Netlify).',
  usage: 'redirects <export.xml> [--format <list>] [--out <path>] [path options]',
  help: [
    ['--format <list>', `Comma-separated formats: ${FORMATS.join(', ')} (default: csv)`],
    [
      '--out <path>',
      'File for one format, directory for several (default: print one format to stdout)',
    ],
    ...PATH_HELP,
    [
      '--to-payload',
      'Write into the @payloadcms/plugin-redirects collection of the Payload project here',
    ],
  ],
  options: {
    format: { type: 'string', multiple: true },
    out: { type: 'string' },
    'to-payload': { type: 'boolean' },
    ...PATH_OPTIONS,
  },
  async run(ctx) {
    if (ctx.values['to-payload']) {
      // Same as `import --only redirects`: runs in the Payload project and writes into the
      // plugin's collection, pointing to the imported documents.
      const { importCommand } = await import('./import.js')
      const values: CommandContext['values'] = { ...ctx.values, only: ['redirects'] }
      delete values.format
      delete values.out
      delete values['to-payload']
      return importCommand.run({ ...ctx, values })
    }
    const file = resolve(ctx.cwd, requireExportFile(ctx))
    const formats = listOption(ctx, 'format')
    if (formats.length === 0) formats.push('csv')
    for (const f of formats) {
      if (!(FORMATS as readonly string[]).includes(f)) {
        throw new UsageError(`unknown format "${f}" (known: ${FORMATS.join(', ')})`)
      }
    }
    const config = await configFromOptions(ctx)
    const index = await buildSiteIndex(file)
    const urls = new SiteUrls(index, { patterns: config.paths, extraHosts: config.siteHosts })
    const { redirects, warnings } = buildRedirects(index, urls)
    for (const w of warnings) warn(w.message)

    const outPath = stringOption(ctx, 'out')
    if (!outPath && formats.length === 1) {
      process.stdout.write(formatRedirects(formats[0] as RedirectFormat, redirects))
      return 0
    }
    const target = resolve(ctx.cwd, outPath ?? 'wp-to-payload-redirects')
    const written: string[] = []
    if (formats.length === 1 && outPath && !outPath.endsWith('/')) {
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, formatRedirects(formats[0] as RedirectFormat, redirects))
      written.push(target)
    } else {
      await mkdir(target, { recursive: true })
      for (const f of formats as RedirectFormat[]) {
        const path = join(target, FILE_NAMES[f])
        await writeFile(path, formatRedirects(f, redirects))
        written.push(path)
      }
    }
    success(
      `${redirects.length} redirects written to ${written.map((p) => relative(ctx.cwd, p)).join(', ')}`,
    )
    if (warnings.length > 0)
      out(`${warnings.length} conflicts were left out; see the messages above.`)
    return 0
  },
}
