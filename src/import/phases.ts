/** Import steps, in the order they run. */
export const PHASES = [
  'media',
  'categories',
  'tags',
  'authors',
  'posts',
  'pages',
  'redirects',
] as const
export type Phase = (typeof PHASES)[number]
