/**
 * How each Gutenberg block is handled by the import. `analyze` uses the same table, so the
 * report matches what `import` does.
 */
export type BlockSupport = 'supported' | 'partial' | 'dropped' | 'unknown'

const SUPPORTED = new Set([
  'core/paragraph',
  'core/heading',
  'core/list',
  'core/list-item',
  'core/quote',
  'core/image',
  'core/gallery',
  'core/code',
  'core/preformatted',
  'core/table',
  'core/separator',
  'core/buttons',
  'core/button',
  'core/embed',
  'core/columns',
  'core/column',
  'core/group',
  'core/freeform',
  'core/html',
  'core/shortcode',
])

/** Converted with some loss (layout, styling or interactivity is not kept). */
const PARTIAL = new Set([
  'core/pullquote',
  'core/verse',
  'core/cover',
  'core/media-text',
  'core/details',
  'core/audio',
  'core/video',
  'core/file',
  'core/footnotes',
  'core/row',
  'core/stack',
])

/** Removed: layout-only or rendered by PHP at request time, so the export has no content. */
const DROPPED = new Set([
  'core/spacer',
  'core/more',
  'core/nextpage',
  'core/latest-posts',
  'core/latest-comments',
  'core/archives',
  'core/categories',
  'core/tag-cloud',
  'core/calendar',
  'core/search',
  'core/rss',
  'core/social-links',
  'core/social-link',
  'core/navigation',
  'core/query',
  'core/post-template',
  'core/query-pagination',
  'core/block',
  'core/site-logo',
  'core/site-title',
  'core/page-list',
  'core/loginout',
])

export const normalizeBlockName = (name: string): string =>
  name.includes('/') ? name : `core/${name}`

export const blockSupport = (name: string): BlockSupport => {
  const full = normalizeBlockName(name)
  if (full.startsWith('core-embed/')) return 'supported'
  if (SUPPORTED.has(full)) return 'supported'
  if (PARTIAL.has(full)) return 'partial'
  if (DROPPED.has(full)) return 'dropped'
  return 'unknown'
}

/** Matches block opening comments: `<!-- wp:name {json} -->` or `<!-- wp:name /-->`. */
export const BLOCK_OPENER = /<!--\s+wp:([a-z][a-z0-9_-]*(?:\/[a-z][a-z0-9_-]*)?)(?=[\s/])/g

export const hasBlocks = (content: string): boolean => content.includes('<!-- wp:')
