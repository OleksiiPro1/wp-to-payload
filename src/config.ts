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

export interface Config {
  /** New URL path per WordPress type (`post`, `page`, `category`, `tag`, custom types). */
  paths: PathPatterns
  /** More hostnames of the old site, so links to them count as internal. */
  siteHosts: string[]
  collections: CollectionSlugs
  fields: FieldNames
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
  'seo',
  'media',
  'importAuthorEmails',
])

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
