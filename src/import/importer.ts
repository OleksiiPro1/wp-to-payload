import { AcfJsonError, loadAcfJson } from '../acf/definitions.js'
import type { AcfPayloadField } from '../acf/plan.js'
import { planSiteAcf } from '../acf/site.js'
import { commonOffset, localToIso, type SiteTime } from '../acf/time.js'
import { type AcfValueContext, acfValues } from '../acf/values.js'
import { contentSource } from '../content/elementor.js'
import { MediaMatcher } from '../content/media-match.js'
import { prepareContent } from '../content/pipeline.js'
import type { ContentContext } from '../content/types.js'
import type { Config } from '../config.js'
import { buildRedirects } from '../redirects/build.js'
import { type Warning, WarningCollector } from '../report/warnings.js'
import { extractSeo } from '../seo/seo.js'
import { newPrefixOf, translationsOf, termTranslationsOf } from '../languages.js'
import { flattenMenu, menuItemLabel, placeMenus } from '../menus.js'
import { fillPattern } from '../paths/patterns.js'
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
  PayloadField,
  PayloadGlobal,
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
/** Plugin types whose items are read as settings: ACF's field definitions. */
const DEFINITION_TYPES = new Set(['acf-field-group', 'acf-field'])
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

/** Why a Payload field cannot take the values of an ACF field, or undefined when it can. */
const acfMismatch = (field: AcfPayloadField, own: PayloadField): string | undefined => {
  const expected =
    field.type === 'link'
      ? ['group']
      : field.type === 'text' || field.type === 'textarea'
        ? ['text', 'textarea']
        : [field.type]
  if (!expected.includes(own.type)) return `is a ${own.type} field`
  if (field.type === 'upload' || field.type === 'relationship') {
    const to = Array.isArray(own.relationTo)
      ? own.relationTo
      : own.relationTo
        ? [own.relationTo]
        : []
    if (!field.relationTo.some((c) => to.includes(c))) {
      return `points to ${to.join(', ') || 'nothing'}, not to ${field.relationTo.join(', ')}`
    }
  }
  return undefined
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
  const { types, languages, urls, survey } = describeSite(index, config)
  const acfJson = await loadAcfJson(config.acfJson).catch((error: unknown) => {
    throw error instanceof AcfJsonError ? new ImportSetupError(error.message) : error
  })
  const acf = planSiteAcf({
    acf: index.acf,
    json: acfJson,
    config,
    types,
    survey,
    typeOfPost: (id) => index.posts.get(id)?.type,
    localized: languages !== undefined,
  })
  const siteTime: SiteTime = {
    ...(config.timeZone ? { timeZone: config.timeZone } : {}),
    offsetMinutes: commonOffset(index.acf.utcOffsets),
  }
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
    // Menus go into globals, not a collection.
    ...(index.menus.some((m) => m.items.length > 0) ? [['menus', ''] as [Phase, string]] : []),
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
      if (s.kind !== 'post type' || s.count === 0 || DEFINITION_TYPES.has(s.name)) continue
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
    if (!selected.has(phase) || phase === 'menus') continue
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

  // ACF fields that are not imported or renamed, once per collection that is written.
  const writtenCollections = new Set(
    [...phaseCollection].filter(([phase]) => selected.has(phase)).map(([, slug]) => slug),
  )
  for (const note of acf.notes) {
    if (writtenCollections.has(note.collection)) {
      warnings.add(note.code, note.message, `${note.collection}.${note.path}`)
    }
  }
  const phaseOfTarget = new Map<string, Phase>([
    ...types.postTypes.map((t): [string, Phase] => [`post:${t.wpType}`, t.phase]),
    ...types.taxonomies.map((t): [string, Phase] => [`term:${t.taxonomy}`, t.phase]),
  ])
  const undefinedByTarget = new Map<string, typeof acf.undefinedValues>()
  for (const value of acf.undefinedValues) {
    const phase = phaseOfTarget.get(value.target)
    if (!phase || !selected.has(phase)) continue
    undefinedByTarget.set(value.target, [...(undefinedByTarget.get(value.target) ?? []), value])
  }
  for (const [target, values] of undefinedByTarget) {
    const [kind, name = target] = target.split(':')
    const listed = values
      .slice(0, 10)
      .map((v) => `${v.name} (${v.key})`)
      .join(', ')
    const more = values.length > 10 ? ` and ${values.length - 10} more` : ''
    warnings
      .for({ wpType: name })
      .add(
        'ACF_FIELD_UNKNOWN',
        `${kind === 'term' ? 'Terms' : 'Items'} of ${name} have values of ACF fields that are not defined in the export: ${listed}${more}. They were not imported; pass the field groups with --acf-json (a theme's acf-json folder or an ACF export).`,
        name,
      )
  }

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

  /** Documents of imported items by WordPress ID, the IDs of all language versions included. */
  const docIds = new Map<number, { collection: string; id: DocId }>()

  // ACF fields --------------------------------------------------------------------------------
  /** The ACF fields of a collection that its Payload schema has, as the schema shapes them. */
  const acfFields = new Map<string, AcfPayloadField[]>()
  const acfFieldsFor = (schema: CollectionSchema): AcfPayloadField[] => {
    const cached = acfFields.get(schema.slug)
    if (cached) return cached
    const fields: AcfPayloadField[] = []
    for (const field of acf.collections.get(schema.slug)?.fields ?? []) {
      const own = schema.field(field.name)
      if (!own) {
        reportMissing(schema.slug, [field.name])
        continue
      }
      const problem = acfMismatch(field, own)
      if (problem) {
        warnings.add(
          'ACF_FIELD_SKIPPED',
          `Field "${field.name}" of collection "${schema.slug}" ${problem}; the values of the ACF field "${field.acf.name}" (${field.acf.type}) were not imported.`,
          `${schema.slug}.${field.name}`,
        )
        continue
      }
      const shaped = { ...field }
      if (field.type === 'upload' || field.type === 'relationship' || field.type === 'select') {
        shaped.hasMany = own.hasMany === true
      }
      if (field.type === 'upload' || field.type === 'relationship') {
        const to = Array.isArray(own.relationTo) ? own.relationTo : [own.relationTo ?? '']
        shaped.relationTo = field.relationTo.filter((c) => to.includes(c))
        shaped.polymorphic = Array.isArray(own.relationTo)
      }
      fields.push(shaped)
    }
    acfFields.set(schema.slug, fields)
    return fields
  }
  const termSlugs = new Map<string, string>()
  for (const t of index.terms)
    if (t.id !== undefined) termSlugs.set(`${t.taxonomy}:${t.id}`, t.slug)
  const acfEditors = new Map<string, { config: SanitizedEditorConfig; info: EditorInfo } | null>()
  /** How ACF values of an item or term find media, documents, terms and editors. */
  const acfContext = (
    schema: CollectionSchema,
    meta: Map<string, string[]>,
    postId: number,
    itemWarnings: WarningCollector,
    final: boolean,
  ): AcfValueContext => ({
    meta,
    media: (wpId) => mediaIds.get(wpId),
    mediaByUrl: (url) => matcher.match(url),
    post: (wpId) => docIds.get(wpId),
    term: (taxonomy, termId) => {
      const slug = termSlugs.get(`${taxonomy}:${termId}`)
      const id = slug === undefined ? undefined : termIds.get(termKey(taxonomy, slug))
      const target = types.taxonomies.find((t) => t.taxonomy === taxonomy)
      return id === undefined || !target ? undefined : { collection: target.collection, id }
    },
    findPost: (url) => urls.findPost(url),
    rewriteUrl: (url) => {
      const file = matcher.match(url)
      return urls.rewriteHref(url) ?? (file === undefined ? undefined : mediaUrls.get(file)) ?? url
    },
    richText: (html, path) => {
      const key = `${schema.slug}:${JSON.stringify(path)}`
      let editor = acfEditors.get(key)
      if (editor === undefined) {
        const field = schema.fieldAt(path)
        const editorConfig =
          field?.type === 'richText' ? lexical.editorConfigFactory.fromField({ field }) : undefined
        editor = editorConfig ? { config: editorConfig, info: describeEditor(editorConfig) } : null
        acfEditors.set(key, editor)
      }
      if (!editor) return undefined
      const ctx: ContentContext = {
        postId,
        urls,
        media: matcher,
        attachmentsOf: (id) => attachmentsByParent.get(id) ?? [],
        mediaId: (wpId) => mediaIds.get(wpId),
        mediaUrl: (wpId) => mediaUrls.get(wpId),
        mediaCollection: slugs.media,
        capabilities: editor.info.capabilities,
        builders: [],
        pattern: (id) => index.patterns.get(id),
        warnings: itemWarnings,
      }
      const state = htmlToLexical(
        prepareContent(html, ctx),
        lexical,
        editor.config,
        editor.info,
        mediaIdType,
      )
      return isEmptyState(state) ? null : state
    },
    dateTime: (value) => localToIso(value, siteTime),
    final,
    warn: (code, message, subject) => itemWarnings.add(code, message, subject),
  })
  /** Documents with ACF references to items imported after them; set once all exist. */
  const pendingAcf: {
    phase: Phase
    schema: CollectionSchema
    id: DocId
    locale: string | null
    status?: string
    fields: AcfPayloadField[]
    meta: Map<string, string[]>
    postId: number
    context: Pick<Warning, 'wpId' | 'wpType'>
  }[] = []

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
      const termAcf = acfFieldsFor(schema)
      const context = { wpType: taxonomy, ...(term.id === undefined ? {} : { wpId: term.id }) }
      let acfPending: AcfPayloadField[] = []
      if (termAcf.length > 0) {
        const values = acfValues(
          termAcf,
          acfContext(schema, term.meta, 0, warnings.for(context), false),
        )
        Object.assign(data, values.data)
        acfPending = termAcf.filter((f) => values.pending.has(f.name))
      }
      if (isPrimary(term)) {
        if (parentId !== undefined && schema.relatesTo('parent', slug)) {
          data.parent = schema.relationValue('parent', slug, [parentId])
        }
      } else {
        const part = schema.localizedPart(data)
        const translatable = new Set([
          'title',
          'slug',
          'description',
          ...termAcf.map((a) => a.name),
        ])
        reportNotLocalized(
          schema.slug,
          part.dropped.filter((k) => translatable.has(k)),
        )
        data = part.data
        acfPending = acfPending.filter((a) => schema.isLocalized(a.name))
      }
      if (typeof key === 'number')
        Object.assign(data, idFields(schema, unit.length > 0 ? unit : [key]))
      const locale = localeOfTerm(term.id) ?? null
      const id = await upsert(phase, schema, key, data, { locale, unit })
      if (id !== undefined) termIds.set(termKey(taxonomy, term.slug), id)
      if (id !== undefined && acfPending.length > 0) {
        pendingAcf.push({
          phase,
          schema,
          id,
          locale,
          fields: acfPending,
          meta: term.meta,
          postId: 0,
          context,
        })
      }
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
  ): { data: Record<string, unknown>; draft: boolean; acfPending: AcfPayloadField[] } => {
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
    const source = contentSource(item)
    if (editor) {
      for (const w of source.warnings) itemWarnings.add(w.code, w.message, w.subject)
      const ctx: ContentContext = {
        postId: item.id,
        urls,
        media: matcher,
        attachmentsOf: (id) => attachmentsByParent.get(id) ?? [],
        mediaId: (wpId) => mediaIds.get(wpId),
        mediaUrl: (wpId) => mediaUrls.get(wpId),
        mediaCollection: slugs.media,
        capabilities: editor.info.capabilities,
        builders: source.builders,
        pattern: (id) => index.patterns.get(id),
        warnings: itemWarnings,
      }
      const state = htmlToLexical(
        prepareContent(source.content, ctx),
        lexical,
        editor.config,
        editor.info,
        mediaIdType,
      )
      if (!isEmptyState(state)) data[f.content] = state
    } else if (source.content.trim()) {
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

    const acfFields = acfFieldsFor(schema)
    let acfPending: AcfPayloadField[] = []
    if (acfFields.length > 0) {
      const values = acfValues(
        acfFields,
        acfContext(schema, item.meta, item.id, itemWarnings, false),
      )
      Object.assign(data, values.data)
      acfPending = acfFields.filter((a) => values.pending.has(a.name))
    }
    if (item.id !== plan.primary) {
      // A translation: only what Payload keeps per locale, plus the IDs and the status.
      const part = schema.localizedPart(data)
      const translatable = new Set([
        f.title,
        f.slug,
        f.content,
        f.excerpt,
        f.featuredImage,
        f.meta,
        ...acfFields.map((a) => a.name),
      ])
      reportNotLocalized(
        schema.slug,
        part.dropped.filter((k) => translatable.has(k)),
      )
      return {
        data: { ...part.data, ...idFields(schema, plan.unit), _status: data._status },
        draft: data._status !== 'published',
        acfPending: acfPending.filter((a) => schema.isLocalized(a.name)),
      }
    }
    return { data, draft: data._status !== 'published', acfPending }
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
      const locale = localeOfItem(item.id) ?? null
      const id = await upsert(type.phase, schema, plan.key, built.data, {
        draft: built.draft,
        locale,
        unit: plan.unit,
      })
      if (id !== undefined) {
        for (const n of plan.unit) docIds.set(n, { collection: schema.slug, id })
        if (built.acfPending.length > 0) {
          pendingAcf.push({
            phase: type.phase,
            schema,
            id,
            locale,
            status: String(built.data._status),
            fields: built.acfPending,
            meta: item.meta,
            postId: item.id,
            context: { wpId: item.id, wpType: item.type },
          })
        }
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

  // ACF references to items and terms that were imported after the document holding them.
  for (const p of pendingAcf) {
    const values = acfValues(
      p.fields,
      acfContext(p.schema, p.meta, p.postId, warnings.for(p.context), true),
    )
    if (options.dryRun || Object.keys(values.data).length === 0) continue
    const drafts = p.schema.hasDrafts && p.status !== undefined
    try {
      await payload.update({
        collection: p.schema.slug,
        id: p.id,
        data: { ...values.data, ...(drafts ? { _status: p.status } : {}) },
        depth: 0,
        overrideAccess: true,
        context: WRITE_CONTEXT,
        ...(drafts ? { draft: p.status === 'draft' } : {}),
        ...(p.locale ? { locale: p.locale } : {}),
      })
    } catch (error) {
      result.errors.push({
        phase: p.phase,
        ...(p.postId ? { wpId: p.postId } : {}),
        message: `setting ACF references failed: ${errorMessage(error)}`,
      })
    }
  }

  // Menus ------------------------------------------------------------------------------------
  if (selected.has('menus')) {
    const stats = (result.phases.menus ??= emptyPhase())
    const menuWarnings = warnings.for({ wpType: 'nav_menu' })
    const globals = (payload.config as { globals?: PayloadGlobal[] }).globals ?? []
    const termById = new Map(index.terms.flatMap((t) => (t.id === undefined ? [] : [[t.id, t]])))
    /** A field of a global or group: flattened, so rows and tabs do not hide it. */
    const fieldIn = (fields: PayloadField[] | undefined, name: string) =>
      fields?.find((f) => f.name === name)
    /** New path of a post type's archive: the fixed start of its pattern. */
    const archivePath = (postType: string, language?: string): string | undefined => {
      const pattern = types.patterns[postType]
      if (!pattern) return undefined
      const fixed: string[] = []
      for (const segment of pattern.split('/').filter(Boolean)) {
        if (segment.includes(':') && segment !== ':locale') break
        fixed.push(segment)
      }
      if (fixed.every((s) => s === ':locale')) return undefined
      const path = `/${fixed.join('/')}`
      if (!languages) return fillPattern(path, { locale: '' })
      const prefix = newPrefixOf(languages, config, language ?? languages.defaultLanguage)
      return fillPattern(path.includes(':locale') ? path : `/:locale${path}`, { locale: prefix })
    }
    const notLocalizedMenus = new Set<string>()
    log(`Menus: ${index.menus.filter((m) => m.items.length > 0).length}`)
    for (const placement of placeMenus(index.menus, config, languages)) {
      const { menu } = placement
      if (menu.items.length === 0 || placement.excluded) continue
      const skip = (reason: string) => {
        stats.skipped++
        menuWarnings.add(
          'MENU_SKIPPED',
          `Menu "${menu.name}" (${menu.items.length} ${menu.items.length === 1 ? 'entry' : 'entries'}) was not imported: ${reason}.`,
          menu.slug,
        )
      }
      if (!placement.global) {
        skip(placement.reason)
        continue
      }
      const global = globals.find((g) => g.slug === placement.global)
      if (!global) {
        skip(
          `there is no global "${placement.global}" (run scaffold with the export, or name another global under "menus" in the config)`,
        )
        continue
      }
      const navItems = fieldIn(global.flattenedFields ?? global.fields, 'navItems')
      const link = fieldIn(navItems?.flattenedFields ?? navItems?.fields, 'link')
      const linkFields = link?.flattenedFields ?? link?.fields
      if (navItems?.type !== 'array' || link?.type !== 'group' || !fieldIn(linkFields, 'url')) {
        skip(
          `global "${global.slug}" has no navItems array with a link group like the website template's`,
        )
        continue
      }
      const locale =
        placement.language && locales ? locales.localeOf(placement.language) : undefined
      if (placement.language && languages && locale === undefined) continue
      const defaultMenu = !languages || placement.language === languages.defaultLanguage
      if (languages && locale && !navItems.localized && !defaultMenu) {
        if (!notLocalizedMenus.has(global.slug)) {
          notLocalizedMenus.add(global.slug)
          warnings.add(
            'FIELD_NOT_LOCALIZED',
            `Field "navItems" of global "${global.slug}" is not localized; only the ${languages.defaultLanguage} menu was imported.`,
            `${global.slug}.navItems`,
          )
        }
        stats.skipped++
        continue
      }
      const reference = fieldIn(linkFields, 'reference')
      const targets = new Set(
        Array.isArray(reference?.relationTo)
          ? reference.relationTo
          : reference?.relationTo
            ? [reference.relationTo]
            : [],
      )
      const flat = flattenMenu(menu)
      const nested = flat.filter((f) => f.depth > 0).length
      if (nested > 0) {
        menuWarnings.add(
          'MENU_FLATTENED',
          `Menu "${menu.name}": ${nested} ${nested === 1 ? 'entry' : 'entries'} of submenus ${nested === 1 ? 'was' : 'were'} put after ${nested === 1 ? 'its' : 'their'} parent at the top level; navItems has no levels.`,
          menu.slug,
        )
      }
      const rows: Record<string, unknown>[] = []
      for (const { item } of flat) {
        const label = menuItemLabel(item, {
          post: (id) => decodeEntities(index.posts.get(id)?.title ?? ''),
          term: (id) => termById.get(id)?.name,
        })
        const leftOut = (why: string) =>
          menuWarnings.add(
            'MENU_ITEM_SKIPPED',
            `Menu "${menu.name}": the entry "${label}" was left out: ${why}.`,
            menu.slug,
          )
        let target: Record<string, unknown> | undefined
        if (item.type === 'post_type') {
          const doc = docIds.get(item.objectId)
          if (!doc) {
            leftOut(`${item.object} ${item.objectId} was not imported`)
            continue
          }
          if (targets.has(doc.collection)) {
            target = {
              type: 'reference',
              reference: Array.isArray(reference?.relationTo)
                ? { relationTo: doc.collection, value: doc.id }
                : doc.id,
            }
          } else {
            const path = urls.newPath(item.objectId)
            if (!path) {
              leftOut(
                `its ${item.object} has no new URL and the link cannot point to collection "${doc.collection}"`,
              )
              continue
            }
            target = { type: 'custom', url: path }
          }
        } else if (item.type === 'taxonomy') {
          const term = termById.get(item.objectId)
          if (!term) {
            leftOut(`term ${item.objectId} is not in the export`)
            continue
          }
          const path = urls.termPath(term.taxonomy, term.slug)
          if (path) target = { type: 'custom', url: path }
          else {
            const base =
              term.taxonomy === 'category'
                ? 'category'
                : term.taxonomy === 'post_tag'
                  ? 'tag'
                  : (types.taxonomies.find((t) => t.taxonomy === term.taxonomy)?.base ??
                    term.taxonomy)
            const old = urls.oldTermPath(term.taxonomy, term.slug, base)
            target = { type: 'custom', url: old }
            menuWarnings.add(
              'MENU_LINK_UNCHANGED',
              `Menu "${menu.name}": the entry "${label}" links to the ${term.taxonomy} archive ${old}, which has no new URL; set its path in the config (paths.category, paths.tag or taxonomies.<name>.path).`,
              menu.slug,
            )
          }
        } else if (item.type === 'post_type_archive') {
          const path = archivePath(item.object, placement.language)
          if (path) target = { type: 'custom', url: path }
          else {
            leftOut(`the post type ${item.object} has no archive URL in its pattern`)
            continue
          }
        } else {
          target = { type: 'custom', url: urls.rewriteHref(item.url) ?? (item.url || '#') }
        }
        rows.push({ link: { ...target, label, newTab: item.newTab } })
      }
      const max = navItems.maxRows
      if (max !== undefined && rows.length > max) {
        const dropped = rows.splice(max)
        menuWarnings.add(
          'MENU_ITEM_SKIPPED',
          `Menu "${menu.name}": global "${global.slug}" allows ${max} entries; the last ${dropped.length} were left out.`,
          menu.slug,
        )
      }
      if (options.dryRun) {
        stats.updated++
        continue
      }
      const drafts = typeof global.versions === 'object' && Boolean(global.versions.drafts)
      try {
        await payload.updateGlobal({
          slug: global.slug,
          data: { navItems: rows, ...(drafts ? { _status: 'published' } : {}) },
          depth: 0,
          overrideAccess: true,
          context: WRITE_CONTEXT,
          ...(drafts ? { draft: false } : {}),
          ...(locale ? { locale } : {}),
        })
        stats.updated++
        log(
          `  ${menu.name} → ${global.slug}${locale ? ` (${locale})` : ''}: ${rows.length} entries`,
        )
      } catch (error) {
        stats.failed++
        result.errors.push({ phase: 'menus', message: `${menu.name}: ${errorMessage(error)}` })
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
