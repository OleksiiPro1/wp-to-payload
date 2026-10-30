import type { MediaMatcher } from '../content/media-match.js'
import type { WarningCollector } from '../report/warnings.js'
import { decodeEntities } from '../util/entities.js'
import type { WxrItem, WxrSite } from '../wxr/model.js'
import { metaValue } from '../wxr/model.js'

export interface SeoData {
  title?: string
  description?: string
  /** Only set when it points somewhere other than the item's own permalink. */
  canonical?: string
  imageWpId?: number
  noindex?: boolean
  source?: 'yoast' | 'rankmath'
}

export interface SeoContext {
  site: WxrSite
  /** Replaces `%%sep%%` / `%sep%`. Both plugins default to a hyphen. */
  separator: string
  media: MediaMatcher
  /** Names of the item's categories and tags, in export order. */
  categoryNames: string[]
  tagNames: string[]
  authorName: string
  warnings: WarningCollector
}

const formatDate = (value: string): string => {
  const date = new Date(value.replace(' ', 'T'))
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC',
      })
}

const plainExcerpt = (item: WxrItem): string => {
  const text = (item.excerpt || item.content)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/<[^>]+>/g, ' ')
  const clean = decodeEntities(text).replace(/\s+/g, ' ').trim()
  return clean.length > 155 ? `${clean.slice(0, 152).replace(/\s+\S*$/, '')}…` : clean
}

/**
 * Replaces Yoast (`%%name%%`) and Rank Math (`%name%`) variables. Variables that depend on the
 * request (page numbers, the current date, search terms) cannot be resolved from an export and
 * are removed with a warning.
 */
export const replaceSeoVariables = (template: string, item: WxrItem, ctx: SeoContext): string => {
  const values: Record<string, string> = {
    title: decodeEntities(item.title),
    sitename: ctx.site.title,
    sitedesc: ctx.site.description,
    sep: ctx.separator,
    excerpt: plainExcerpt(item),
    excerpt_only: decodeEntities(item.excerpt.replace(/<[^>]+>/g, '')).trim(),
    category: ctx.categoryNames[0] ?? '',
    primary_category: ctx.categoryNames[0] ?? '',
    categories: ctx.categoryNames.join(', '),
    tag: ctx.tagNames.join(', '),
    tags: ctx.tagNames.join(', '),
    date: formatDate(item.postDate),
    modified: formatDate(item.modified),
    id: String(item.id),
    name: ctx.authorName,
    author: ctx.authorName,
    pt_single: item.type === 'page' ? 'Page' : 'Post',
    page: '',
    pagenumber: '',
    pagetotal: '',
  }
  const unresolved = new Set<string>()
  const replace = (whole: string, name: string) => {
    const key = name.toLowerCase()
    if (key in values) return values[key] ?? ''
    unresolved.add(whole)
    return ''
  }
  let text = template.replace(/%%([a-z_]+)%%/gi, replace).replace(/%([a-z_]+)%/gi, replace)
  if (unresolved.size > 0) {
    ctx.warnings.add(
      'SEO_VARIABLE',
      `SEO template variables ${[...unresolved].join(', ')} cannot be resolved from an export and were removed.`,
      [...unresolved].join(','),
    )
  }
  text = decodeEntities(text)
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .trim()
  // A separator left at either end after removing variables.
  const sep = ctx.separator.trim()
  if (sep) {
    const escaped = sep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    text = text.replace(new RegExp(`^(${escaped}\\s*)+|(\\s*${escaped})+$`, 'g'), '').trim()
  }
  return text
}

const imageId = (
  ctx: SeoContext,
  id: string | undefined,
  url: string | undefined,
): number | undefined => {
  if (id && /^\d+$/.test(id) && ctx.media.get(Number(id))) return Number(id)
  return url ? ctx.media.match(url) : undefined
}

const sameUrl = (a: string, b: string): boolean => {
  const norm = (u: string) =>
    u
      .trim()
      .replace(/^https?:\/\/(www\.)?/i, '')
      .replace(/\/+$/, '')
      .toLowerCase()
  return norm(a) === norm(b)
}

/** SEO title, description, canonical and image from Yoast SEO or Rank Math post meta. */
export const extractSeo = (item: WxrItem, ctx: SeoContext): SeoData => {
  const yoast = [...item.meta.keys()].some((k) => k.startsWith('_yoast_wpseo_'))
  const rankmath = [...item.meta.keys()].some((k) => k.startsWith('rank_math_'))
  if (!yoast && !rankmath) return {}

  const get = (key: string) => metaValue(item, key)?.trim() || undefined
  const seo: SeoData = {}
  let title: string | undefined
  let description: string | undefined
  let canonical: string | undefined
  if (yoast) {
    seo.source = 'yoast'
    title = get('_yoast_wpseo_title')
    description = get('_yoast_wpseo_metadesc')
    canonical = get('_yoast_wpseo_canonical')
    seo.imageWpId = imageId(
      ctx,
      get('_yoast_wpseo_opengraph-image-id'),
      get('_yoast_wpseo_opengraph-image'),
    )
    if (get('_yoast_wpseo_meta-robots-noindex') === '1') seo.noindex = true
  } else {
    seo.source = 'rankmath'
    title = get('rank_math_title')
    description = get('rank_math_description')
    canonical = get('rank_math_canonical_url')
    seo.imageWpId = imageId(
      ctx,
      get('rank_math_facebook_image_id'),
      get('rank_math_facebook_image'),
    )
    if (get('rank_math_robots')?.includes('"noindex"')) seo.noindex = true
  }
  if (seo.imageWpId === undefined) delete seo.imageWpId

  if (title) {
    const value = replaceSeoVariables(title, item, ctx)
    if (value) seo.title = value
  }
  if (description) {
    const value = replaceSeoVariables(description, item, ctx)
    if (value) seo.description = value
  }
  if (canonical && !sameUrl(canonical, item.link)) seo.canonical = canonical
  return seo
}
