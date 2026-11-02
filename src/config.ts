import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DEFAULT_PATTERNS, type PathPatterns, validatePattern } from './paths/patterns.js'

export const CONFIG_FILE = 'wp-to-payload.config.json'

/** Payload collection slugs the import writes to. */
export interface CollectionSlugs {
  posts: string
  pages: string
  categories: string
  tags: string
  authors: string
  media: string
  redirects: string
}

/** Field names in the target collections, for projects whose schema differs from `scaffold`. */
export interface FieldNames {
  title: string
  slug: string
  content: string
  excerpt: string
  publishedAt: string
  author: string
  categories: string
  tags: string
  featuredImage: string
  parent: string
  meta: string
  wpId: string
}

/** Settings for a custom post type. Everything is optional; the defaults come from the export. */
export interface PostTypeSettings {
  /** Payload collection slug. Default: the type in plural, `recipe` → `recipes`. */
  collection?: string
  /** New URL pattern, the same as `paths.<type>`. Default: `/recipes/:slug`. */
  path?: string
  /** Whether items have parents, like pages. Default: whether the export has such items. */
  hierarchical?: boolean
}

/** Settings for a custom taxonomy. */
export interface TaxonomySettings {
  /** Payload collection slug. Default: the taxonomy in plural, `recipe_category` → `recipe-categories`. */
  collection?: string
  /** New URL pattern of the term archives (`:slug`, `:path`). Default: none, no redirects. */
  path?: string
  /** Path of the archives on the old site before the term (`rezeptkategorie` in `/rezeptkategorie/brot/`). Default: the taxonomy name. */
  base?: string
  /** Relationship field of the documents for these terms. Default: `recipeCategories`. */
  field?: string
  /** Whether terms have parents. Default: whether the export has such terms. */
  hierarchical?: boolean
}

export interface Config {
  /** New URL path per WordPress type (`post`, `page`, `category`, `tag`, custom types). */
  paths: PathPatterns
  /** More hostnames of the old site, so links to them count as internal. */
  siteHosts: string[]
  collections: CollectionSlugs
  fields: FieldNames
  /** Custom post types, by WordPress name. */
  postTypes: Record<string, PostTypeSettings>
  /** Custom taxonomies, by WordPress name. */
  taxonomies: Record<string, TaxonomySettings>
  seo: { separator: string }
  media: {
    /** Hosts media may be downloaded from besides the site itself (for example a CDN). */
    hosts: string[]
  }
  /** Copy author e-mail addresses. Off by default: they are personal data. */
  importAuthorEmails: boolean
}

export const DEFAULT_CONFIG: Config = {
  paths: { ...DEFAULT_PATTERNS },
  siteHosts: [],
  collections: {
    posts: 'posts',
    pages: 'pages',
    categories: 'categories',
    tags: 'tags',
    authors: 'authors',
    media: 'media',
    redirects: 'redirects',
  },
  fields: {
    title: 'title',
    slug: 'slug',
    content: 'content',
    excerpt: 'excerpt',
    publishedAt: 'publishedAt',
    author: 'author',
    categories: 'categories',
    tags: 'tags',
    featuredImage: 'featuredImage',
    parent: 'parent',
    meta: 'meta',
    wpId: 'wpId',
  },
  postTypes: {},
  taxonomies: {},
  seo: { separator: '-' },
  media: { hosts: [] },
  importAuthorEmails: false,
}

export class ConfigError extends Error {
  override name = 'ConfigError'
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const stringRecord = (value: unknown, where: string): Record<string, string> => {
  if (value === undefined) return {}
  if (!isObject(value)) throw new ConfigError(`${where} must be an object`)
  for (const [key, v] of Object.entries(value)) {
    if (typeof v !== 'string' || v === '')
      throw new ConfigError(`${where}.${key} must be a non-empty string`)
  }
  return value as Record<string, string>
}

const stringList = (value: unknown, where: string): string[] => {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new ConfigError(`${where} must be a list of strings`)
  }
  return value as string[]
}

const KNOWN_KEYS = new Set([
  '$schema',
  'paths',
  'siteHosts',
  'collections',
  'fields',
  'postTypes',
  'taxonomies',
  'seo',
  'media',
  'importAuthorEmails',
])

type SettingType = 'string' | 'pattern' | 'boolean'

/** Validates `postTypes` or `taxonomies`: WordPress names mapped to objects of known settings. */
const typeSettings = <T>(
  value: unknown,
  where: string,
  known: Record<string, SettingType>,
  builtin: Record<string, string>,
): Record<string, T> => {
  if (value === undefined) return {}
  if (!isObject(value)) throw new ConfigError(`${where} must be an object`)
  for (const [name, settings] of Object.entries(value)) {
    if (!/^[a-z0-9_-]+$/.test(name)) {
      throw new ConfigError(`${where}: "${name}" is not a WordPress name (a-z, 0-9, _ and -)`)
    }
    const hint = builtin[name]
    if (hint) throw new ConfigError(`${where}.${name}: ${hint}`)
    if (!isObject(settings)) throw new ConfigError(`${where}.${name} must be an object`)
    for (const [key, v] of Object.entries(settings)) {
      const type = known[key]
      if (!type) {
        throw new ConfigError(
          `${where}.${name}: unknown setting "${key}" (known: ${Object.keys(known).join(', ')})`,
        )
      }
      if (type === 'boolean' ? typeof v !== 'boolean' : typeof v !== 'string' || v === '') {
        throw new ConfigError(
          `${where}.${name}.${key} must be ${type === 'boolean' ? 'true or false' : 'a non-empty string'}`,
        )
      }
      const problem = type === 'pattern' ? validatePattern(v as string) : undefined
      if (problem) throw new ConfigError(`${where}.${name}.${key}: ${problem}`)
    }
  }
  return structuredClone(value) as Record<string, T>
}

const BUILTIN_TYPE_HINTS: Record<string, string> = {
  post: 'posts are set with collections.posts and paths.post',
  page: 'pages are set with collections.pages and paths.page',
  attachment: 'media are set with collections.media',
  nav_menu_item: 'menu items are not a content type',
  revision: 'revisions are never imported',
}

const BUILTIN_TAXONOMY_HINTS: Record<string, string> = {
  category: 'categories are set with collections.categories, fields.categories and paths.category',
  post_tag: 'tags are set with collections.tags, fields.tags and paths.tag',
}

/** Validates a parsed config file and merges it with the defaults. */
export const parseConfig = (raw: unknown, source = CONFIG_FILE): Config => {
  if (!isObject(raw)) throw new ConfigError(`${source} must contain a JSON object`)
  for (const key of Object.keys(raw)) {
    if (!KNOWN_KEYS.has(key)) throw new ConfigError(`${source}: unknown setting "${key}"`)
  }
  const paths = { ...DEFAULT_CONFIG.paths, ...stringRecord(raw.paths, 'paths') }
  for (const pattern of Object.values(paths)) {
    const problem = validatePattern(pattern)
    if (problem) throw new ConfigError(`${source}: paths: ${problem}`)
  }
  const postTypes = typeSettings<PostTypeSettings>(
    raw.postTypes,
    `${source}: postTypes`,
    { collection: 'string', path: 'pattern', hierarchical: 'boolean' },
    BUILTIN_TYPE_HINTS,
  )
  const taxonomies = typeSettings<TaxonomySettings>(
    raw.taxonomies,
    `${source}: taxonomies`,
    {
      collection: 'string',
      path: 'pattern',
      base: 'string',
      field: 'string',
      hierarchical: 'boolean',
    },
    BUILTIN_TAXONOMY_HINTS,
  )
  // A post type's path can be set in either place; paths is what the rest of the tool reads.
  const explicitPaths = isObject(raw.paths) ? raw.paths : {}
  for (const [type, settings] of Object.entries(postTypes)) {
    if (settings.path === undefined) continue
    const other = explicitPaths[type]
    if (other !== undefined && other !== settings.path) {
      throw new ConfigError(
        `${source}: postTypes.${type}.path and paths.${type} differ; set the path in one place`,
      )
    }
    paths[type] = settings.path
  }
  const collections = stringRecord(raw.collections, 'collections')
  for (const key of Object.keys(collections)) {
    if (!(key in DEFAULT_CONFIG.collections))
      throw new ConfigError(`${source}: unknown collection "${key}"`)
  }
  const fields = stringRecord(raw.fields, 'fields')
  for (const key of Object.keys(fields)) {
    if (!(key in DEFAULT_CONFIG.fields)) throw new ConfigError(`${source}: unknown field "${key}"`)
  }
  const seo = raw.seo === undefined ? {} : raw.seo
  if (!isObject(seo)) throw new ConfigError(`${source}: seo must be an object`)
  if (seo.separator !== undefined && typeof seo.separator !== 'string') {
    throw new ConfigError(`${source}: seo.separator must be a string`)
  }
  const media = raw.media === undefined ? {} : raw.media
  if (!isObject(media)) throw new ConfigError(`${source}: media must be an object`)
  if (raw.importAuthorEmails !== undefined && typeof raw.importAuthorEmails !== 'boolean') {
    throw new ConfigError(`${source}: importAuthorEmails must be true or false`)
  }
  return {
    paths,
    siteHosts: stringList(raw.siteHosts, 'siteHosts'),
    collections: { ...DEFAULT_CONFIG.collections, ...collections },
    fields: { ...DEFAULT_CONFIG.fields, ...fields },
    postTypes,
    taxonomies,
    seo: {
      separator: typeof seo.separator === 'string' ? seo.separator : DEFAULT_CONFIG.seo.separator,
    },
    media: { hosts: stringList(media.hosts, 'media.hosts') },
    importAuthorEmails: raw.importAuthorEmails === true,
  }
}

/**
 * Reads `wp-to-payload.config.json` from `cwd` (or the given path). Without a file the defaults
 * apply; an explicitly given file must exist.
 */
export const loadConfig = async (cwd: string, path?: string): Promise<Config> => {
  const file = resolve(cwd, path ?? CONFIG_FILE)
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if (!path && (error as NodeJS.ErrnoException).code === 'ENOENT')
      return structuredClone(DEFAULT_CONFIG)
    throw new ConfigError(`cannot read ${file}: ${(error as Error).message}`)
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new ConfigError(`${file} is not valid JSON: ${(error as Error).message}`)
  }
  return parseConfig(raw, file)
}
