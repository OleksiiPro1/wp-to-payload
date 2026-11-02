import { detectBuilders } from '../content/builders.js'
import { MediaMatcher } from '../content/media-match.js'
import { prepareContent } from '../content/pipeline.js'
import type { ContentContext } from '../content/types.js'
import type { Config } from '../config.js'
import { buildRedirects } from '../redirects/build.js'
import { type Warning, WarningCollector } from '../report/warnings.js'
import { extractSeo } from '../seo/seo.js'
import { translationsOf, termTranslationsOf } from '../languages.js'
import { describeSite } from '../site.js'
import type { PostTypeTarget, TaxonomyTarget } from '../site-types.js'
import { decodeEntities } from '../util/entities.js'
import { slugify } from '../util/slug.js'
import { metaValue, type WxrItem, type WxrItemTerm, type WxrTerm } from '../wxr/model.js'
import { readWxr } from '../wxr/reader.js'
import {
  buildSiteIndex,
  type IndexedAttachment,
  type IndexedPost,
  type SiteIndex,
} from '../wxr/site-index.js'
import { htmlToLexical, isEmptyState } from './lexical.js'
import { importLocales } from './locales.js'
import { type Phase, phaseLabel, PHASES } from './phases.js'
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
  /**
   * Phases to run: built-in steps or the steps of custom types, named after their collections.
   * Redirects run only when listed here or with `writeRedirects`.
   */
  only: Phase[]
  writeRedirects: boolean
  /** Write at most this many documents of each post type. */
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
  /** Counts per step, in the order the steps ran. */
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
  const { types, languages, urls } = describeSite(index, config)
  const locales = languages ? importLocales(languages, config, payload.config) : undefined
  if (languages && locales) {
    log(
      `Languages: ${languages.languages.map((l) => l.code).join(', ')}, default ${languages.defaultLanguage} (${languages.source})`,
    )
    for (const [language, reason] of locales.skipped) {
      let items = 0
      for (const [id, l] of languages.itemLanguage) {
        const post = index.posts.get(id)
        if (l === language && post && IMPORTED_STATUSES.has(post.status)) items++
      }
      let terms = 0
      for (const l of languages.termLanguage.values()) if (l === language) terms++
      warnings
        .for({})
        .add(
          'LANGUAGE_SKIPPED',
          `${items} items and ${terms} terms in ${language} were not imported: ${reason}.`,
          language,
        )
    }
  }
  /** The Payload locale of an item: a code, null without localization, undefined to skip it. */
  const localeOfItem = (id: number): string | null | undefined =>
    languages && locales
      ? locales.localeOf(languages.itemLanguage.get(id) ?? languages.defaultLanguage)
      : null
  const localeOfTerm = (id: number | undefined): string | null | undefined =>
    languages && locales
      ? locales.localeOf(
          (id === undefined ? undefined : languages.termLanguage.get(id)) ??
            languages.defaultLanguage,
        )
      : null
  /** An item and its translations, which become one document. */
  const unitOf = (id: number): number[] =>
    languages ? [...translationsOf(languages, id).values()] : [id]
  const termUnitOf = (id: number): number[] =>
    languages ? [...termTranslationsOf(languages, id).values()] : [id]
  /** Whether an ID is the default language's member of its unit (or the first one). */
  const primaryOf = (ids: number[], languageOf: (id: number) => string | undefined): number => {
    const own = ids.find((id) => languageOf(id) === languages?.defaultLanguage)
    return own ?? Math.min(...ids)
  }
  // Every step and the collection it writes to, in the order the steps run.
  const phaseCollection = new Map<Phase, string>([
    ['media', slugs.media],
    ...types.taxonomies.map((t): [Phase, string] => [t.phase, t.collection]),
    ['authors', slugs.authors],
    ...types.postTypes.map((t): [Phase, string] => [t.phase, t.collection]),
    ['redirects', slugs.redirects],
  ])
  const unknownPhases = options.only.filter((p) => !phaseCollection.has(p))
  if (unknownPhases.length > 0) {
    throw new ImportSetupError(
      `unknown step ${unknownPhases.map((p) => `"${p}"`).join(', ')} for --only (the steps for this export: ${[...phaseCollection.keys()].join(', ')})`,
    )
  }
  const result: ImportResult = {
    dryRun: options.dryRun,
    phases: Object.fromEntries([...phaseCollection.keys()].map((p) => [p, emptyPhase()])),
    errors: [],
    warnings: [],
    durationMs: 0,
  }
  const matcher = new MediaMatcher(index.attachments)
  const attachmentsByParent = new Map<number, IndexedAttachment[]>()
  for (const a of index.attachments.values()) {
    const list = attachmentsByParent.get(a.parentId) ?? []
    list.push(a)
    attachmentsByParent.set(a.parentId, list)
  }

  // Which phases run, and the collections they write to.
  const selected = new Set<Phase>(
    options.only.length > 0
      ? options.only
      : [...phaseCollection.keys()].filter((p) => p !== 'redirects'),
  )
  if (options.writeRedirects) selected.add('redirects')
  const schemas = new Map<string, CollectionSchema>()
  const schemaOf = (slug: string): CollectionSchema | undefined => {
    if (schemas.has(slug)) return schemas.get(slug)
    const collection = payload.collections[slug]
    const schema = collection ? new CollectionSchema(collection) : undefined
    if (schema) schemas.set(slug, schema)
    return schema
  }

  /** What a step would import, for the warning when its collection is missing. */
  const contentOf = (phase: Phase): { count: number; noun: string } | undefined => {
    const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)
    if (phase === 'media') {
      const n = index.attachments.size
      return { count: n, noun: plural(n, 'media file', 'media files') }
    }
    if (phase === 'authors') {
      const n = index.authors.size
      return { count: n, noun: plural(n, 'author', 'authors') }
    }
    const taxonomy = types.taxonomies.find((t) => t.phase === phase)
    if (taxonomy) {
      const n = index.terms.filter((t) => t.taxonomy === taxonomy.taxonomy).length
      return { count: n, noun: `${plural(n, 'term', 'terms')} of ${taxonomy.taxonomy}` }
    }
    const type = types.postTypes.find((t) => t.phase === phase)
    if (!type) return undefined
    let n = 0
    for (const post of index.posts.values()) {
      if (post.type === type.wpType && IMPORTED_STATUSES.has(post.status)) n++
    }
    return { count: n, noun: `${plural(n, 'item', 'items')} of type ${type.wpType}` }
  }

  // Items of plugin types are not content; say so once per type when documents are imported.
  if (types.postTypes.some((t) => selected.has(t.phase))) {
    for (const s of types.skipped) {
      if (s.kind !== 'post type' || s.count === 0) continue
      warnings
        .for({ wpType: s.name })
        .add(
          'TYPE_SKIPPED',
          `${s.count} ${s.count === 1 ? 'item' : 'items'} of type ${s.name} (${s.reason}) ${s.count === 1 ? 'was' : 'were'} not imported.`,
          s.name,
        )
    }
  }

  const problems: string[] = []
  for (const [phase, slug] of phaseCollection) {
    if (!selected.has(phase)) continue
    const schema = schemaOf(slug)
    if (!schema) {
      selected.delete(phase)
      log(`Skipping ${phase}: there is no collection "${slug}"`)
      const content = contentOf(phase)
      if (content && content.count > 0) {
        warnings.add(
          'COLLECTION_MISSING',
          `There is no collection "${slug}"; ${content.count} ${content.noun} ${content.count === 1 ? 'was' : 'were'} not imported.`,
          slug,
        )
      } else if (phase === 'redirects') {
        warnings.add(
          'COLLECTION_MISSING',
          `There is no collection "${slug}"; no redirects were written (add @payloadcms/plugin-redirects).`,
          slug,
        )
      }
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
      const withIds = schema.has(f.wpIds)
      const found = await payload.find({
        collection: slug,
        where: { [f.wpId]: { exists: true } },
        pagination: false,
        depth: 0,
        draft: schema.hasDrafts,
        select: { [f.wpId]: true, ...(withIds ? { [f.wpIds]: true } : {}) },
        overrideAccess: true,
      })
      for (const doc of found.docs) {
        // A translated document carries the IDs of all its language versions.
        const all = Array.isArray(doc[f.wpIds]) ? (doc[f.wpIds] as unknown[]) : []
        for (const value of [doc[f.wpId], ...all]) {
          const wpId = Number(value)
          if (Number.isFinite(wpId) && !map.has(wpId)) map.set(wpId, doc.id)
        }
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

  /** Documents written in this run, so a document in several languages counts once. */
  const touched = new Set<string>()
  /**
   * Creates or updates the document with this WordPress ID (or slug), or with any ID of `unit`
   * (the language versions of a translated document). Returns its Payload ID.
   */
  const upsert = async (
    phase: Phase,
    schema: CollectionSchema,
    key: DocKey,
    raw: Record<string, unknown>,
    extra: {
      draft?: boolean
      file?: Parameters<PayloadLike['create']>[0]['file']
      onWritten?: (doc: PayloadDoc) => void
      /** The Payload locale to write; null or absent for none. */
      locale?: string | null
      unit?: number[]
    } = {},
  ): Promise<DocId | undefined> => {
    const stats = (result.phases[phase] ??= emptyPhase())
    const { data, missing } = schema.filter(raw)
    reportMissing(schema.slug, missing)
    let id = await existingId(schema, key)
    const known = await loadExisting(schema.slug)
    for (const n of extra.unit ?? []) id ??= known.get(n)
    const wpId = typeof key === 'number' ? key : undefined
    const count = (docId: DocId, created: boolean) => {
      const mark = `${schema.slug}:${docId}`
      if (created) stats.created++
      else if (!touched.has(mark)) stats.updated++
      touched.add(mark)
      for (const n of extra.unit ?? []) known.set(n, docId)
    }
    if (options.dryRun) {
      const docId = id ?? `dry-run-${typeof key === 'number' ? key : key.slug}`
      count(docId, id === undefined)
      if (typeof key === 'number') known.set(key, docId)
      return docId
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
        ...(extra.locale ? { locale: extra.locale } : {}),
      }
      let doc: PayloadDoc
      if (id === undefined) {
        doc = await payload.create(args)
        if (typeof key === 'number') known.set(key, doc.id)
        else bySlug.get(schema.slug)?.set(key.slug, doc.id)
        count(doc.id, true)
      } else {
        doc = await payload.update({ ...args, id })
        count(doc.id, false)
      }
      extra.onWritten?.(doc)
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

  const notLocalized = new Set<string>()
  /** Translations of fields that are not localized in Payload are lost; say so once per field. */
  const reportNotLocalized = (collection: string, fields: string[]) => {
    for (const field of fields) {
      const key = `${collection}.${field}`
      if (notLocalized.has(key)) continue
      notLocalized.add(key)
      warnings.add(
        'FIELD_NOT_LOCALIZED',
        `Field "${field}" of collection "${collection}" is not localized; only the ${languages?.defaultLanguage ?? 'default'} version of it was imported.`,
        key,
      )
    }
  }
  /** Data for a document's ID fields: the smallest WordPress ID and all IDs of its languages. */
  const idFields = (schema: CollectionSchema, unit: number[]): Record<string, unknown> => ({
    [f.wpId]: Math.min(...unit),
    ...(languages && schema.has(f.wpIds) ? { [f.wpIds]: [...unit].sort((a, b) => a - b) } : {}),
  })

  const progress = (phase: Phase, done: number, total: number) => {
    if (done === total || done % 50 === 0) log(`  ${phase}: ${done}/${total}`)
  }

  // Media ------------------------------------------------------------------------------------
  const mediaIds = new Map<number, DocId>()
  /** URLs of imported files, so links to them in content point to Payload. */
  const mediaUrls = new Map<number, string>()
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
    // Translated images (Polylang's media translation) are one file with texts per language:
    // one version is uploaded, the others add their alt text and caption in their locale.
    const languageOf = (id: number) => languages?.itemLanguage.get(id)
    const importable = [...index.attachments.values()].filter(
      (a) => localeOfItem(a.id) !== undefined,
    )
    const attachments = importable.filter((a) => primaryOf(unitOf(a.id), languageOf) === a.id)
    const translated = importable.filter((a) => !attachments.includes(a))
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
        const unit = unitOf(a.id)
        const data = {
          alt: a.alt || decodeEntities(a.title) || a.filename,
          caption: a.caption ? plainText(a.caption) : undefined,
          ...idFields(schema, unit),
        }
        const media = warnings.for({ wpId: a.id, wpType: 'attachment' })
        if (fileResult && !fileResult.ok) {
          if (fileResult.skipped) {
            ;(result.phases.media ??= emptyPhase()).skipped++
            media.add('MEDIA_SKIPPED', `${a.url} skipped: ${fileResult.reason}`, a.url)
          } else {
            ;(result.phases.media ??= emptyPhase()).failed++
            media.add('MEDIA_FAILED', `${a.url} not imported: ${fileResult.reason}`, a.url)
          }
          const kept = unit.map((n) => ids.get(n)).find((d) => d !== undefined)
          if (kept !== undefined) mediaIds.set(a.id, kept)
        } else {
          const id = await upsert('media', schema, Math.min(...unit), data, {
            ...(fileResult?.ok ? { file: fileResult.file } : {}),
            onWritten: (doc) => {
              if (typeof doc.url === 'string') mediaUrls.set(a.id, doc.url)
            },
            locale: localeOfItem(a.id) ?? null,
            unit,
          })
          if (id !== undefined) mediaIds.set(a.id, id)
        }
        progress('media', ++done, attachments.length)
      }
    }
    for (const a of translated) {
      const unit = unitOf(a.id)
      const doc = unit.map((n) => mediaIds.get(n)).find((d) => d !== undefined)
      if (doc === undefined) continue
      mediaIds.set(a.id, doc)
      const url = unit.map((n) => mediaUrls.get(n)).find(Boolean)
      if (url) mediaUrls.set(a.id, url)
      const locale = localeOfItem(a.id)
      const { data, dropped } = schema.localizedPart({
        alt: a.alt || decodeEntities(a.title) || a.filename,
        caption: a.caption ? plainText(a.caption) : undefined,
      })
      reportNotLocalized(schema.slug, dropped)
      if (!locale || Object.keys(data).length === 0) continue
      await upsert('media', schema, Math.min(...unit), data, { locale, unit })
    }
  } else if (schemaOf(slugs.media)?.has(f.wpId)) {
    for (const [wpId, id] of await loadExisting(slugs.media)) mediaIds.set(wpId, id)
  }

  // Terms ------------------------------------------------------------------------------------
  const termIds = new Map<string, DocId>()
  const termKey = (taxonomy: string, slug: string) => `${taxonomy}:${slug}`
  const importTerms = async ({ phase, taxonomy, collection: slug }: TaxonomyTarget) => {
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
    // Translations of a term become one document with a title, slug and description per locale.
    const importable = sortByParent(terms).filter((t) => localeOfTerm(t.id) !== undefined)
    const languageOf = (id: number) => languages?.termLanguage.get(id)
    const isPrimary = (term: WxrTerm) =>
      term.id === undefined || primaryOf(termUnitOf(term.id), languageOf) === term.id
    log(`${phaseLabel(phase)}: ${importable.filter(isPrimary).length}`)
    let done = 0
    // Primary versions first, so their documents exist when the translations are added.
    for (const term of [
      ...importable.filter(isPrimary),
      ...importable.filter((t) => !isPrimary(t)),
    ]) {
      done++
      const unit = term.id === undefined ? [] : termUnitOf(term.id)
      const key = unit.length > 1 ? Math.min(...unit) : keyOf(term)
      const parentId = term.parentSlug ? termIds.get(termKey(taxonomy, term.parentSlug)) : undefined
      let data: Record<string, unknown> = {
        title: term.name,
        slug: term.slug,
        description: term.description,
      }
      if (isPrimary(term)) {
        if (parentId !== undefined && schema.relatesTo('parent', slug)) {
          data.parent = schema.relationValue('parent', slug, [parentId])
        }
      } else {
        const part = schema.localizedPart(data)
        reportNotLocalized(schema.slug, part.dropped)
        data = part.data
      }
      if (typeof key === 'number')
        Object.assign(data, idFields(schema, unit.length > 0 ? unit : [key]))
      const id = await upsert(phase, schema, key, data, {
        locale: localeOfTerm(term.id) ?? null,
        unit,
      })
      if (id !== undefined) termIds.set(termKey(taxonomy, term.slug), id)
      progress(phase, done, importable.length)
    }
  }
  for (const taxonomy of types.taxonomies) await importTerms(taxonomy)

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

  // Posts, pages and other post types -------------------------------------------------------
  const typeOf = new Map(types.postTypes.map((t) => [t.wpType, t]))
  const docIds = new Map<number, { collection: string; id: DocId }>()
  /** Status written for each hierarchical document, kept when its parent is set afterwards. */
  const statusOf = new Map<number, string>()
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

  /**
   * How an item is imported: with its translations into one document, whose WordPress ID is the
   * smallest of them. The document is published when one version is public; versions that are
   * not public then stay out, or they would become public in Payload.
   */
  interface UnitPlan {
    key: number
    unit: number[]
    primary: number
    published: boolean
    members: Set<number>
  }
  const plans = new Map<number, UnitPlan>()
  const languageOfItem = (id: number) => languages?.itemLanguage.get(id)
  const planOf = (id: number): UnitPlan => {
    const cached = plans.get(id)
    if (cached) return cached
    const unit = unitOf(id).filter((n) => index.posts.has(n))
    if (!unit.includes(id)) unit.push(id)
    const candidates = unit.filter((n) => {
      const post = index.posts.get(n)
      return (
        post !== undefined &&
        IMPORTED_STATUSES.has(post.status) &&
        typeOf.has(post.type) &&
        localeOfItem(n) !== undefined
      )
    })
    const isPublic = (n: number) => {
      const post = index.posts.get(n)
      return post?.status === 'publish' && !post.hasPassword
    }
    const published = candidates.some(isPublic)
    const members = published ? candidates.filter(isPublic) : candidates
    const plan: UnitPlan = {
      key: Math.min(...unit),
      unit,
      primary: members.length > 0 ? primaryOf(members, languageOfItem) : id,
      published,
      members: new Set(members),
    }
    for (const n of unit) plans.set(n, plan)
    return plan
  }

  // Duplicate slugs within a collection and language of a non-hierarchical type (possible for
  // drafts) get the WordPress ID appended.
  const uniqueSlugs = new Map<number, string>()
  {
    const seen = new Map<string, IndexedPost>()
    for (const post of index.posts.values()) {
      const type = typeOf.get(post.type)
      if (!type || type.hierarchical || !IMPORTED_STATUSES.has(post.status)) continue
      const key = `${type.collection}:${languageOfItem(post.id) ?? ''}:${post.slug}`
      const other = seen.get(key)
      if (other === undefined) {
        seen.set(key, post)
        continue
      }
      uniqueSlugs.set(post.id, `${post.slug}-${post.id}`)
      warnings
        .for({ wpId: post.id, wpType: post.type })
        .add(
          'SLUG_CHANGED',
          `Slug "${post.slug}" is also used by ${other.type} ${other.id}; this ${post.type} got "${post.slug}-${post.id}".`,
          post.slug,
        )
    }
  }

  /** Term documents of the item, for all versions of a translated document. */
  const termIdsOf = (terms: WxrItemTerm[], taxonomy: string): DocId[] => [
    ...new Set(
      terms
        .filter((t) => t.taxonomy === taxonomy)
        .map((t) => termIds.get(termKey(taxonomy, t.slug)))
        .filter((id): id is DocId => id !== undefined),
    ),
  ]

  const buildDocument = (
    item: WxrItem,
    schema: CollectionSchema,
    plan: UnitPlan = planOf(item.id),
  ): { data: Record<string, unknown>; draft: boolean } => {
    const itemWarnings = warnings.for({ wpId: item.id, wpType: item.type })
    const published = item.status === 'publish' && !item.hasPassword
    if (item.hasPassword) {
      itemWarnings.add(
        'PASSWORD_PROTECTED',
        'The item was password protected; it was imported as a draft.',
        'password',
      )
    }
    const data: Record<string, unknown> = {
      [f.title]: decodeEntities(item.title) || `Untitled ${item.type} ${item.id}`,
      [f.slug]: uniqueSlugs.get(item.id) ?? index.posts.get(item.id)?.slug,
      [f.excerpt]: plainText(item.excerpt) || undefined,
      [f.publishedAt]: toIso(item.postDateGmt) ?? toIso(item.postDate),
      ...idFields(schema, plan.unit),
      _status: (languages ? plan.published : published) ? 'published' : 'draft',
    }

    const editor = editorFor(schema)
    if (editor) {
      const ctx: ContentContext = {
        postId: item.id,
        urls,
        media: matcher,
        attachmentsOf: (id) => attachmentsByParent.get(id) ?? [],
        mediaId: (wpId) => mediaIds.get(wpId),
        mediaUrl: (wpId) => mediaUrls.get(wpId),
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
    const terms = [
      ...item.terms,
      ...[...plan.members].flatMap((n) => (n === item.id ? [] : (index.posts.get(n)?.terms ?? []))),
    ]
    for (const taxonomy of types.taxonomies) {
      const ids = termIdsOf(terms, taxonomy.taxonomy)
      if (ids.length === 0) continue
      // Collections designed by hand may name the field differently; any relationship to the
      // taxonomy's collection will do for custom taxonomies.
      const field = schema.relatesTo(taxonomy.field, taxonomy.collection)
        ? taxonomy.field
        : taxonomy.builtin
          ? undefined
          : schema.fieldRelatingTo(taxonomy.collection)
      if (field) data[field] = schema.relationValue(field, taxonomy.collection, ids)
      else reportMissing(schema.slug, [taxonomy.field])
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
    if (item.id !== plan.primary) {
      // A translation: only what Payload keeps per locale, plus the IDs and the status.
      const part = schema.localizedPart(data)
      const translatable = new Set([f.title, f.slug, f.content, f.excerpt, f.featuredImage, f.meta])
      reportNotLocalized(
        schema.slug,
        part.dropped.filter((k) => translatable.has(k)),
      )
      return {
        data: { ...part.data, ...idFields(schema, plan.unit), _status: data._status },
        draft: data._status !== 'published',
      }
    }
    return { data, draft: data._status !== 'published' }
  }

  const selectedTypes = types.postTypes.filter((t) => selected.has(t.phase))
  for (const type of types.postTypes) {
    if (selected.has(type.phase)) continue
    const schema = schemaOf(type.collection)
    if (!schema?.has(f.wpId)) continue
    for (const [wpId, id] of await loadExisting(schema.slug)) {
      docIds.set(wpId, { collection: schema.slug, id })
    }
  }
  if (selectedTypes.length > 0) {
    const totals = new Map<string, number>()
    for (const post of index.posts.values()) {
      if (!IMPORTED_STATUSES.has(post.status) || !typeOf.has(post.type)) continue
      totals.set(post.type, (totals.get(post.type) ?? 0) + 1)
    }
    const totalOf = (type: PostTypeTarget) => {
      const total = totals.get(type.wpType) ?? 0
      return options.limit === undefined ? total : Math.min(total, options.limit)
    }
    for (const type of selectedTypes) log(`${phaseLabel(type.phase)}: ${totalOf(type)}`)

    const written = new Map<string, number>()
    for await (const record of readWxr(options.file)) {
      if (record.kind !== 'item') continue
      const { item } = record
      const type = typeOf.get(item.type)
      if (!type || !selected.has(type.phase) || !IMPORTED_STATUSES.has(item.status)) continue
      const plan = planOf(item.id)
      if (!plan.members.has(item.id)) {
        if (localeOfItem(item.id) !== undefined) {
          warnings
            .for({ wpId: item.id, wpType: item.type })
            .add(
              'TRANSLATION_DRAFT',
              `The ${languageOfItem(item.id) ?? ''} version is not public in WordPress (${item.hasPassword ? 'password protected' : item.status}), but another language version is; it was not imported, so it does not become public.`,
              String(plan.key),
            )
        }
        continue
      }
      const count = written.get(type.wpType) ?? 0
      if (options.limit !== undefined && count >= options.limit) continue
      written.set(type.wpType, count + 1)
      const schema = schemaOf(type.collection) as CollectionSchema
      let built: ReturnType<typeof buildDocument>
      try {
        built = buildDocument(item, schema, plan)
      } catch (error) {
        ;(result.phases[type.phase] ??= emptyPhase()).failed++
        result.errors.push({
          phase: type.phase,
          wpId: item.id,
          message: `conversion failed: ${errorMessage(error)}`,
        })
        continue
      }
      const id = await upsert(type.phase, schema, plan.key, built.data, {
        draft: built.draft,
        locale: localeOfItem(item.id) ?? null,
        unit: plan.unit,
      })
      if (id !== undefined) {
        for (const n of plan.unit) docIds.set(n, { collection: schema.slug, id })
      }
      if (type.hierarchical && item.id === plan.primary) {
        statusOf.set(item.id, String(built.data._status))
      }
      progress(type.phase, count + 1, totalOf(type))
    }

    // Parents of hierarchical documents, now that every document has an ID.
    if (!options.dryRun) {
      for (const [wpId, status] of statusOf) {
        const post = index.posts.get(wpId)
        const type = post ? typeOf.get(post.type) : undefined
        const own = docIds.get(wpId)
        if (!post || !type || !own || post.parentId === 0) continue
        const schema = schemaOf(type.collection) as CollectionSchema
        if (!schema.relatesTo(f.parent, type.collection)) continue
        const parent = docIds.get(post.parentId)
        if (!parent || parent.collection !== type.collection) {
          const parentType = index.posts.get(post.parentId)?.type ?? 'item'
          warnings
            .for({ wpId, wpType: post.type })
            .add(
              'REFERENCE_MISSING',
              parent
                ? `Parent ${parentType} ${post.parentId} is in collection "${parent.collection}", not "${type.collection}"; the ${post.type} has no parent.`
                : `Parent ${parentType} ${post.parentId} was not imported; the ${post.type} has no parent.`,
              String(post.parentId),
            )
          continue
        }
        try {
          await payload.update({
            collection: type.collection,
            id: own.id,
            data: {
              [f.parent]: schema.relationValue(f.parent, type.collection, [parent.id]),
              ...(schema.hasDrafts ? { _status: status } : {}),
            },
            depth: 0,
            overrideAccess: true,
            context: WRITE_CONTEXT,
            ...(schema.hasDrafts ? { draft: status === 'draft' } : {}),
          })
        } catch (error) {
          result.errors.push({
            phase: type.phase,
            wpId,
            message: `setting the parent failed: ${errorMessage(error)}`,
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
    const stats = (result.phases.redirects ??= emptyPhase())
    let done = 0
    for (const r of map.redirects) {
      done++
      const doc = r.wpId === undefined ? undefined : docIds.get(r.wpId)
      // The plugin's references cannot name a locale, so other languages get their URL.
      const inDefaultLanguage =
        !languages ||
        r.wpId === undefined ||
        (languageOfItem(r.wpId) ?? languages.defaultLanguage) === languages.defaultLanguage
      const to =
        doc && inDefaultLanguage && referenceTargets.has(doc.collection)
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
