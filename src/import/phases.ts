/** Built-in import steps, in the order they run. Post types from the config add more steps. */
export const PHASES = [
  'media',
  'categories',
  'tags',
  'authors',
  'posts',
  'pages',
  'redirects',
] as const

/** A step name: a built-in step or the step of a post type (named after its collection). */
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

/** Name of a step for the console and reports. */
export const phaseLabel = (phase: Phase): string =>
  LABELS[phase] ?? phase.charAt(0).toUpperCase() + phase.slice(1)
