import type { Readable } from 'node:stream'
import { decodeEntities } from '../util/entities.js'
import { mimeTypeOf } from '../util/mime.js'
import { slugify } from '../util/slug.js'
import type { WxrAuthor, WxrItem, WxrItemTerm, WxrParseIssue, WxrSite, WxrTerm } from './model.js'
import { metaValue } from './model.js'
import { readWxr } from './reader.js'

export interface IndexedAttachment {
  id: number
  url: string
  /** Path relative to `wp-content/uploads` (`_wp_attached_file`). */
  file?: string
  filename: string
  mimeType: string
  title: string
  alt?: string
  caption?: string
  parentId: number
}

/** Everything about a post or page except its content, enough to resolve links and redirects. */
export interface IndexedPost {
  id: number
  type: string
  status: string
  slug: string
  /** True when WordPress had no slug (drafts) and it was derived from the title. */
  slugDerived: boolean
  title: string
  parentId: number
  link: string
  postDate: string
  postDateGmt: string
  authorLogin: string
  terms: WxrItemTerm[]
  oldSlugs: string[]
}

export interface SiteIndex {
  site: WxrSite
  authors: Map<string, WxrAuthor>
  terms: WxrTerm[]
  attachments: Map<number, IndexedAttachment>
  posts: Map<number, IndexedPost>
  issues: WxrParseIssue[]
}

const emptySite: WxrSite = {
  title: '',
  link: '',
  description: '',
  language: '',
  wxrVersion: '',
  baseSiteUrl: '',
  baseBlogUrl: '',
  generator: '',
}

const filenameOf = (url: string): string => {
  const path = url.split(/[?#]/)[0] ?? ''
  return decodeURIComponent(path.split('/').pop() ?? '') || 'file'
}

export const indexAttachment = (item: WxrItem): IndexedAttachment | undefined => {
  const url = item.attachmentUrl ?? (item.guid.includes('/wp-content/') ? item.guid : undefined)
  if (!url) return undefined
  const attachment: IndexedAttachment = {
    id: item.id,
    url,
    filename: filenameOf(url),
    mimeType: mimeTypeOf(url),
    title: decodeEntities(item.title),
    parentId: item.parentId,
  }
  const file = metaValue(item, '_wp_attached_file')
  if (file) attachment.file = file
  const alt = metaValue(item, '_wp_attachment_image_alt')?.trim()
  if (alt) attachment.alt = alt
  const caption = item.excerpt.trim()
  if (caption) attachment.caption = caption
  return attachment
}

export const indexPost = (item: WxrItem): IndexedPost => {
  const slug = item.slug ? safeDecode(item.slug) : slugify(decodeEntities(item.title))
  return {
    id: item.id,
    type: item.type,
    status: item.status,
    slug: slug || `${item.type}-${item.id}`,
    slugDerived: !item.slug,
    title: item.title,
    parentId: item.parentId,
    link: item.link,
    postDate: item.postDate,
    postDateGmt: item.postDateGmt,
    authorLogin: item.creator,
    terms: item.terms,
    oldSlugs: (item.meta.get('_wp_old_slug') ?? [])
      .map((s) => safeDecode(s.trim()))
      .filter(Boolean),
  }
}

/** WordPress stores non-ASCII slugs percent-encoded. */
const safeDecode = (value: string): string => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** Item types that are never content: menus, revisions and editor internals. */
export const INTERNAL_TYPES = new Set([
  'nav_menu_item',
  'revision',
  'customize_changeset',
  'custom_css',
  'oembed_cache',
  'user_request',
  'wp_block',
  'wp_template',
  'wp_template_part',
  'wp_global_styles',
  'wp_navigation',
  'wp_font_family',
  'wp_font_face',
])

/** First pass over an export: everything except post bodies, so memory stays small. */
export const buildSiteIndex = async (file: string | Readable): Promise<SiteIndex> => {
  const index: SiteIndex = {
    site: { ...emptySite },
    authors: new Map(),
    terms: [],
    attachments: new Map(),
    posts: new Map(),
    issues: [],
  }
  for await (const record of readWxr(file, { onIssue: (i) => index.issues.push(i) })) {
    switch (record.kind) {
      case 'site':
        index.site = record.site
        break
      case 'author':
        index.authors.set(record.author.login, record.author)
        break
      case 'term':
        index.terms.push(record.term)
        break
      case 'item': {
        const { item } = record
        if (item.type === 'attachment') {
          const attachment = indexAttachment(item)
          if (attachment) index.attachments.set(item.id, attachment)
        } else if (!INTERNAL_TYPES.has(item.type)) {
          index.posts.set(item.id, indexPost(item))
        }
        break
      }
    }
  }
  return index
}

/** The site URL to treat as "internal": the blog URL, falling back to the channel link. */
export const siteUrlOf = (site: WxrSite): string =>
  (site.baseBlogUrl || site.link || site.baseSiteUrl).replace(/\/+$/, '')
