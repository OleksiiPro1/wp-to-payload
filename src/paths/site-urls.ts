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

/** Term archives with a new URL: `/<base>/<term>/` on the old site, `pattern` on the new one. */
export interface TermArchive {
  taxonomy: string
  /** Path before the term on the old site, without slashes at the ends (`category`). */
  base: string
  /** New path pattern (`:slug`, `:path`). */
  pattern: string
  /** Old URLs contain the parent terms (`/category/rezepte/brot/`), as for categories. */
  nested?: boolean
}

export interface SiteUrlsOptions {
  patterns?: PathPatterns
  /** More hostnames that count as the old site (for example a staging domain). */
  extraHosts?: string[]
  /**
   * Archives of custom taxonomies with a new URL. Category and tag archives come from
   * `patterns.category` and `patterns.tag`.
   */
  archives?: TermArchive[]
}

/** Old and new URLs of everything in an export. */
export class SiteUrls {
  readonly siteUrl: string
  readonly patterns: PathPatterns
  /** Every taxonomy whose archives get a new URL, the longest old base first. */
  readonly archives: Required<TermArchive>[]
  private readonly hosts: Set<string>
  private readonly sitePath: string
  private readonly byOldPath = new Map<string, number>()
  /** Terms by taxonomy and slug, for paths with parent terms. */
  private readonly terms = new Map<string, Map<string, WxrTerm>>()
  private readonly newPaths = new Map<number, string | undefined>()

  constructor(
    private readonly index: SiteIndex,
    options: SiteUrlsOptions = {},
  ) {
    this.patterns = { ...DEFAULT_PATTERNS, ...options.patterns }
    const builtin: TermArchive[] = []
    if (this.patterns.category) {
      builtin.push({
        taxonomy: 'category',
        base: 'category',
        pattern: this.patterns.category,
        nested: true,
      })
    }
    if (this.patterns.tag) {
      builtin.push({ taxonomy: 'post_tag', base: 'tag', pattern: this.patterns.tag })
    }
    this.archives = [...builtin, ...(options.archives ?? [])]
      .map((a) => ({ ...a, base: a.base.replace(/^\/+|\/+$/g, ''), nested: a.nested ?? false }))
      .sort((a, b) => b.base.length - a.base.length)
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
      const bySlug = this.terms.get(term.taxonomy) ?? new Map<string, WxrTerm>()
      this.terms.set(term.taxonomy, bySlug)
      bySlug.set(term.slug, term)
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

  /** New path of a term archive, when its taxonomy has a pattern. */
  termPath(taxonomy: string, slug: string): string | undefined {
    const archive = this.archives.find((a) => a.taxonomy === taxonomy)
    if (!archive) return undefined
    return fillPattern(archive.pattern, { slug, path: this.termTree(taxonomy, slug) })
  }

  /** The term's slug after the slugs of its parents, joined with `/` (`rezepte/brot`). */
  termTree(taxonomy: string, slug: string): string {
    const bySlug = this.terms.get(taxonomy)
    const slugs = [slug]
    const seen = new Set(slugs)
    let parent = bySlug?.get(slug)?.parentSlug
    while (parent && !seen.has(parent)) {
      seen.add(parent)
      slugs.unshift(parent)
      parent = bySlug?.get(parent)?.parentSlug
    }
    return slugs.join('/')
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
      const rel = decodeSafe(url.pathname.slice(this.sitePath.length)).replace(/\/+$/, '')
      const archive = this.archives.find((a) => rel.startsWith(`/${a.base}/`))
      const slug = archive
        ? rel
            .slice(archive.base.length + 2)
            .split('/')
            .pop()
        : undefined
      if (archive && slug) path = this.termPath(archive.taxonomy, slug)
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
      category: category ? this.termTree('category', category.slug) : 'uncategorized',
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
}

const safeUrl = (value: string, base?: string): URL | undefined => {
  try {
    return new URL(value, base)
  } catch {
    return undefined
  }
}
