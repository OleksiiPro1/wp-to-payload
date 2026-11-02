import type { BlockSupport } from '../content/blocks.js'

export type Complexity = 'simple' | 'medium' | 'complex'

export interface StatusCounts {
  total: number
  byStatus: Record<string, number>
}

export interface BlockUsage {
  name: string
  count: number
  /** Number of posts and pages that use the block. */
  items: number
  support: BlockSupport
}

export interface NamedCount {
  name: string
  count: number
  items: number
}

export interface Detection {
  detected: boolean
  /** Number of items (posts, pages and other entries) with this feature. */
  items: number
  details?: Record<string, number | string | string[]>
}

/** A custom post type and what the import does with it. */
export interface CustomPostType {
  name: string
  items: number
  byStatus: Record<string, number>
  /** Its items have parents of the same type, like pages. */
  hierarchical: boolean
  /** Taxonomies of the terms on its items. */
  taxonomies: string[]
  /** `import` brings it over, into a collection of its own unless the config says otherwise. */
  imported: boolean
  /** Why it is not imported: plugin data such as forms or templates. */
  reason?: string
}

/** A taxonomy other than categories, tags and menus, and what the import does with it. */
export interface CustomTaxonomy {
  name: string
  terms: number
  hierarchical: boolean
  /** Post types whose items use its terms. */
  postTypes: string[]
  imported: boolean
  reason?: string
}

/** The languages of a multilingual site and how complete its translations are. */
export interface LanguagesReport {
  /** Where the languages come from: Polylang, WPML Export and Import, or URL directories. */
  source: 'polylang' | 'wpml' | 'url'
  defaultLanguage: string
  /** How the default language was found: config, urls (no language directory), site, first. */
  defaultFrom: string
  /** Content items (no images or menus) per language, any status but trash. */
  languages: { code: string; locale?: string; name?: string; items: number }[]
  /** Translation groups with every language, and with some missing. */
  groups: { complete: number; incomplete: number }
  /** Content items without a translation. */
  untranslated: number
}

export interface ComplexityReason {
  points: number
  reason: string
}

export interface AnalyzeReport {
  tool: { name: string; version: string }
  generatedAt: string
  source: { file: string; bytes: number }
  site: {
    title: string
    url: string
    language: string
    wxrVersion: string
    wordpressVersion?: string
    multisite: boolean
  }
  counts: {
    posts: StatusCounts
    pages: StatusCounts
    attachments: number
    categories: number
    tags: number
    otherTerms: Record<string, number>
    authors: number
    comments: number
    menuItems: number
    /** Items per custom post type that the import brings over. */
    customPostTypes: Record<string, number>
  }
  customTypes: { postTypes: CustomPostType[]; taxonomies: CustomTaxonomy[] }
  /** Only for multilingual sites. */
  languages?: LanguagesReport
  content: {
    gutenbergItems: number
    classicItems: number
    emptyItems: number
    passwordProtected: number
    blocks: BlockUsage[]
    shortcodes: NamedCount[]
  }
  media: {
    byType: Record<string, number>
    hosts: string[]
  }
  builders: Record<
    'elementor' | 'divi' | 'wpbakery' | 'beaver' | 'oxygen' | 'bricks' | 'avada',
    Detection
  >
  seo: Record<'yoast' | 'rankmath' | 'aioseo' | 'seopress', Detection>
  multilingual: Record<'wpml' | 'polylang', Detection>
  woocommerce: Detection
  acf: Detection
  /** ACF field groups and what the import does with their fields; only when ACF is found. */
  customFields?: CustomFieldsReport
  /** Menus and the globals they go into with the default settings. */
  menus: MenuReport[]
  complexity: { level: Complexity; score: number; reasons: ComplexityReason[] }
  issues: { line: number; column: number; message: string }[]
}

/** ACF field groups (from the export and from `--acf-json`) and how they are imported. */
export interface CustomFieldsReport {
  groups: {
    key: string
    title: string
    source: 'export' | 'json'
    /** Fields, sub-fields included. */
    fields: number
    /** Collections that get its fields. */
    collections: string[]
    /** Where else it applies in WordPress (options pages, users, …), for groups without a collection. */
    elsewhere: string[]
  }[]
  /** Fields by ACF type, sub-fields included. */
  fieldTypes: Record<string, number>
  /** Payload field names per collection. */
  collections: { collection: string; fields: string[] }[]
  /** Fields that are not imported, or imported under another name. */
  notes: {
    code: 'ACF_FIELD_SKIPPED' | 'ACF_FIELD_RENAMED'
    collection: string
    field: string
    type: string
    message: string
    /** Items that have a value (top-level fields only). */
    values?: number
  }[]
  /** Values of fields that no field group defines: their groups exist only in the theme's code. */
  undefinedValues: { target: string; name: string; key: string; items: number }[]
  /** Date and time fields, whose values have no time zone. */
  dateTimeFields: number
}

export interface MenuReport {
  name: string
  slug: string
  /** Entries, submenus included. */
  items: number
  /** 1 for a menu without submenus. */
  levels: number
  /** On multilingual sites: the language most of its links are in. */
  language?: string
  /** The Payload global it goes into, if any. */
  global?: string
  /** How the global was chosen, or why the menu is not imported. */
  reason: string
}
