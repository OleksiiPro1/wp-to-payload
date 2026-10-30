import type { EditorCapabilities } from '../content/types.js'
import type { PayloadCollection, PayloadField, SanitizedEditorConfig } from './payload-types.js'

const optionValues = (field: PayloadField | undefined): string[] =>
  (field?.options ?? []).map((o) => (typeof o === 'string' ? o : o.value))

/** What a target collection looks like, so the import writes only fields that exist. */
export class CollectionSchema {
  readonly slug: string
  readonly hasDrafts: boolean
  readonly isUpload: boolean
  readonly isAuth: boolean
  private readonly fields: Map<string, PayloadField>

  constructor(collection: PayloadCollection) {
    const c = collection.config
    this.slug = c.slug
    this.hasDrafts = typeof c.versions === 'object' && Boolean(c.versions?.drafts)
    this.isUpload = Boolean(c.upload)
    this.isAuth = Boolean(c.auth)
    this.fields = new Map(c.flattenedFields.filter((f) => f.name).map((f) => [f.name as string, f]))
  }

  field(name: string): PayloadField | undefined {
    return this.fields.get(name)
  }

  has(name: string): boolean {
    return this.fields.has(name)
  }

  /** Sub-field of a group or named tab, such as `meta.title` from the SEO plugin. */
  subField(group: string, name: string): PayloadField | undefined {
    const parent = this.fields.get(group)
    return (parent?.flattenedFields ?? parent?.fields)?.find((f) => f.name === name)
  }

  /** Whether a relationship or upload field can point to `collection`. */
  relatesTo(name: string, collection: string): boolean {
    const field = this.fields.get(name)
    if (!field || (field.type !== 'relationship' && field.type !== 'upload')) return false
    const to = field.relationTo
    return Array.isArray(to) ? to.includes(collection) : to === collection
  }

  /** A relationship value in the shape the field expects (single, array, or polymorphic). */
  relationValue(name: string, collection: string, ids: (string | number)[]): unknown {
    const field = this.fields.get(name)
    if (!field) return undefined
    const polymorphic = Array.isArray(field.relationTo)
    const wrap = (id: string | number) => (polymorphic ? { relationTo: collection, value: id } : id)
    return field.hasMany ? ids.map(wrap) : ids[0] === undefined ? null : wrap(ids[0])
  }

  /**
   * Drops keys the collection does not have, also inside groups. Returns the cleaned data and the
   * names of what was dropped, for one warning per field.
   */
  filter(data: Record<string, unknown>): { data: Record<string, unknown>; missing: string[] } {
    const out: Record<string, unknown> = {}
    const missing: string[] = []
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue
      if (key === '_status') {
        if (this.hasDrafts) out[key] = value
        continue
      }
      const field = this.fields.get(key)
      if (!field) {
        missing.push(key)
        continue
      }
      const sub = field.flattenedFields ?? field.fields
      if (sub && value && typeof value === 'object' && !Array.isArray(value)) {
        const names = new Set(sub.map((f) => f.name))
        const nested: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          if (v === undefined) continue
          if (names.has(k)) nested[k] = v
          else missing.push(`${key}.${k}`)
        }
        out[key] = nested
        continue
      }
      out[key] = value
    }
    return { data: out, missing }
  }
}

export interface EditorInfo {
  capabilities: EditorCapabilities
  codeBlockSlug?: string
  /** Values allowed in the code block's `language` select. */
  codeLanguages: string[]
  embedBlockSlug?: string
}

export const describeEditor = (config: SanitizedEditorConfig): EditorInfo => {
  const enabled = new Set(config.features.enabledFeatures)
  const blocks = config.resolvedFeatureMap.get('blocks')?.sanitizedServerFeatureProps?.blocks ?? []
  const slugOf = (b: (typeof blocks)[number]) => (typeof b === 'string' ? b : b.slug)
  const code = blocks.find((b) => /^code$/i.test(slugOf(b)))
  const embed = blocks.find((b) => slugOf(b) === 'embed')
  const languageField =
    code && typeof code !== 'string' ? code.fields?.find((f) => f.name === 'language') : undefined
  return {
    capabilities: {
      codeBlock: code !== undefined,
      embedBlock: embed !== undefined,
      table: enabled.has('experimental_table'),
      horizontalRule: enabled.has('horizontalRule'),
      upload: enabled.has('upload'),
    },
    ...(code ? { codeBlockSlug: slugOf(code) } : {}),
    codeLanguages: optionValues(languageField),
    ...(embed ? { embedBlockSlug: slugOf(embed) } : {}),
  }
}
