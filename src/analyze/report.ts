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
    customPostTypes: Record<string, number>
  }
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
