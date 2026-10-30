/**
 * New URL path per WordPress type. Tokens: `:slug`, `:path` (slugs of parent pages joined with
 * `/`), `:id`, `:year`, `:month`, `:day`, `:category` (first category with its parents) and
 * `:type`. Types without a pattern get no new URL, so links to them are kept and no redirect is
 * written.
 */
export type PathPatterns = Record<string, string>

/** Matches the routes of the official Payload website template. */
export const DEFAULT_PATTERNS: PathPatterns = {
  post: '/posts/:slug',
  page: '/:slug',
}

export const TOKENS = ['slug', 'path', 'id', 'year', 'month', 'day', 'category', 'type'] as const
export type Token = (typeof TOKENS)[number]

export const validatePattern = (pattern: string): string | undefined => {
  if (!pattern.startsWith('/')) return `"${pattern}" must start with "/"`
  for (const m of pattern.matchAll(/:([a-z]+)/g)) {
    if (!(TOKENS as readonly string[]).includes(m[1] ?? '')) {
      return `"${pattern}" uses the unknown token ":${m[1]}" (known: ${TOKENS.map((t) => `:${t}`).join(', ')})`
    }
  }
  return undefined
}

export const fillPattern = (pattern: string, values: Partial<Record<Token, string>>): string => {
  const path = pattern.replace(/:([a-z]+)/g, (whole, token: string) => {
    const value = values[token as Token]
    return value === undefined ? whole : value
  })
  // Collapse duplicate slashes from empty values and drop a trailing slash.
  const clean = path.replace(/\/{2,}/g, '/')
  return clean.length > 1 ? clean.replace(/\/$/, '') : clean
}

/** Percent-encodes each path segment so the path is safe in every redirect format. */
export const encodePath = (path: string): string =>
  path
    .split('/')
    .map((segment) => encodeURIComponent(decodeSafe(segment)))
    .join('/')

const decodeSafe = (value: string): string => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
