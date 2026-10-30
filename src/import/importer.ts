import { detectBuilders } from '../content/builders.js'
import { MediaMatcher } from '../content/media-match.js'
import { prepareContent } from '../content/pipeline.js'
import type { ContentContext } from '../content/types.js'
import type { Config } from '../config.js'
import { SiteUrls } from '../paths/site-urls.js'
import { buildRedirects } from '../redirects/build.js'
import { type Warning, WarningCollector } from '../report/warnings.js'
import { extractSeo } from '../seo/seo.js'
import { decodeEntities } from '../util/entities.js'
import { slugify } from '../util/slug.js'
import { metaValue, type WxrItem, type WxrTerm } from '../wxr/model.js'
import { readWxr } from '../wxr/reader.js'
import { buildSiteIndex, type IndexedAttachment, type SiteIndex } from '../wxr/site-index.js'
import { htmlToLexical, isEmptyState } from './lexical.js'
import { type Phase, PHASES } from './phases.js'
import { MediaSource } from './media.js'
import type {
  DocId,
  LexicalModule,
  PayloadDoc,
  PayloadLike,
  SanitizedEditorConfig,
} from './payload-types.js'
import { CollectionSchema, describeEditor, type EditorInfo } from './schema.js'

export { type Phase, PHASES }

export interface ImportOptions {
  file: string
  config: Config
  uploadsDir?: string
  /** Use only `uploadsDir`; never download media. */
  offline: boolean
  dryRun: boolean
  /** Phases to run. Redirects run only when listed here or with `writeRedirects`. */
  only: Phase[]
  writeRedirects: boolean
  /** Write at most this many posts and this many pages. */
  limit?: number
  concurrency: number
  refreshMedia: boolean
  mediaHosts: string[]
  maxMediaBytes: number
  fetchImpl?: typeof fetch
  log: (line: string) => void
}

export interface PhaseResult {
  created: number
  updated: number
  skipped: number
  failed: number
}

export interface ImportError {
  phase: Phase
  wpId?: number
  message: string
}

export interface ImportResult {
  dryRun: boolean
  phases: Record<Phase, PhaseResult>
  errors: ImportError[]
  warnings: Warning[]
  durationMs: number
}

export class ImportSetupError extends Error {
  override name = 'ImportSetupError'
}

const IMPORTED_STATUSES = new Set(['publish', 'draft', 'pending', 'private', 'future'])
const WRITE_CONTEXT = { wpToPayload: true, disableRevalidate: true }

const toIso = (value: string): string | undefined => {
  if (!value || value.startsWith('0000')) return undefined
  const date = new Date(`${value.replace(' ', 'T')}Z`)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

const plainText = (html: string): string =>
  decodeEntities(html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()

const errorMessage = (error: unknown): string => {
  const e = error as { message?: string; data?: { errors?: { path?: string; message?: string }[] } }
  const details = e.data?.errors?.map((x) => `${x.path ?? '?'}: ${x.message ?? ''}`).join('; ')
  return details ? `${e.message ?? 'error'} (${details})` : (e.message ?? String(error))
}

/** Parents before children, so parent references can be set on create. */
const sortByParent = (terms: WxrTerm[]): WxrTerm[] => {
  const bySlug = new Map(terms.map((t) => [t.slug, t]))
  const done = new Set<string>()
  const out: WxrTerm[] = []
  const visit = (term: WxrTerm, seen: Set<string>) => {
    if (done.has(term.slug) || seen.has(term.slug)) return
    seen.add(term.slug)
    const parent = term.parentSlug ? bySlug.get(term.parentSlug) : undefined
    if (parent) visit(parent, seen)
    done.add(term.slug)
    out.push(term)
  }
  for (const term of terms) visit(term, new Set())
  return out
}

/** How an imported document is found again: its WordPress ID, or its slug when there is none. */
type DocKey = number | { slug: string }

const emptyPhase = (): PhaseResult => ({ created: 0, updated: 0, skipped: 0, failed: 0 })

/**
 * Imports a WXR export into Payload through the Local API. Every document carries its WordPress
 * ID in `wpId`, so running the import again updates documents instead of duplicating them.
 */
export const importExport = async (
  payload: PayloadLike,
  lexical: LexicalModule,
  options: ImportOptions,
): Promise<ImportResult> => {
  const started = Date.now()
  const { config, log } = options
  const f = config.fields
  const slugs = config.collections
  const result: ImportResult = {
    dryRun: options.dryRun,
    phases: Object.fromEntries(PHASES.map((p) => [p, emptyPhase()])) as Record<Phase, PhaseResult>,
    errors: [],
    warnings: [],
    durationMs: 0,
  }
  const warnings = new WarningCollector()
  const missingReported = new Set<string>()
  const reportMissing = (collection: string, fields: string[]) => {
    for (const field of fields) {
      const key = `${collection}.${field}`
      if (missingReported.has(key)) continue
      missingReported.add(key)
      warnings.add(
        'FIELD_MISSING',
        `Collection "${collection}" has no field "${field}"; that data was not imported.`,
        key,
      )
    }
  }

  log(`Reading ${options.file}`)
  const index: SiteIndex = await buildSiteIndex(options.file)
  if (index.issues.length > 0) {
    warnings.add(
      'XML_ERROR',
      `${index.issues.length} XML errors in the export were skipped; run analyze for details.`,
    )
  }
  const urls = new SiteUrls(index, { patterns: config.paths, extraHosts: config.siteHosts })
  const matcher = new MediaMatcher(index.attachments)
  const attachmentsByParent = new Map<number, IndexedAttachment[]>()
  for (const a of index.attachments.values()) {
    const list = attachmentsByParent.get(a.parentId) ?? []
    list.push(a)
    attachmentsByParent.set(a.parentId, list)
  }

  // Which phases run, and the collections they write to.
  const selected = new Set<Phase>(
    options.only.length > 0 ? options.only : PHASES.filter((p) => p !== 'redirects'),
  )
  if (options.writeRedirects) selected.add('redirects')
  const phaseCollection: Record<Phase, string> = {
    media: slugs.media,
    categories: slugs.categories,
    tags: slugs.tags,
    authors: slugs.authors,
    posts: slugs.posts,
    pages: slugs.pages,
    redirects: slugs.redirects,
  }
  const schemas = new Map<string, CollectionSchema>()
  const schemaOf = (slug: string): CollectionSchema | undefined => {
    if (schemas.has(slug)) return schemas.get(slug)
    const collection = payload.collections[slug]
    const schema = collection ? new CollectionSchema(collection) : undefined
    if (schema) schemas.set(slug, schema)
    return schema
  }

  const problems: string[] = []
  for (const phase of PHASES) {
    if (!selected.has(phase)) continue
    const slug = phaseCollection[phase]
    const schema = schemaOf(slug)
    if (!schema) {
      selected.delete(phase)
      log(`Skipping ${phase}: there is no collection "${slug}"`)
      continue
    }
    if (phase === 'redirects') {
      if (!schema.has('from') || !schema.has('to'))
        problems.push(`"${slug}" is not a redirects plugin collection (no from/to fields)`)
      continue
    }
    if (!schema.has(f.wpId))
      problems.push(`collection "${slug}" has no "${f.wpId}" field (add it, see \`scaffold\`)`)
    if (phase === 'media' && !schema.isUpload)
      problems.push(`collection "${slug}" is not an upload collection`)
    if (phase === 'authors' && schema.isAuth) {
      selected.delete(phase)
      warnings.add(
        'FIELD_MISSING',
        `Collection "${slug}" is an auth collection; authors were not imported (they would need passwords).`,
        slug,
      )
    }
  }
  if (problems.length > 0)
    throw new ImportSetupError(`Payload schema does not fit:\n  - ${problems.join('\n  - ')}`)
  if (selected.size === 0)
    throw new ImportSetupError(
      'none of the target collections exist; run `wp-to-payload scaffold` first',
    )

  const mediaIdType: 'number' | 'text' = (() => {
    const db = (payload as { db?: { defaultIDType?: string } }).db
    return db?.defaultIDType === 'text' ? 'text' : 'number'
  })()

  // Existing documents by WordPress ID: this is what makes the import repeatable.
  const existing = new Map<string, Map<number, DocId>>()
  const loadExisting = async (slug: string): Promise<Map<number, DocId>> => {
    const cached = existing.get(slug)
    if (cached) return cached
    const map = new Map<number, DocId>()
    const schema = schemaOf(slug)
    if (schema?.has(f.wpId)) {
      const found = await payload.find({
        collection: slug,
        where: { [f.wpId]: { exists: true } },
        pagination: false,
        depth: 0,
        draft: schema.hasDrafts,
        select: { [f.wpId]: true },
        overrideAccess: true,
      })
      for (const doc of found.docs) {
        const wpId = Number(doc[f.wpId])
        if (Number.isFinite(wpId) && !map.has(wpId)) map.set(wpId, doc.id)
      }
    }
    existing.set(slug, map)
    return map
  }

  // Some exports (WordPress.com) have authors or terms without IDs; those are matched by slug.
  const bySlug = new Map<string, Map<string, DocId>>()
  const findBySlug = async (
    schema: CollectionSchema,
    value: string,
  ): Promise<DocId | undefined> => {
    const cache = bySlug.get(schema.slug) ?? new Map<string, DocId>()
    bySlug.set(schema.slug, cache)
    if (cache.has(value)) return cache.get(value)
    if (!schema.has('slug')) return undefined
    const found = await payload.find({
      collection: schema.slug,
      where: { slug: { equals: value } },
      limit: 1,
      depth: 0,
      draft: schema.hasDrafts,
      overrideAccess: true,
    })
    const id = found.docs[0]?.id
    if (id !== undefined) cache.set(value, id)
    return id
  }

  /** The Payload ID of an already imported document, by WordPress ID or by slug. */
  const existingId = async (schema: CollectionSchema, key: DocKey): Promise<DocId | undefined> =>
    typeof key === 'number'
      ? (await loadExisting(schema.slug)).get(key)
      : findBySlug(schema, key.slug)

  /** Creates or updates the document with this WordPress ID (or slug). Returns its Payload ID. */
  const upsert = async (
    phase: Phase,
    schema: CollectionSchema,
    key: DocKey,
    raw: Record<string, unknown>,
    extra: { draft?: boolean; file?: Parameters<PayloadLike['create']>[0]['file'] } = {},
  ): Promise<DocId | undefined> => {
    const stats = result.phases[phase]
    const { data, missing } = schema.filter(raw)
    reportMissing(schema.slug, missing)
    const id = await existingId(schema, key)
    const wpId = typeof key === 'number' ? key : undefined
    if (options.dryRun) {
      if (id === undefined) stats.created++
      else stats.updated++
      return id ?? `dry-run-${typeof key === 'number' ? key : key.slug}`
    }
    try {
      const args = {
        collection: schema.slug,
        data,
        depth: 0,
        overrideAccess: true,
        context: WRITE_CONTEXT,
        ...(extra.draft !== undefined && schema.hasDrafts ? { draft: extra.draft } : {}),
        ...(extra.file ? { file: extra.file } : {}),
      }
      let doc: PayloadDoc
      if (id === undefined) {
        doc = await payload.create(args)
        if (typeof key === 'number') (await loadExisting(schema.slug)).set(key, doc.id)
        else bySlug.get(schema.slug)?.set(key.slug, doc.id)
        stats.created++
      } else {
        doc = await payload.update({ ...args, id })
        stats.updated++
      }
      return doc.id
    } catch (error) {
      stats.failed++
      result.errors.push({
        phase,
        ...(wpId === undefined ? {} : { wpId }),
        message: errorMessage(error),
      })
      return id
    }
  }

  const progress = (phase: Phase, done: number, total: number) => {
    if (done === total || done % 50 === 0) log(`  ${phase}: ${done}/${total}`)
  }

  // Media ------------------------------------------------------------------------------------
  const mediaIds = new Map<number, DocId>()
  if (selected.has('media')) {
    const schema = schemaOf(slugs.media) as CollectionSchema
    const ids = await loadExisting(schema.slug)
    const source = new MediaSource({
      ...(options.uploadsDir ? { uploadsDir: options.uploadsDir } : {}),
      allowedHosts: [
        ...new Set([
          ...[urls.siteUrl, index.site.baseSiteUrl, index.site.link]
            .map((u) => {
              try {
                return new URL(u).host
              } catch {
                return ''
              }
            })
            .filter(Boolean),
          ...config.siteHosts,
          ...config.media.hosts,
          ...options.mediaHosts,
        ]),
      ],
      offline: options.offline,
      timeoutMs: 60_000,
      maxBytes: options.maxMediaBytes,
      retries: 2,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    })
    const attachments = [...index.attachments.values()]
    log(`Media: ${attachments.length} files`)
    let done = 0
    for (let i = 0; i < attachments.length; i += options.concurrency) {
      const batch = attachments.slice(i, i + options.concurrency)
      const files = await Promise.all(
        batch.map((a) => {
          const needsFile = !ids.has(a.id) || options.refreshMedia
          return needsFile && !options.dryRun ? source.get(a) : Promise.resolve(undefined)
        }),
      )
      for (const [n, a] of batch.entries()) {
        const fileResult = files[n]
        const data = {
          alt: a.alt || decodeEntities(a.title) || a.filename,
          caption: a.caption ? plainText(a.caption) : undefined,
          [f.wpId]: a.id,
        }
        const media = warnings.for({ wpId: a.id, wpType: 'attachment' })
        if (fileResult && !fileResult.ok) {
          if (fileResult.skipped) {
            result.phases.media.skipped++
            media.add('MEDIA_SKIPPED', `${a.url} skipped: ${fileResult.reason}`, a.url)
          } else {
            result.phases.media.failed++
            media.add('MEDIA_FAILED', `${a.url} not imported: ${fileResult.reason}`, a.url)
          }
          const kept = ids.get(a.id)
          if (kept !== undefined) mediaIds.set(a.id, kept)
        } else {
          const id = await upsert(
            'media',
            schema,
            a.id,
            data,
            fileResult?.ok ? { file: fileResult.file } : {},
          )
          if (id !== undefined) mediaIds.set(a.id, id)
        }
        progress('media', ++done, attachments.length)
      }
    }
  } else if (schemaOf(slugs.media)?.has(f.wpId)) {
    for (const [wpId, id] of await loadExisting(slugs.media)) mediaIds.set(wpId, id)
  }

  // Terms ------------------------------------------------------------------------------------
  const termIds = new Map<string, DocId>()
  const termKey = (taxonomy: string, slug: string) => `${taxonomy}:${slug}`
  const importTerms = async (phase: 'categories' | 'tags', taxonomy: 'category' | 'post_tag') => {
    const slug = phaseCollection[phase]
    const schema = schemaOf(slug)
    if (!schema?.has(f.wpId)) return
    const terms = index.terms.filter((t) => t.taxonomy === taxonomy)
    // A term ID used by two different terms cannot identify either; fall back to the slug.
    const idOwners = new Map<number, string>()
    const keyOf = (term: WxrTerm): DocKey => {
      if (term.id === undefined) return { slug: term.slug }
      const owner = idOwners.get(term.id)
      if (owner === undefined) idOwners.set(term.id, term.slug)
      return owner === undefined || owner === term.slug ? term.id : { slug: term.slug }
    }
    if (!selected.has(phase)) {
      for (const t of terms) {
        const id = await existingId(schema, keyOf(t))
        if (id !== undefined) termIds.set(termKey(taxonomy, t.slug), id)
      }
      return
    }
    log(`${phase === 'categories' ? 'Categories' : 'Tags'}: ${terms.length}`)
    let done = 0
    for (const term of taxonomy === 'category' ? sortByParent(terms) : terms) {
      done++
      const key = keyOf(term)
      const parentId = term.parentSlug ? termIds.get(termKey(taxonomy, term.parentSlug)) : undefined
      const data: Record<string, unknown> = {
        title: term.name,
        slug: term.slug,
        description: term.description,
        [f.wpId]: typeof key === 'number' ? key : undefined,
      }
      if (parentId !== undefined && schema.relatesTo('parent', slug)) {
        data.parent = schema.relationValue('parent', slug, [parentId])
      }
      const id = await upsert(phase, schema, key, data)
      if (id !== undefined) termIds.set(termKey(taxonomy, term.slug), id)
      progress(phase, done, terms.length)
    }
  }
  await importTerms('categories', 'category')
  await importTerms('tags', 'post_tag')

  // Authors ----------------------------------------------------------------------------------
  const authorIds = new Map<string, DocId>()
  {
    const schema = schemaOf(slugs.authors)
    if (schema?.has(f.wpId)) {
      const authors = [...index.authors.values()]
      if (selected.has('authors')) log(`Authors: ${authors.length}`)
      for (const author of authors) {
        const slug = slugify(author.login) || `author-${author.id ?? authors.indexOf(author) + 1}`
        const key: DocKey = author.id ?? { slug }
        if (!selected.has('authors')) {
          const id = await existingId(schema, key)
          if (id !== undefined) authorIds.set(author.login, id)
          continue
        }
        const data = {
          name: author.displayName,
          slug,
          email: config.importAuthorEmails ? author.email : undefined,
          [f.wpId]: author.id,
        }
        const id = await upsert('authors', schema, key, data)
        if (id !== undefined) authorIds.set(author.login, id)
      }
    }
  }

  // Posts and pages --------------------------------------------------------------------------
  const docIds = new Map<number, { collection: string; id: DocId }>()
  const pageStatus = new Map<number, string>()
  const editors = new Map<string, { config: SanitizedEditorConfig; info: EditorInfo }>()
  const editorFor = (schema: CollectionSchema) => {
    if (editors.has(schema.slug)) return editors.get(schema.slug)
    const field = schema.field(f.content)
    if (!field || field.type !== 'richText') return undefined
    const editorConfig = lexical.editorConfigFactory.fromField({ field })
    const entry = { config: editorConfig, info: describeEditor(editorConfig) }
    editors.set(schema.slug, entry)
    return entry
  }

  // Duplicate post slugs (possible for drafts) get the WordPress ID appended.
  const postSlugs = new Map<number, string>()
  {
    const seen = new Map<string, number>()
    for (const post of index.posts.values()) {
      if (post.type !== 'post' || !IMPORTED_STATUSES.has(post.status)) continue
      const other = seen.get(post.slug)
      if (other === undefined) {
        seen.set(post.slug, post.id)
        postSlugs.set(post.id, post.slug)
      } else {
        postSlugs.set(post.id, `${post.slug}-${post.id}`)
        warnings
          .for({ wpId: post.id, wpType: 'post' })
          .add(
            'REFERENCE_MISSING',
            `Slug "${post.slug}" is also used by post ${other}; this post got "${post.slug}-${post.id}".`,
            post.slug,
          )
      }
    }
  }

  const termIdsOf = (item: WxrItem, taxonomy: string): DocId[] =>
    item.terms
      .filter((t) => t.taxonomy === taxonomy)
      .map((t) => termIds.get(termKey(taxonomy, t.slug)))
      .filter((id): id is DocId => id !== undefined)

  const buildDocument = (
    item: WxrItem,
    schema: CollectionSchema,
  ): { data: Record<string, unknown>; draft: boolean } => {
    const itemWarnings = warnings.for({ wpId: item.id, wpType: item.type })
    const published = item.status === 'publish' && !item.hasPassword
    if (item.hasPassword) {
      itemWarnings.add(
        'ELEMENT_REMOVED',
        'The item was password protected; it was imported as a draft.',
        'password',
      )
    }
    const data: Record<string, unknown> = {
      [f.title]: decodeEntities(item.title) || `Untitled ${item.type} ${item.id}`,
      [f.slug]: item.type === 'post' ? postSlugs.get(item.id) : index.posts.get(item.id)?.slug,
      [f.excerpt]: plainText(item.excerpt) || undefined,
      [f.publishedAt]: toIso(item.postDateGmt) ?? toIso(item.postDate),
      [f.wpId]: item.id,
      _status: published ? 'published' : 'draft',
    }

    const editor = editorFor(schema)
    if (editor) {
      const ctx: ContentContext = {
        postId: item.id,
        urls,
        media: matcher,
        attachmentsOf: (id) => attachmentsByParent.get(id) ?? [],
        mediaId: (wpId) => mediaIds.get(wpId),
        mediaCollection: slugs.media,
        capabilities: editor.info.capabilities,
        builders: detectBuilders(item),
        warnings: itemWarnings,
      }
      const state = htmlToLexical(
        prepareContent(item.content, ctx),
        lexical,
        editor.config,
        editor.info,
        mediaIdType,
      )
      if (!isEmptyState(state)) data[f.content] = state
    } else if (item.content.trim()) {
      reportMissing(schema.slug, [f.content])
    }

    const authorId = authorIds.get(item.creator)
    if (authorId !== undefined && schema.relatesTo(f.author, slugs.authors)) {
      data[f.author] = schema.relationValue(f.author, slugs.authors, [authorId])
    }
    const categories = termIdsOf(item, 'category')
    if (categories.length > 0 && schema.relatesTo(f.categories, slugs.categories)) {
      data[f.categories] = schema.relationValue(f.categories, slugs.categories, categories)
    }
    const tags = termIdsOf(item, 'post_tag')
    if (tags.length > 0 && schema.relatesTo(f.tags, slugs.tags)) {
      data[f.tags] = schema.relationValue(f.tags, slugs.tags, tags)
    }
    const thumbnail = Number(metaValue(item, '_thumbnail_id'))
    const featuredId = Number.isFinite(thumbnail) ? mediaIds.get(thumbnail) : undefined
    if (featuredId !== undefined && schema.relatesTo(f.featuredImage, slugs.media)) {
      data[f.featuredImage] = featuredId
    }

    const seo = extractSeo(item, {
      site: index.site,
      separator: config.seo.separator,
      media: matcher,
      categoryNames: item.terms.filter((t) => t.taxonomy === 'category').map((t) => t.name),
      tagNames: item.terms.filter((t) => t.taxonomy === 'post_tag').map((t) => t.name),
      authorName: index.authors.get(item.creator)?.displayName ?? '',
      warnings: itemWarnings,
    })
    const imageId =
      seo.imageWpId === undefined ? featuredId : (mediaIds.get(seo.imageWpId) ?? featuredId)
    const meta: Record<string, unknown> = {}
    if (seo.title) meta.title = seo.title
    if (seo.description) meta.description = seo.description
    if (imageId !== undefined && schema.subField(f.meta, 'image')) meta.image = imageId
    if (seo.canonical) {
      if (schema.subField(f.meta, 'canonical')) meta.canonical = seo.canonical
      else
        itemWarnings.add(
          'SEO_CANONICAL',
          `Canonical URL ${seo.canonical} was not imported (no meta.canonical field).`,
          seo.canonical,
        )
    }
    if (seo.noindex && schema.subField(f.meta, 'noIndex')) meta.noIndex = true
    if (Object.keys(meta).length > 0) data[f.meta] = meta
    return { data, draft: !published }
  }

  const documentPhases = (['posts', 'pages'] as const).filter((p) => selected.has(p))
  for (const phase of ['posts', 'pages'] as const) {
    if (selected.has(phase)) continue
    const schema = schemaOf(phaseCollection[phase])
    if (!schema?.has(f.wpId)) continue
    for (const [wpId, id] of await loadExisting(schema.slug))
      docIds.set(wpId, { collection: schema.slug, id })
  }
  if (documentPhases.length > 0) {
    const totals = { posts: 0, pages: 0 }
    for (const post of index.posts.values()) {
      if (!IMPORTED_STATUSES.has(post.status)) continue
      if (post.type === 'post') totals.posts++
      if (post.type === 'page') totals.pages++
    }
    for (const phase of documentPhases) {
      const total =
        options.limit === undefined ? totals[phase] : Math.min(totals[phase], options.limit)
      log(`${phase === 'posts' ? 'Posts' : 'Pages'}: ${total}`)
    }
    const written = { posts: 0, pages: 0 }
    for await (const record of readWxr(options.file)) {
      if (record.kind !== 'item') continue
      const { item } = record
      const phase = item.type === 'post' ? 'posts' : item.type === 'page' ? 'pages' : undefined
      if (!phase || !selected.has(phase) || !IMPORTED_STATUSES.has(item.status)) continue
      if (options.limit !== undefined && written[phase] >= options.limit) continue
      const schema = schemaOf(phaseCollection[phase]) as CollectionSchema
      written[phase]++
      let built: ReturnType<typeof buildDocument>
      try {
        built = buildDocument(item, schema)
      } catch (error) {
        result.phases[phase].failed++
        result.errors.push({
          phase,
          wpId: item.id,
          message: `conversion failed: ${errorMessage(error)}`,
        })
        continue
      }
      const id = await upsert(phase, schema, item.id, built.data, { draft: built.draft })
      if (id !== undefined) docIds.set(item.id, { collection: schema.slug, id })
      if (phase === 'pages') pageStatus.set(item.id, String(built.data._status))
      const total =
        options.limit === undefined ? totals[phase] : Math.min(totals[phase], options.limit)
      progress(phase, written[phase], total)
    }

    // Parent pages, now that every page has an ID.
    const pages = schemaOf(slugs.pages)
    if (selected.has('pages') && pages?.relatesTo(f.parent, slugs.pages) && !options.dryRun) {
      for (const [wpId, status] of pageStatus) {
        const page = index.posts.get(wpId)
        const own = docIds.get(wpId)
        const parent = page && page.parentId > 0 ? docIds.get(page.parentId) : undefined
        if (!own || !page || page.parentId === 0) continue
        if (!parent) {
          warnings
            .for({ wpId, wpType: 'page' })
            .add(
              'REFERENCE_MISSING',
              `Parent page ${page.parentId} was not imported; the page has no parent.`,
              String(page.parentId),
            )
          continue
        }
        try {
          await payload.update({
            collection: slugs.pages,
            id: own.id,
            data: {
              [f.parent]: pages.relationValue(f.parent, slugs.pages, [parent.id]),
              ...(pages.hasDrafts ? { _status: status } : {}),
            },
            depth: 0,
            overrideAccess: true,
            context: WRITE_CONTEXT,
            ...(pages.hasDrafts ? { draft: status === 'draft' } : {}),
          })
        } catch (error) {
          result.errors.push({
            phase: 'pages',
            wpId,
            message: `setting the parent page failed: ${errorMessage(error)}`,
          })
        }
      }
    }
  }

  // Redirects --------------------------------------------------------------------------------
  if (selected.has('redirects')) {
    const schema = schemaOf(slugs.redirects) as CollectionSchema
    const map = buildRedirects(index, urls)
    for (const w of map.warnings) warnings.warnings.push(w)
    log(`Redirects: ${map.redirects.length}`)
    const byFrom = new Map<string, DocId>()
    const found = await payload.find({
      collection: schema.slug,
      pagination: false,
      depth: 0,
      select: { from: true },
      overrideAccess: true,
    })
    for (const doc of found.docs) if (typeof doc.from === 'string') byFrom.set(doc.from, doc.id)
    const reference = schema.subField('to', 'reference')
    const referenceTargets = new Set(
      Array.isArray(reference?.relationTo)
        ? reference.relationTo
        : reference?.relationTo
          ? [reference.relationTo]
          : [],
    )
    const stats = result.phases.redirects
    let done = 0
    for (const r of map.redirects) {
      done++
      const doc = r.wpId === undefined ? undefined : docIds.get(r.wpId)
      const to =
        doc && referenceTargets.has(doc.collection)
          ? { type: 'reference', reference: { relationTo: doc.collection, value: doc.id } }
          : { type: 'custom', url: r.to }
      const data: Record<string, unknown> = { from: r.from, to }
      if (schema.has('type')) data.type = '301'
      const id = byFrom.get(r.from)
      if (options.dryRun) {
        if (id === undefined) stats.created++
        else stats.updated++
        continue
      }
      try {
        const args = {
          collection: schema.slug,
          data,
          depth: 0,
          overrideAccess: true,
          context: WRITE_CONTEXT,
        }
        if (id === undefined) {
          await payload.create(args)
          stats.created++
        } else {
          await payload.update({ ...args, id })
          stats.updated++
        }
      } catch (error) {
        stats.failed++
        result.errors.push({ phase: 'redirects', message: `${r.from}: ${errorMessage(error)}` })
      }
      progress('redirects', done, map.redirects.length)
    }
  }

  result.warnings = warnings.warnings
  result.durationMs = Date.now() - started
  return result
}
