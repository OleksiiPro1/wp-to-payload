/**
 * Built-in import steps, in the order they run. Custom taxonomies add steps after the tags,
 * custom post types after the pages.
 */
export const PHASES = [
  'media',
  'categories',
  'tags',
  'authors',
  'posts',
  'pages',
  'redirects',
] as const

/** A step name: a built-in step or the step of a custom type (named after its collection). */
export type Phase = string

const LABELS: Record<string, string> = {
  media: 'Media',
  categories: 'Categories',
  tags: 'Tags',
  authors: 'Authors',
  posts: 'Posts',
  pages: 'Pages',
  redirects: 'Redirects',
}

/** Name of a step for the console and reports: `recipe-categories` → `Recipe categories`. */
export const phaseLabel = (phase: Phase): string => {
  const words = phase.replace(/[-_]+/g, ' ').trim()
  return LABELS[phase] ?? words.charAt(0).toUpperCase() + words.slice(1)
}
