import type { WxrTerm } from '../wxr/model.js'
import type { IndexedPost, SiteIndex } from '../wxr/site-index.js'
import { siteUrlOf } from '../wxr/site-index.js'
import { DEFAULT_PATTERNS, fillPattern, type PathPatterns } from './patterns.js'

const PUBLIC_STATUSES = new Set(['publish'])

const decodeSafe = (value: string): string => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** Lowercased, decoded path without a trailing slash, used as a lookup key. */
export const normalizePath = (path: string): string => {
  const decoded = decodeSafe(path).toLowerCase()
  const trimmed = decoded.replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}

const stripWww = (host: string): string => host.toLowerCase().replace(/^www\./, '')

export interface SiteUrlsOptions {
  patterns?: PathPatterns
  /** More hostnames that count as the old site (for example a staging domain). */
  extraHosts?: string[]
}

/** Old and new URLs of everything in an export. */
export class SiteUrls {
  readonly siteUrl: string
  readonly patterns: PathPatterns
  private readonly hosts: Set<string>
  private readonly sitePath: string
  private readonly byOldPath = new Map<string, number>()
  private readonly categories = new Map<string, WxrTerm>()
  private readonly newPaths = new Map<number, string | undefined>()

  constructor(
    private readonly index: SiteIndex,
    options: SiteUrlsOptions = {},
  ) {
    this.patterns = { ...DEFAULT_PATTERNS, ...options.patterns }
    this.siteUrl = siteUrlOf(index.site)
    const site = safeUrl(this.siteUrl)
    this.sitePath = site ? site.pathname.replace(/\/+$/, '') : ''
    this.hosts = new Set(
      [this.siteUrl, index.site.baseSiteUrl, index.site.link, ...(options.extraHosts ?? [])]
        .map((u) => safeUrl(u.includes('://') ? u : `https://${u}`)?.host)
        .filter((h): h is string => Boolean(h))
        .map(stripWww),
    )
    for (const term of index.terms) {
      if (term.taxonomy === 'category') this.categories.set(term.slug, term)
    }
    for (const post of index.posts.values()) {
      for (const path of this.oldPaths(post)) {
        if (!this.byOldPath.has(normalizePath(path)))
          this.byOldPath.set(normalizePath(path), post.id)
      }
    }
  }

  isInternalHost(host: string): boolean {
    return this.hosts.has(stripWww(host))
  }

  /** Old URL paths that should lead to the post: its permalink and paths with earlier slugs. */
  oldPaths(post: IndexedPost): string[] {
    if (!PUBLIC_STATUSES.has(post.status)) return []
    const url = safeUrl(post.link, this.siteUrl)
    if (!url || url.search !== '') return []
    const path = url.pathname
    const paths = [path]
    const segments = path.replace(/\/+$/, '').split('/')
    const last = segments[segments.length - 1]
    for (const old of post.oldSlugs) {
      if (!last || old === post.slug) continue
      const replaced = [...segments.slice(0, -1), encodeURIComponent(old)].join('/')
      paths.push(path.endsWith('/') ? `${replaced}/` : replaced)
    }
    return [...new Set(paths)]
  }

  /** The post's path on the new site, or `undefined` when its type has no pattern. */
  newPath(postId: number): string | undefined {
    if (this.newPaths.has(postId)) return this.newPaths.get(postId)
    const post = this.index.posts.get(postId)
    const pattern = post ? this.patterns[post.type] : undefined
    const path = post && pattern ? fillPattern(pattern, this.tokens(post)) : undefined
    this.newPaths.set(postId, path)
    return path
  }

  /** New path of a category or tag archive, when a pattern for it is configured. */
  termPath(taxonomy: 'category' | 'post_tag', slug: string): string | undefined {
    const pattern = this.patterns[taxonomy === 'category' ? 'category' : 'tag']
    if (!pattern) return undefined
    const path = taxonomy === 'category' ? this.categoryPath(slug) : slug
    return fillPattern(pattern, { slug, path })
  }

  /** The post an old URL points to: its permalink, an earlier slug, `?p=` or `?page_id=`. */
  findPost(href: string): number | undefined {
    const url = safeUrl(href, `${this.siteUrl}/`)
    if (!url || !this.isInternalHost(url.host)) return undefined
    const id = url.searchParams.get('p') ?? url.searchParams.get('page_id')
    if (id && /^\d+$/.test(id)) return this.index.posts.has(Number(id)) ? Number(id) : undefined
    return this.byOldPath.get(normalizePath(url.pathname))
  }

  /**
   * Rewrites a link to the old site to its new path. Returns `undefined` for external links and
   * for internal links to something without a new URL (media files, archives without a pattern).
   */
  rewriteHref(href: string): string | undefined {
    if (href.startsWith('#') || /^(mailto|tel|javascript|data):/i.test(href)) return undefined
    const url = safeUrl(href, `${this.siteUrl}/`)
    if (!url || !this.isInternalHost(url.host)) return undefined
    const postId = this.findPost(href)
    let path = postId === undefined ? undefined : this.newPath(postId)
    if (path === undefined) {
      const rel = url.pathname.slice(this.sitePath.length)
      const archive = /^\/(category|tag)\/(.+?)\/?$/.exec(rel)
      if (archive) {
        const slug = decodeSafe(archive[2]?.split('/').pop() ?? '')
        path = this.termPath(archive[1] === 'category' ? 'category' : 'post_tag', slug)
      }
    }
    return path === undefined ? undefined : `${path}${url.hash}`
  }

  private tokens(post: IndexedPost) {
    const [date = ''] = post.postDate.split(' ')
    const [year = '', month = '', day = ''] = date.split('-')
    const category = post.terms.find((t) => t.taxonomy === 'category')
    return {
      slug: post.slug,
      path: this.pagePath(post),
      id: String(post.id),
      year,
      month,
      day,
      category: category ? this.categoryPath(category.slug) : 'uncategorized',
      type: post.type,
    }
  }

  private pagePath(post: IndexedPost): string {
    const slugs = [post.slug]
    const seen = new Set([post.id])
    let parent = this.index.posts.get(post.parentId)
    while (parent && !seen.has(parent.id)) {
      seen.add(parent.id)
      slugs.unshift(parent.slug)
      parent = this.index.posts.get(parent.parentId)
    }
    return slugs.join('/')
  }

  private categoryPath(slug: string): string {
    const slugs = [slug]
    const seen = new Set(slugs)
    let parent = this.categories.get(slug)?.parentSlug
    while (parent && !seen.has(parent)) {
      seen.add(parent)
      slugs.unshift(parent)
      parent = this.categories.get(parent)?.parentSlug
    }
    return slugs.join('/')
  }
}

const safeUrl = (value: string, base?: string): URL | undefined => {
  try {
    return new URL(value, base)
  } catch {
    return undefined
  }
}
