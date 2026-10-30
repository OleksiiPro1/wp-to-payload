import { encodePath } from '../paths/patterns.js'
import { normalizePath, type SiteUrls } from '../paths/site-urls.js'
import type { Warning } from '../report/warnings.js'
import type { SiteIndex } from '../wxr/site-index.js'

export interface Redirect {
  /** Old path as WordPress published it (percent-encoded). */
  from: string
  /** New path (percent-encoded). */
  to: string
  status: 301
  /** `term` is an archive of a custom taxonomy. */
  kind: 'permalink' | 'old-slug' | 'category' | 'tag' | 'term'
  wpId?: number
  wpType?: string
}

export interface RedirectMap {
  redirects: Redirect[]
  warnings: Warning[]
}

/** Paths that must never be redirected away. */
const PROTECTED = /^\/(wp-admin|wp-login\.php|wp-json|xmlrpc\.php|admin|api|_next)(\/|$)/i

const encodeOld = (path: string): string => encodePath(path).replace(/%2F/gi, '/')

/**
 * Old URL → new URL for every published item whose type has a path pattern, for earlier slugs,
 * and for term archives whose taxonomy has one (categories, tags, custom taxonomies). Conflicts
 * are reported and left out rather than guessed.
 */
export const buildRedirects = (index: SiteIndex, urls: SiteUrls): RedirectMap => {
  const warnings: Warning[] = []
  const byFrom = new Map<string, Redirect>()
  const newPaths = new Map<string, number>()
  const conflicted = new Set<number>()

  for (const post of index.posts.values()) {
    const to = urls.newPath(post.id)
    if (to === undefined || post.status !== 'publish') continue
    const key = normalizePath(to)
    const other = newPaths.get(key)
    if (other !== undefined) {
      conflicted.add(post.id)
      warnings.push({
        code: 'REDIRECT_CONFLICT',
        message: `${post.type} ${post.id} and item ${other} both get the new path ${to}; check the path patterns.`,
        wpId: post.id,
        wpType: post.type,
        subject: to,
      })
    } else {
      newPaths.set(key, post.id)
    }
  }

  const add = (redirect: Redirect) => {
    const fromKey = normalizePath(redirect.from)
    if (fromKey === '/' || PROTECTED.test(fromKey)) return
    if (fromKey === normalizePath(redirect.to)) return
    const owner = newPaths.get(fromKey)
    if (owner !== undefined && owner !== redirect.wpId) {
      warnings.push({
        code: 'REDIRECT_CONFLICT',
        message: `Old URL ${redirect.from} is the new URL of item ${owner}; redirect to ${redirect.to} left out.`,
        ...(redirect.wpId === undefined ? {} : { wpId: redirect.wpId }),
        ...(redirect.wpType === undefined ? {} : { wpType: redirect.wpType }),
        subject: redirect.from,
      })
      return
    }
    const existing = byFrom.get(fromKey)
    if (existing) {
      if (existing.to !== redirect.to) {
        warnings.push({
          code: 'REDIRECT_CONFLICT',
          message: `Old URL ${redirect.from} leads to both ${existing.to} and ${redirect.to}; kept the first.`,
          ...(redirect.wpId === undefined ? {} : { wpId: redirect.wpId }),
          subject: redirect.from,
        })
      }
      return
    }
    byFrom.set(fromKey, redirect)
  }

  for (const post of index.posts.values()) {
    const target = urls.newPath(post.id)
    if (target === undefined || conflicted.has(post.id)) continue
    const to = encodePath(target)
    urls.oldPaths(post).forEach((from, i) => {
      add({
        from: encodeOld(from),
        to,
        status: 301,
        kind: i === 0 ? 'permalink' : 'old-slug',
        wpId: post.id,
        wpType: post.type,
      })
    })
  }

  const sitePath = new URL(`${urls.siteUrl}/`).pathname.replace(/\/$/, '')
  for (const term of index.terms) {
    const archive = urls.archives.find((a) => a.taxonomy === term.taxonomy)
    const target = archive ? urls.termPath(term.taxonomy, term.slug) : undefined
    if (!archive || target === undefined) continue
    const oldSlug = archive.nested ? urls.termTree(term.taxonomy, term.slug) : term.slug
    add({
      from: encodeOld(`${sitePath}/${archive.base}/${oldSlug}/`),
      to: encodePath(target),
      status: 301,
      kind:
        term.taxonomy === 'category' ? 'category' : term.taxonomy === 'post_tag' ? 'tag' : 'term',
    })
  }

  const redirects = [...byFrom.values()].sort((a, b) => a.from.localeCompare(b.from))
  return { redirects, warnings }
}
