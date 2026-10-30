/** Data read from a WordPress eXtended RSS (WXR) export file. Field names follow WordPress. */

export interface WxrSite {
  title: string
  link: string
  description: string
  language: string
  wxrVersion: string
  /** `wp:base_site_url`: the network root on multisite, otherwise the site URL. */
  baseSiteUrl: string
  /** `wp:base_blog_url`: the URL of the exported site. */
  baseBlogUrl: string
  generator: string
}

export interface WxrAuthor {
  id?: number
  login: string
  email?: string
  displayName: string
  firstName?: string
  lastName?: string
}

export interface WxrTerm {
  id?: number
  /** `category`, `post_tag`, `nav_menu` or a custom taxonomy. */
  taxonomy: string
  slug: string
  name: string
  /** WXR references the parent by slug, not by ID. */
  parentSlug?: string
  description?: string
  /** Term meta (`wp:termmeta`), for example ACF fields of a category. */
  meta: Map<string, string[]>
}

/** A term assigned to an item (`<category domain="…" nicename="…">`). */
export interface WxrItemTerm {
  taxonomy: string
  slug: string
  name: string
}

export interface WxrItem {
  id: number
  title: string
  link: string
  guid: string
  pubDate: string
  /** Author login (`dc:creator`). */
  creator: string
  content: string
  excerpt: string
  /** Local time, `YYYY-MM-DD HH:MM:SS`. */
  postDate: string
  /** UTC, `YYYY-MM-DD HH:MM:SS`, or `0000-00-00 00:00:00` for unpublished items. */
  postDateGmt: string
  modified: string
  modifiedGmt: string
  slug: string
  status: string
  parentId: number
  menuOrder: number
  type: string
  hasPassword: boolean
  isSticky: boolean
  attachmentUrl?: string
  terms: WxrItemTerm[]
  /** Post meta. A key can have several values (for example `_wp_old_slug`). */
  meta: Map<string, string[]>
  commentCount: number
}

export type WxrRecord =
  | { kind: 'site'; site: WxrSite }
  | { kind: 'author'; author: WxrAuthor }
  | { kind: 'term'; term: WxrTerm }
  | { kind: 'item'; item: WxrItem }

/** A recoverable problem in the XML (the reader skips over it and continues). */
export interface WxrParseIssue {
  line: number
  column: number
  message: string
}

export const metaValue = (item: Pick<WxrItem, 'meta'>, key: string): string | undefined =>
  item.meta.get(key)?.[0]
