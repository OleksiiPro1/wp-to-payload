import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { AcfJsonError, loadAcfJson } from '../acf/definitions.js'
import type { AcfPlan } from '../acf/plan.js'
import { planSiteAcf } from '../acf/site.js'
import { type Command, stringOption, UsageError } from '../cli/command.js'
import { info, out, paint, success, warn } from '../cli/output.js'
import { ACF_HELP, ACF_OPTIONS, applyAcfOptions } from '../cli/shared.js'
import { CONFIG_FILE, type CollectionSlugs, type Config, loadConfig } from '../config.js'
import { findPackageDir } from '../import/project.js'
import {
  configSnippet,
  type ScaffoldCustom,
  type ScaffoldGlobals,
  type ScaffoldLocalization,
  type ScaffoldRelation,
  scaffoldFiles,
} from '../scaffold/templates.js'
import { indexLanguages, type SiteLanguages } from '../languages.js'
import { placeMenus } from '../menus.js'
import { EMPTY_SURVEY, resolveSiteTypes, type SiteTypes, surveyIndex } from '../site-types.js'
import { buildSiteIndex } from '../wxr/site-index.js'

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

/**
 * The slug a collection gets. `slugs` already has the prefix. A custom type may be mapped to one
 * of these collections, with or without the prefix; every other collection gets the prefix.
 */
const prefixer = (slugs: CollectionSlugs, prefix: string) => {
  const builtin = new Set(Object.values(slugs))
  return (collection: string) => {
    const prefixed = `${prefix}${collection}`
    if (builtin.has(prefixed)) return prefixed
    return builtin.has(collection) ? collection : prefixed
  }
}

/**
 * The custom post types and taxonomies to write collections for. Types mapped to a built-in
 * collection (`postTypes.news.collection: "posts"`) need no file of their own.
 */
const customCollections = (
  types: SiteTypes,
  slugs: CollectionSlugs,
  prefix: string,
): ScaffoldCustom => {
  const builtin = new Set(Object.values(slugs))
  const slugOf = prefixer(slugs, prefix)
  const taxonomy = new Map(types.taxonomies.map((t) => [t.taxonomy, t]))
  /** Fields for the taxonomies of every type that goes into the collection. */
  const relationsOf = (collection: string, skipBuiltin: boolean): ScaffoldRelation[] => {
    const fields = new Map<string, ScaffoldRelation>()
    for (const type of types.postTypes) {
      if (slugOf(type.collection) !== collection) continue
      for (const name of type.taxonomies) {
        const t = taxonomy.get(name)
        if (!t || (skipBuiltin && t.builtin) || fields.has(t.field)) continue
        fields.set(t.field, { field: t.field, collection: slugOf(t.collection) })
      }
    }
    return [...fields.values()]
  }
  const seen = new Set<string>()
  const own = <T extends { collection: string; builtin: boolean }>(list: T[]) =>
    list.filter((t) => {
      const slug = slugOf(t.collection)
      if (t.builtin || builtin.has(slug) || seen.has(slug)) return false
      seen.add(slug)
      return true
    })
  return {
    taxonomies: own(types.taxonomies).map((t) => ({
      slug: slugOf(t.collection),
      wpName: t.taxonomy,
      hierarchical: t.hierarchical,
    })),
    postTypes: own(types.postTypes).map((t) => ({
      slug: slugOf(t.collection),
      wpName: t.wpType,
      hierarchical: t.hierarchical,
      relations: relationsOf(slugOf(t.collection), false),
    })),
    // The Posts template has categories and tags already.
    postRelations: relationsOf(slugs.posts, true),
    pageRelations: relationsOf(slugs.pages, true),
  }
}

/** Payload locales for the site's languages: the default first, as the import maps them. */
const localizationOf = (languages: SiteLanguages, config: Config): ScaffoldLocalization => {
  const codeOf = (code: string) => config.localization.locales[code] ?? code
  const ordered = [
    ...languages.languages.filter((l) => l.code === languages.defaultLanguage),
    ...languages.languages.filter((l) => l.code !== languages.defaultLanguage),
  ]
  return {
    locales: ordered.map((l) => ({ code: codeOf(l.code), label: l.name ?? l.code })),
    defaultLocale: codeOf(languages.defaultLanguage),
  }
}

/** The config settings that point the import to the prefixed collections. */
const prefixedSettings = (slugs: CollectionSlugs, custom: ScaffoldCustom, config: Config) => {
  const collections: Partial<CollectionSlugs> = { ...slugs }
  delete collections.redirects
  const settings: Record<string, unknown> = { collections }
  const byName = (list: { wpName: string; slug: string }[], existing: Record<string, object>) =>
    Object.fromEntries(list.map((c) => [c.wpName, { ...existing[c.wpName], collection: c.slug }]))
  if (custom.postTypes.length > 0) settings.postTypes = byName(custom.postTypes, config.postTypes)
  if (custom.taxonomies.length > 0) {
    settings.taxonomies = byName(custom.taxonomies, config.taxonomies)
  }
  return settings
}

export const scaffoldCommand: Command = {
  name: 'scaffold',
  summary:
    'Write Payload collections for the import: posts, pages, categories, tags, authors, media, and the custom post types and taxonomies of an export.',
  usage:
    'scaffold [export.xml] [--out <dir>] [--slug-prefix <prefix>] [--acf-json <path>] [--force]',
  help: [
    [
      'export.xml',
      'Also write collections for the custom post types and taxonomies of this export',
    ],
    ['--out <dir>', 'Where to write the collection files (default: src/collections/wp)'],
    [
      '--slug-prefix <prefix>',
      'Prefix the collection slugs (e.g. wp-) when your project already has posts or pages',
    ],
    ...ACF_HELP,
    ['--force', 'Overwrite files that already exist'],
    ['--config <file>', `Settings file to read collection slugs from (default: ${CONFIG_FILE})`],
  ],
  options: {
    out: { type: 'string' },
    'slug-prefix': { type: 'string' },
    force: { type: 'boolean' },
    config: { type: 'string' },
    ...ACF_OPTIONS,
  },
  async run(ctx) {
    const config = applyAcfOptions(ctx, await loadConfig(ctx.cwd, stringOption(ctx, 'config')))
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
    const exportFile = ctx.positionals[0] ? resolve(ctx.cwd, ctx.positionals[0]) : undefined
    if (exportFile && !existsSync(exportFile)) throw new UsageError(`${exportFile} does not exist`)
    const index = exportFile ? await buildSiteIndex(exportFile) : undefined
    const survey = index ? surveyIndex(index) : EMPTY_SURVEY
    const languages = index ? indexLanguages(index, config) : undefined
    const localization = languages ? localizationOf(languages, config) : undefined
    const types = resolveSiteTypes(config, survey)
    const custom = customCollections(types, slugs, prefix)
    let acf: AcfPlan | undefined
    if (index) {
      const json = await loadAcfJson(config.acfJson).catch((error: unknown) => {
        throw error instanceof AcfJsonError ? new UsageError(error.message) : error
      })
      acf = planSiteAcf({
        acf: index.acf,
        json,
        config,
        types,
        survey,
        typeOfPost: (id) => index.posts.get(id)?.type,
        localized: localization !== undefined,
        slugOf: prefixer(slugs, prefix),
      })
    }
    const hasSrc = existsSync(join(ctx.cwd, 'src'))
    const outDir = resolve(
      ctx.cwd,
      stringOption(ctx, 'out') ?? (hasSrc ? 'src/collections/wp' : 'collections/wp'),
    )

    // Globals for the menus of the export, such as header and footer.
    const rank = (slug: string) => ['header', 'footer'].indexOf(slug) + 1 || 3
    const menuGlobals = index
      ? [
          ...new Set(
            placeMenus(index.menus, config, languages)
              .map((p) => p.global)
              .filter((g): g is string => g !== undefined),
          ),
        ].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
      : []
    const wanted = [
      slugs.posts,
      slugs.pages,
      slugs.categories,
      slugs.tags,
      slugs.authors,
      slugs.media,
      ...custom.taxonomies.map((t) => t.slug),
      ...custom.postTypes.map((t) => t.slug),
    ]
    const root = hasSrc ? join(ctx.cwd, 'src') : ctx.cwd
    // A project with the website template has header and footer globals already; the import
    // writes the menus into them.
    const ownGlobals = await findExistingSlugs(root, outDir, menuGlobals)
    const globals: ScaffoldGlobals = {
      slugs: menuGlobals.filter((g) => !ownGlobals.has(g)),
      documents: [...new Set([slugs.pages, slugs.posts, ...custom.postTypes.map((t) => t.slug)])],
    }
    const clashes = await findExistingSlugs(root, outDir, wanted)
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
    for (const file of scaffoldFiles(slugs, custom, localization, acf, globals)) {
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
    const listed = [...custom.postTypes, ...custom.taxonomies]
    if (listed.length > 0) {
      out()
      out('Collections for the custom post types and taxonomies of the export:')
      for (const c of listed) out(`  ${c.wpName} → ${c.slug}`)
      out('Delete the files of the ones you do not need, and their lines in index.ts.')
    } else if (!exportFile) {
      info(
        'Give the export file (scaffold export.xml) to get collections for its custom types too.',
      )
    }

    if (globals.slugs.length > 0 || ownGlobals.size > 0) {
      out()
      out('Menus of the export:')
      for (const p of placeMenus(index?.menus ?? [], config, languages)) {
        if (p.menu.items.length === 0) continue
        const where = p.global
          ? `${p.global}${p.language ? ` (${p.language})` : ''}`
          : `not imported: ${p.reason}`
        out(`  ${p.menu.name} → ${where}`)
      }
      for (const [slug, file] of ownGlobals) {
        info(`Your global "${slug}" (${relative(ctx.cwd, file)}) gets the menu in its navItems.`)
      }
    }
    if (acf && acf.collections.size > 0) {
      out()
      out('Custom fields (ACF) in the collections:')
      for (const plan of acf.collections.values()) {
        out(`  ${plan.collection}: ${plan.fields.map((f) => f.name).join(', ')}`)
      }
      for (const note of acf.notes) {
        if (note.code === 'ACF_FIELD_RENAMED' || (note.values ?? 0) > 0) info(note.message)
      }
      const quiet = acf.notes.filter((n) => n.code === 'ACF_FIELD_SKIPPED' && !n.values).length
      if (quiet > 0)
        info(`${quiet} more ACF fields without values are not imported; analyze lists them.`)
    }
    if (acf && acf.undefinedValues.length > 0) {
      warn(
        `The export has values of ${acf.undefinedValues.length} ACF fields without a definition (${acf.undefinedValues
          .slice(0, 5)
          .map((v) => v.name)
          .join(', ')}${acf.undefinedValues.length > 5 ? ', …' : ''}).`,
      )
      warn(
        "Run scaffold again with --acf-json and the theme's acf-json folder to get their fields.",
      )
    }

    if (prefix) {
      const configPath = join(ctx.cwd, CONFIG_FILE)
      const settings = prefixedSettings(slugs, custom, config)
      if (existsSync(configPath)) {
        warn(`Add the new slugs to ${CONFIG_FILE}: ${JSON.stringify(settings)}`)
      } else {
        await writeFile(configPath, `${JSON.stringify(settings, null, 2)}\n`)
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
    out(
      paint(
        'cyan',
        configSnippet(
          slugs,
          importPathFrom(configFile, outDir),
          custom,
          localization,
          globals.slugs.length > 0,
        ),
      ),
    )
    if (languages && localization) {
      out()
      out(
        `The site is in ${languages.languages.length} languages (${languages.source}); the collections keep texts per locale.`,
      )
    }
    out()
    const missing = ['@payloadcms/plugin-seo', '@payloadcms/plugin-redirects'].filter(
      (p) => !findPackageDir(p, ctx.cwd),
    )
    if (missing.length > 0) out(`Install the plugins: npm install ${missing.join(' ')}`)
    out('Then run: npx payload generate:types (and create a migration if you use Postgres).')
    return 0
  },
}
