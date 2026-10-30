import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { type Command, stringOption, UsageError } from '../cli/command.js'
import { info, out, paint, success, warn } from '../cli/output.js'
import { CONFIG_FILE, type CollectionSlugs, loadConfig } from '../config.js'
import { findPackageDir } from '../import/project.js'
import { configSnippet, scaffoldFiles } from '../scaffold/templates.js'

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'build', '.turbo'])

/** Collection slugs already defined in the project's source files. */
const findExistingSlugs = async (
  root: string,
  skip: string,
  wanted: string[],
): Promise<Map<string, string>> => {
  const found = new Map<string, string>()
  const pattern = new RegExp(
    `slug:\\s*['"\`](${wanted.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})['"\`]`,
    'g',
  )
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 8 || resolve(dir) === resolve(skip)) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(path, depth + 1)
      } else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) {
        const text = await readFile(path, 'utf8').catch(() => '')
        for (const m of text.matchAll(pattern)) if (m[1] && !found.has(m[1])) found.set(m[1], path)
      }
    }
  }
  await walk(root, 0)
  return found
}

const importPathFrom = (configFile: string, outDir: string): string => {
  const rel = relative(dirname(configFile), outDir).split(sep).join('/')
  return rel.startsWith('.') ? rel : `./${rel}`
}

export const scaffoldCommand: Command = {
  name: 'scaffold',
  summary:
    'Write Payload collections (Posts, Pages, Categories, Tags, Authors, Media) for the import.',
  usage: 'scaffold [--out <dir>] [--slug-prefix <prefix>] [--force]',
  help: [
    ['--out <dir>', 'Where to write the collection files (default: src/collections/wp)'],
    [
      '--slug-prefix <prefix>',
      'Prefix the collection slugs (e.g. wp-) when your project already has posts or pages',
    ],
    ['--force', 'Overwrite files that already exist'],
    ['--config <file>', `Settings file to read collection slugs from (default: ${CONFIG_FILE})`],
  ],
  options: {
    out: { type: 'string' },
    'slug-prefix': { type: 'string' },
    force: { type: 'boolean' },
    config: { type: 'string' },
  },
  async run(ctx) {
    const config = await loadConfig(ctx.cwd, stringOption(ctx, 'config'))
    const prefix = stringOption(ctx, 'slug-prefix') ?? ''
    if (prefix && !/^[a-z][a-z0-9-]*$/.test(prefix)) {
      throw new UsageError('--slug-prefix may only contain lowercase letters, digits and hyphens')
    }
    const slugs = Object.fromEntries(
      Object.entries(config.collections).map(([key, slug]) => [
        key,
        key === 'redirects' ? slug : `${prefix}${slug}`,
      ]),
    ) as unknown as CollectionSlugs
    const hasSrc = existsSync(join(ctx.cwd, 'src'))
    const outDir = resolve(
      ctx.cwd,
      stringOption(ctx, 'out') ?? (hasSrc ? 'src/collections/wp' : 'collections/wp'),
    )

    const wanted = [
      slugs.posts,
      slugs.pages,
      slugs.categories,
      slugs.tags,
      slugs.authors,
      slugs.media,
    ]
    const clashes = await findExistingSlugs(hasSrc ? join(ctx.cwd, 'src') : ctx.cwd, outDir, wanted)
    if (clashes.size > 0) {
      for (const [slug, file] of clashes)
        warn(`Your project already has a collection "${slug}" (${relative(ctx.cwd, file)}).`)
      warn(
        'Two collections with the same slug will not start. Either remove yours, run scaffold with',
      )
      warn(
        '--slug-prefix wp-, or skip scaffold and map your collections in wp-to-payload.config.json.',
      )
      if (!ctx.values.force) {
        out('Nothing was written. Run again with --force to write the files anyway.')
        return 1
      }
    }

    await mkdir(outDir, { recursive: true })
    const written: string[] = []
    const kept: string[] = []
    for (const file of scaffoldFiles(slugs)) {
      const path = join(outDir, file.name)
      if (existsSync(path) && !ctx.values.force) {
        kept.push(path)
        continue
      }
      await writeFile(path, file.content)
      written.push(path)
    }
    for (const path of written) success(`wrote ${relative(ctx.cwd, path)}`)
    for (const path of kept) info(`kept ${relative(ctx.cwd, path)} (exists; --force overwrites)`)

    if (prefix) {
      const configPath = join(ctx.cwd, CONFIG_FILE)
      const collections: Partial<CollectionSlugs> = { ...slugs }
      delete collections.redirects
      if (existsSync(configPath)) {
        warn(`Add the new slugs to ${CONFIG_FILE}: "collections": ${JSON.stringify(collections)}`)
      } else {
        await writeFile(configPath, `${JSON.stringify({ collections }, null, 2)}\n`)
        success(`wrote ${CONFIG_FILE} with the prefixed collection slugs`)
      }
    }

    const configFile =
      ['src/payload.config.ts', 'payload.config.ts']
        .map((p) => join(ctx.cwd, p))
        .find((p) => existsSync(p)) ??
      // Payload projects keep the config in src/ when there is one.
      join(ctx.cwd, hasSrc ? 'src/payload.config.ts' : 'payload.config.ts')
    out()
    out(
      `Add the collections and plugins to ${configFile ? relative(ctx.cwd, configFile) : 'payload.config.ts'}:`,
    )
    out()
    out(paint('cyan', configSnippet(slugs, importPathFrom(configFile, outDir))))
    out()
    const missing = ['@payloadcms/plugin-seo', '@payloadcms/plugin-redirects'].filter(
      (p) => !findPackageDir(p, ctx.cwd),
    )
    if (missing.length > 0) out(`Install the plugins: npm install ${missing.join(' ')}`)
    out('Then run: npx payload generate:types (and create a migration if you use Postgres).')
    return 0
  },
}
