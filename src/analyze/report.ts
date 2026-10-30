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
  complexity: { level: Complexity; score: number; reasons: ComplexityReason[] }
  issues: { line: number; column: number; message: string }[]
}
