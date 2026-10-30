import { createReadStream } from 'node:fs'
import type { Readable } from 'node:stream'
import sax from 'sax'
import { decodeEntities } from '../util/entities.js'
import type { WxrAuthor, WxrItem, WxrParseIssue, WxrRecord, WxrSite, WxrTerm } from './model.js'

export interface ReadWxrOptions {
  /** Called for each recoverable XML error. The reader skips the broken part and continues. */
  onIssue?: (issue: WxrParseIssue) => void
}

/** Maps namespace URIs to the prefixes WordPress uses, so other prefixes work too. */
const canonicalPrefix = (uri: string, prefix: string): string => {
  if (uri === '') return ''
  if (/^https?:\/\/wordpress\.org\/export\/[\d.]+\/excerpt\/?$/.test(uri)) return 'excerpt'
  if (/^https?:\/\/wordpress\.org\/export\/[\d.]+\/?$/.test(uri)) return 'wp'
  if (uri === 'http://purl.org/rss/1.0/modules/content/') return 'content'
  if (uri === 'http://purl.org/dc/elements/1.1/') return 'dc'
  return prefix
}

const toInt = (value: string | undefined): number => {
  const n = Number.parseInt((value ?? '').trim(), 10)
  return Number.isFinite(n) ? n : 0
}

const optionalInt = (value: string | undefined): number | undefined => {
  const n = Number.parseInt((value ?? '').trim(), 10)
  return Number.isFinite(n) ? n : undefined
}

const nonEmpty = (value: string | undefined): string | undefined => {
  const v = value?.trim()
  return v ? v : undefined
}

interface Frame {
  name: string
  attributes: Record<string, string>
  text: string
}

type Fields = Map<string, string>

const emptySite = (): WxrSite => ({
  title: '',
  link: '',
  description: '',
  language: '',
  wxrVersion: '',
  baseSiteUrl: '',
  baseBlogUrl: '',
  generator: '',
})

const SITE_FIELDS: Record<string, keyof WxrSite> = {
  title: 'title',
  link: 'link',
  description: 'description',
  language: 'language',
  generator: 'generator',
  'wp:wxr_version': 'wxrVersion',
  'wp:base_site_url': 'baseSiteUrl',
  'wp:base_blog_url': 'baseBlogUrl',
}

const TERM_ELEMENTS = new Set(['wp:category', 'wp:tag', 'wp:term'])

const buildAuthor = (f: Fields): WxrAuthor | undefined => {
  const login = nonEmpty(f.get('wp:author_login'))
  if (!login) return undefined
  const author: WxrAuthor = {
    login,
    displayName: nonEmpty(f.get('wp:author_display_name')) ?? login,
  }
  const id = optionalInt(f.get('wp:author_id'))
  if (id !== undefined) author.id = id
  const email = nonEmpty(f.get('wp:author_email'))
  if (email) author.email = email
  const firstName = nonEmpty(f.get('wp:author_first_name'))
  if (firstName) author.firstName = firstName
  const lastName = nonEmpty(f.get('wp:author_last_name'))
  if (lastName) author.lastName = lastName
  return author
}

const buildTerm = (element: string, f: Fields): WxrTerm | undefined => {
  let taxonomy: string
  let slug: string | undefined
  let name: string | undefined
  let parentSlug: string | undefined
  let description: string | undefined
  if (element === 'wp:category') {
    taxonomy = 'category'
    slug = nonEmpty(f.get('wp:category_nicename'))
    name = f.get('wp:cat_name')
    parentSlug = nonEmpty(f.get('wp:category_parent'))
    description = nonEmpty(f.get('wp:category_description'))
  } else if (element === 'wp:tag') {
    taxonomy = 'post_tag'
    slug = nonEmpty(f.get('wp:tag_slug'))
    name = f.get('wp:tag_name')
    description = nonEmpty(f.get('wp:tag_description'))
  } else {
    taxonomy = nonEmpty(f.get('wp:term_taxonomy')) ?? 'unknown'
    slug = nonEmpty(f.get('wp:term_slug'))
    name = f.get('wp:term_name')
    parentSlug = nonEmpty(f.get('wp:term_parent'))
    description = nonEmpty(f.get('wp:term_description'))
  }
  if (!slug) return undefined
  // WordPress stores term names HTML-escaped (`Recipes &amp; Baking`).
  const term: WxrTerm = { taxonomy, slug, name: decodeEntities(name?.trim() ?? '') || slug }
  const id = optionalInt(f.get('wp:term_id'))
  if (id !== undefined) term.id = id
  if (parentSlug) term.parentSlug = parentSlug
  if (description) term.description = description
  return term
}

const newItem = (): WxrItem => ({
  id: 0,
  title: '',
  link: '',
  guid: '',
  pubDate: '',
  creator: '',
  content: '',
  excerpt: '',
  postDate: '',
  postDateGmt: '',
  modified: '',
  modifiedGmt: '',
  slug: '',
  status: '',
  parentId: 0,
  menuOrder: 0,
  type: '',
  hasPassword: false,
  isSticky: false,
  terms: [],
  meta: new Map(),
  commentCount: 0,
})

const applyItemField = (item: WxrItem, name: string, text: string): void => {
  switch (name) {
    case 'title':
      item.title = text.trim()
      break
    case 'link':
      item.link = text.trim()
      break
    case 'guid':
      item.guid = text.trim()
      break
    case 'pubDate':
      item.pubDate = text.trim()
      break
    case 'dc:creator':
      item.creator = text.trim()
      break
    case 'content:encoded':
      item.content = text
      break
    case 'excerpt:encoded':
      item.excerpt = text
      break
    case 'wp:post_id':
      item.id = toInt(text)
      break
    case 'wp:post_date':
      item.postDate = text.trim()
      break
    case 'wp:post_date_gmt':
      item.postDateGmt = text.trim()
      break
    case 'wp:post_modified':
      item.modified = text.trim()
      break
    case 'wp:post_modified_gmt':
      item.modifiedGmt = text.trim()
      break
    case 'wp:post_name':
      item.slug = text.trim()
      break
    case 'wp:status':
      item.status = text.trim()
      break
    case 'wp:post_parent':
      item.parentId = toInt(text)
      break
    case 'wp:menu_order':
      item.menuOrder = toInt(text)
      break
    case 'wp:post_type':
      item.type = text.trim()
      break
    case 'wp:post_password':
      // Only whether a password exists is kept; the password itself is never stored.
      item.hasPassword = text.trim() !== ''
      break
    case 'wp:is_sticky':
      item.isSticky = text.trim() === '1'
      break
    case 'wp:attachment_url': {
      const url = text.trim()
      if (url) item.attachmentUrl = url
      break
    }
  }
}

/**
 * Streams a WXR file and yields its channel, authors, terms and items one at a time, so files of
 * hundreds of megabytes are read with bounded memory. Recoverable XML errors are reported through
 * `onIssue` and skipped.
 */
export async function* readWxr(
  source: string | Readable,
  options: ReadWxrOptions = {},
): AsyncGenerator<WxrRecord> {
  const parser = sax.parser(true, { xmlns: true, position: true })
  const queue: WxrRecord[] = []
  const stack: Frame[] = []

  let site: WxrSite | undefined = emptySite()
  let fields: Fields | undefined
  let item: WxrItem | undefined
  let metaKey: string | undefined
  let metaValue: string | undefined
  let commentDepth = 0

  const flushSite = () => {
    if (site) {
      queue.push({ kind: 'site', site })
      site = undefined
    }
  }

  parser.onerror = (error) => {
    const message = error.message.split('\n')[0] ?? error.message
    options.onIssue?.({ line: parser.line + 1, column: parser.column + 1, message })
    // sax stops on errors in strict mode; clearing the error lets it continue.
    ;(parser as unknown as { error: Error | null }).error = null
  }

  parser.onopentag = (node) => {
    const tag = node as sax.QualifiedTag
    const prefix = canonicalPrefix(tag.uri, tag.prefix)
    const name = prefix ? `${prefix}:${tag.local}` : tag.local
    const attributes: Record<string, string> = {}
    for (const [key, attr] of Object.entries(tag.attributes)) attributes[key] = attr.value
    const parent = stack[stack.length - 1]?.name
    stack.push({ name, attributes, text: '' })

    if (commentDepth > 0 || name === 'wp:comment') {
      commentDepth++
      return
    }
    if (parent === 'channel') {
      if (name === 'item') {
        flushSite()
        item = newItem()
      } else if (name === 'wp:author' || TERM_ELEMENTS.has(name)) {
        fields = new Map()
      }
    }
  }

  const appendText = (text: string) => {
    if (commentDepth > 0) return
    const frame = stack[stack.length - 1]
    if (frame) frame.text += text
  }
  parser.ontext = appendText
  parser.oncdata = appendText

  parser.onclosetag = () => {
    const frame = stack.pop()
    if (!frame) return
    const parent = stack[stack.length - 1]?.name
    const { name, text } = frame

    if (commentDepth > 0) {
      commentDepth--
      if (commentDepth === 0 && item) item.commentCount++
      return
    }

    if (parent === 'channel') {
      if (name === 'item' && item) {
        queue.push({ kind: 'item', item })
        item = undefined
      } else if (name === 'wp:author' && fields) {
        const author = buildAuthor(fields)
        if (author) queue.push({ kind: 'author', author })
        fields = undefined
      } else if (TERM_ELEMENTS.has(name) && fields) {
        const term = buildTerm(name, fields)
        if (term) queue.push({ kind: 'term', term })
        fields = undefined
      } else if (site && name in SITE_FIELDS) {
        site[SITE_FIELDS[name] as keyof WxrSite] = text.trim()
      }
      return
    }
    if (name === 'channel') {
      flushSite()
      return
    }

    if (fields && (parent === 'wp:author' || TERM_ELEMENTS.has(parent ?? ''))) {
      fields.set(name, text)
      return
    }

    if (item) {
      if (parent === 'item') {
        if (name === 'category') {
          const slug = frame.attributes.nicename?.trim()
          const taxonomy = frame.attributes.domain?.trim()
          if (slug && taxonomy) {
            item.terms.push({ taxonomy, slug, name: decodeEntities(text.trim()) || slug })
          }
        } else if (name === 'wp:postmeta') {
          if (metaKey !== undefined) {
            const values = item.meta.get(metaKey)
            if (values) values.push(metaValue ?? '')
            else item.meta.set(metaKey, [metaValue ?? ''])
          }
          metaKey = undefined
          metaValue = undefined
        } else {
          applyItemField(item, name, text)
        }
      } else if (parent === 'wp:postmeta') {
        if (name === 'wp:meta_key') metaKey = text.trim()
        else if (name === 'wp:meta_value') metaValue = text
      }
    }
  }

  const stream =
    typeof source === 'string'
      ? createReadStream(source, { encoding: 'utf8', highWaterMark: 1 << 16 })
      : source
  if (typeof source !== 'string') stream.setEncoding('utf8')

  let first = true
  for await (const chunk of stream as AsyncIterable<string>) {
    let text = chunk
    if (first) {
      first = false
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
    }
    parser.write(text)
    while (queue.length > 0) yield queue.shift() as WxrRecord
  }
  parser.close()
  flushSite()
  while (queue.length > 0) yield queue.shift() as WxrRecord
}
