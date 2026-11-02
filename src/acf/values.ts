import { maybeUnserializePhp, phpEntries, phpGet, type PhpValue } from '../util/php-serialize.js'
import type { AcfPayloadField } from './plan.js'

/**
 * Reads ACF values from the meta of an item or term and turns them into Payload data. ACF stores
 * a value under the field name, a group's sub-field under `group_sub`, row `i` of a repeater or
 * flexible field under `field_i_sub`, the number of repeater rows under the repeater's name, and
 * the layouts of flexible content as a PHP-serialized list of layout names.
 */

export interface AcfRef {
  collection: string
  id: string | number
}

/** Where a field is in its collection, for finding its editor: names, and block slugs. */
export type AcfFieldPath = (string | { block: string })[]

export interface AcfValueContext {
  meta: Map<string, string[]>
  /** Payload ID of an imported attachment. */
  media: (wpId: number) => string | number | undefined
  /** Attachment ID of a file URL, for fields that hold URLs. */
  mediaByUrl: (url: string) => number | undefined
  /** The document of an imported item. */
  post: (wpId: number) => AcfRef | undefined
  /** The document of an imported term. */
  term: (taxonomy: string, termId: number) => AcfRef | undefined
  /** The item an old URL points to. */
  findPost: (url: string) => number | undefined
  /** A link to the old site with its new path; other links unchanged. */
  rewriteUrl: (url: string) => string
  /** Rich text for HTML from WordPress; undefined when the field has no editor. */
  richText: (html: string, path: AcfFieldPath) => unknown
  /** UTC ISO date of a local date and time (`2024-05-01 18:00:00`). */
  dateTime: (value: string) => string | undefined
  /**
   * The last pass over fields that were pending: only references to items and terms that are
   * still missing are reported, everything else was reported the first time. Before it, such a
   * reference makes its field pending, because the item may be imported later in the run.
   */
  final: boolean
  warn: (code: 'ACF_VALUE_INVALID' | 'REFERENCE_MISSING', message: string, subject: string) => void
}

export interface AcfValues {
  data: Record<string, unknown>
  /** Top-level fields that point to items or terms not imported yet. */
  pending: Set<string>
}

const MISSING = Symbol('missing')
type Read = unknown

const DATE = /^(\d{4})[-/]?(\d{2})[-/]?(\d{2})$/

/** Values of a list-like meta: serialized arrays, or one plain value. */
const listOf = (raw: string): string[] => {
  const value: PhpValue = maybeUnserializePhp(raw)
  if (value === raw) return raw.trim() === '' ? [] : [raw.trim()]
  return phpEntries(value)
    .map(([, v]) => (typeof v === 'number' ? String(v) : typeof v === 'string' ? v : ''))
    .filter((v) => v !== '')
}

const phpString = (value: PhpValue | undefined): string =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''

interface ReadState {
  ctx: AcfValueContext
  /** Top-level Payload field being read. */
  top: string
  pending: Set<string>
}

/** Reports a problem with a value; the final pass reports only missing references. */
const report = (
  state: ReadState,
  code: 'ACF_VALUE_INVALID' | 'REFERENCE_MISSING',
  message: string,
  subject: string,
) => {
  if (!state.ctx.final) state.ctx.warn(code, message, subject)
}

const label = (field: AcfPayloadField) => field.acf.name || field.acf.label

/** A value for one field, or MISSING when the meta has none (the field is left unchanged). */
const readField = (
  field: AcfPayloadField,
  prefix: string,
  path: AcfFieldPath,
  state: ReadState,
): Read | typeof MISSING => {
  const { ctx } = state
  const key = `${prefix}${field.acf.name}`
  const values = ctx.meta.get(key)
  if (values === undefined) return MISSING
  const raw = values[0] ?? ''
  const here: AcfFieldPath = [...path, field.name]
  const subject = key
  const invalid = (message: string) => {
    report(state, 'ACF_VALUE_INVALID', `ACF field "${label(field)}": ${message}`, subject)
    return MISSING
  }

  switch (field.type) {
    case 'text':
    case 'textarea':
      return raw
    case 'email':
      if (raw.trim() === '') return null
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw.trim())
        ? raw.trim()
        : invalid(`"${raw}" is not an e-mail address; it was not imported.`)
    case 'number': {
      if (raw.trim() === '') return null
      const n = Number(raw)
      return Number.isFinite(n) ? n : invalid(`"${raw}" is not a number; it was not imported.`)
    }
    case 'checkbox':
      return raw === '1' || raw === 'true'
    case 'select':
    case 'radio': {
      const allowed = new Set(field.options.map((o) => o.value))
      const chosen = listOf(raw)
      const kept = chosen.filter((v) => allowed.has(v))
      for (const v of chosen) {
        if (!allowed.has(v)) invalid(`"${v}" is not one of its choices; it was left out.`)
      }
      return field.hasMany ? kept : (kept[0] ?? null)
    }
    case 'date': {
      if (raw.trim() === '') return null
      if (field.time) {
        return ctx.dateTime(raw.trim()) ?? invalid(`"${raw}" is not a date and time.`)
      }
      const m = DATE.exec(raw.trim())
      // Noon UTC keeps the day the same in every time zone of the admin.
      return m ? `${m[1]}-${m[2]}-${m[3]}T12:00:00.000Z` : invalid(`"${raw}" is not a date.`)
    }
    case 'link': {
      const value = maybeUnserializePhp(raw)
      const url = value === raw ? raw.trim() : phpString(phpGet(value, 'url'))
      if (!url) return { label: null, url: null, newTab: false }
      return {
        label: value === raw ? null : phpString(phpGet(value, 'title')) || null,
        url: ctx.rewriteUrl(url),
        newTab: value !== raw && phpString(phpGet(value, 'target')) === '_blank',
      }
    }
    case 'upload': {
      const ids: (string | number)[] = []
      for (const v of listOf(raw)) {
        const wpId = /^\d+$/.test(v) ? Number(v) : ctx.mediaByUrl(v)
        const id = wpId === undefined ? undefined : ctx.media(wpId)
        if (id === undefined) {
          report(
            state,
            'REFERENCE_MISSING',
            `ACF field "${label(field)}": media file ${v} was not imported.`,
            subject,
          )
        } else ids.push(id)
      }
      return field.hasMany ? ids : (ids[0] ?? null)
    }
    case 'relationship':
      return relations(field, raw, subject, state)
    case 'richText':
      if (raw.trim() === '') return null
      return ctx.richText(raw, here) ?? MISSING
    case 'group': {
      const out: Record<string, unknown> = {}
      for (const sub of field.fields) {
        const value = readField(sub, `${key}_`, here, state)
        if (value !== MISSING) out[sub.name] = value
      }
      return out
    }
    case 'array': {
      const count = Number.parseInt(raw, 10)
      const rows: Record<string, unknown>[] = []
      for (let i = 0; i < (Number.isFinite(count) ? count : 0); i++) {
        const row: Record<string, unknown> = {}
        for (const sub of field.fields) {
          const value = readField(sub, `${key}_${i}_`, here, state)
          if (value !== MISSING) row[sub.name] = value
        }
        rows.push(row)
      }
      return rows
    }
    case 'blocks': {
      const rows: Record<string, unknown>[] = []
      for (const [i, layout] of listOf(raw).entries()) {
        const block = field.blocks.find((b) => b.layout.name === layout)
        if (!block) {
          invalid(
            `row ${i + 1} uses the layout "${layout}", which is not defined; it was left out.`,
          )
          continue
        }
        const row: Record<string, unknown> = { blockType: block.slug }
        for (const sub of block.fields) {
          const value = readField(sub, `${key}_${i}_`, [...here, { block: block.slug }], state)
          if (value !== MISSING) row[sub.name] = value
        }
        rows.push(row)
      }
      return rows
    }
  }
}

/** Post and term references in the shape of the field: single or many, one or more collections. */
const relations = (field: AcfPayloadField, raw: string, subject: string, state: ReadState) => {
  const { ctx } = state
  const refs: AcfRef[] = []
  for (const v of listOf(raw)) {
    let ref: AcfRef | undefined
    let what: string
    if (field.taxonomy !== undefined) {
      what = `term ${v}`
      ref = /^\d+$/.test(v) ? ctx.term(field.taxonomy, Number(v)) : undefined
    } else {
      const wpId = /^\d+$/.test(v) ? Number(v) : ctx.findPost(v)
      if (wpId === undefined) {
        report(
          state,
          'ACF_VALUE_INVALID',
          `ACF field "${label(field)}": ${v} is not the address of an item (an archive or another site); it was left out.`,
          subject,
        )
        continue
      }
      what = `item ${wpId}`
      ref = ctx.post(wpId)
    }
    if (!ref) {
      if (ctx.final) {
        ctx.warn(
          'REFERENCE_MISSING',
          `ACF field "${label(field)}": ${what} was not imported.`,
          subject,
        )
      } else state.pending.add(state.top)
      continue
    }
    if (!field.relationTo.includes(ref.collection)) {
      report(
        state,
        'ACF_VALUE_INVALID',
        `ACF field "${label(field)}": ${what} is in collection "${ref.collection}", which the field does not point to; it was left out.`,
        subject,
      )
      continue
    }
    refs.push(ref)
  }
  const polymorphic = field.polymorphic ?? field.relationTo.length > 1
  const values = refs.map((r) => (polymorphic ? { relationTo: r.collection, value: r.id } : r.id))
  return field.hasMany ? values : (values[0] ?? null)
}

/**
 * Payload data for the ACF fields of an item or term. Fields without any stored value are left
 * out, so the import does not clear what an editor added in Payload.
 */
export const acfValues = (fields: AcfPayloadField[], ctx: AcfValueContext): AcfValues => {
  const data: Record<string, unknown> = {}
  const pending = new Set<string>()
  for (const field of fields) {
    // Two fields with the same name share the value; its reference says whose it is.
    if (field.matchKey && ctx.meta.get(`_${field.acf.name}`)?.[0] !== field.acf.key) continue
    const value = readField(field, '', [], { ctx, top: field.name, pending })
    if (value !== MISSING) data[field.name] = value
  }
  return { data, pending }
}

/** Whether an item or term stores any value of these fields. */
export const hasAcfValues = (fields: AcfPayloadField[], meta: Map<string, string[]>): boolean =>
  fields.some((f) => meta.has(f.acf.name))
