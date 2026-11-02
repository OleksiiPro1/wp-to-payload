import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { decodeEntities } from '../util/entities.js'
import {
  maybeUnserializePhp,
  phpEntries,
  phpGet,
  phpToJson,
  type PhpValue,
} from '../util/php-serialize.js'

/**
 * Field definitions of Advanced Custom Fields (and of Secure Custom Fields, which stores them the
 * same way). An export contains the field groups saved in the database: one `acf-field-group`
 * item per group and one `acf-field` item per field, with the settings PHP-serialized in the
 * content, the field name in the excerpt, the key in the slug and the group or parent field as
 * the parent. Groups that a theme registers as local JSON are not in the export; ACF's JSON files
 * (`acf-json/*.json`, or a file from ACF's export tool) add them.
 */

export interface AcfLocationRule {
  param: string
  operator: string
  value: string
}

export interface AcfLayout {
  key: string
  name: string
  label: string
  subFields: AcfField[]
}

export interface AcfField {
  key: string
  /** Name of the value in post meta; empty for tabs, messages and accordions. */
  name: string
  label: string
  type: string
  /** The help text below the field in the editor. */
  instructions: string
  /** All settings as plain data (`multiple`, `post_type`, `taxonomy`, `field_type`, …). */
  settings: Record<string, unknown>
  /** Choices of select, checkbox, radio and button group fields, in order. */
  choices: { value: string; label: string }[]
  /** Fields of a group or repeater. */
  subFields: AcfField[]
  /** Layouts of a flexible content field. */
  layouts: AcfLayout[]
}

export interface AcfFieldGroup {
  key: string
  title: string
  fields: AcfField[]
  /** The group applies where all rules of one of the lists match. */
  location: AcfLocationRule[][]
  /** ACF's order of the groups on the edit screen. */
  order: number
  source: 'export' | 'json'
}

/** An `acf-field-group` or `acf-field` item of an export. */
export interface AcfDefinitionItem {
  id: number
  type: 'acf-field-group' | 'acf-field'
  /** `group_…` or `field_…` (the item's slug). */
  key: string
  /** The field name (the item's excerpt). */
  name: string
  /** The label or group title (the item's title). */
  label: string
  parentId: number
  menuOrder: number
  status: string
  /** The PHP-serialized settings (the item's content). */
  settings: string
}

export class AcfJsonError extends Error {
  override name = 'AcfJsonError'
}

const text = (value: unknown): string =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Location rules from either format: lists of lists of `{ param, operator, value }`. */
const locationOf = (value: unknown): AcfLocationRule[][] =>
  (Array.isArray(value) ? value : isObject(value) ? Object.values(value) : [])
    .map((and) =>
      (Array.isArray(and) ? and : isObject(and) ? Object.values(and) : [])
        .filter(isObject)
        .map((r) => ({
          param: text(r.param),
          operator: text(r.operator) || '==',
          value: text(r.value),
        }))
        .filter((r) => r.param !== ''),
    )
    .filter((and) => and.length > 0)

const choicesOf = (entries: [string | number, unknown][]): AcfField['choices'] =>
  entries
    .map(([value, label]) => ({ value: String(value), label: text(label) || String(value) }))
    .filter((c) => c.value !== '')

const baseField = (
  key: string,
  name: string,
  label: string,
  settings: Record<string, unknown>,
): AcfField => ({
  key,
  name,
  label,
  type: text(settings.type),
  instructions: text(settings.instructions),
  settings,
  choices: [],
  subFields: [],
  layouts: [],
})

const byOrder = (a: AcfDefinitionItem, b: AcfDefinitionItem) =>
  a.menuOrder - b.menuOrder || a.id - b.id

/** Field groups from the `acf-field-group` and `acf-field` items of an export. */
export const groupsFromExport = (items: AcfDefinitionItem[]): AcfFieldGroup[] => {
  const live = items.filter((i) => i.status !== 'trash' && i.status !== 'auto-draft')
  const children = new Map<number, AcfDefinitionItem[]>()
  for (const item of live) {
    if (item.type !== 'acf-field') continue
    const list = children.get(item.parentId) ?? []
    list.push(item)
    children.set(item.parentId, list)
  }
  const fieldsUnder = (id: number, seen: Set<number>): AcfField[] =>
    (children.get(id) ?? [])
      .sort(byOrder)
      .filter((i) => !seen.has(i.id))
      .map((i) => fieldOf(i, new Set([...seen, i.id])))
  const fieldOf = (item: AcfDefinitionItem, seen: Set<number>): AcfField => {
    const raw = maybeUnserializePhp(item.settings)
    const json = phpToJson(raw)
    const settings = isObject(json) ? json : {}
    const field = baseField(item.key, item.name, decodeEntities(item.label), settings)
    field.choices = choicesOf(phpEntries(phpGet(raw, 'choices')))
    const kids = fieldsUnder(item.id, seen)
    if (field.type === 'flexible_content') {
      field.layouts = phpEntries(phpGet(raw, 'layouts')).map(([key, layout]) => {
        const layoutKey = text(phpGet(layout, 'key')) || String(key)
        return {
          key: layoutKey,
          name: text(phpGet(layout, 'name')),
          label: text(phpGet(layout, 'label')),
          subFields: kids.filter((k) => k.settings.parent_layout === layoutKey),
        }
      })
    } else {
      field.subFields = kids
    }
    return field
  }
  return live
    .filter((i) => i.type === 'acf-field-group')
    .map((group) => {
      const settings = phpToJson(maybeUnserializePhp(group.settings))
      return {
        key: group.key,
        title: decodeEntities(group.label),
        fields: fieldsUnder(group.id, new Set([group.id])),
        location: locationOf(isObject(settings) ? settings.location : undefined),
        order: group.menuOrder,
        source: 'export' as const,
      }
    })
}

const fieldFromJson = (value: Record<string, unknown>): AcfField => {
  const field = baseField(text(value.key), text(value.name), text(value.label), value)
  const choices = value.choices
  field.choices = choicesOf(
    Array.isArray(choices)
      ? choices.map((c, i): [string | number, unknown] => [i, c])
      : isObject(choices)
        ? Object.entries(choices)
        : [],
  )
  const subFields = (list: unknown) =>
    (Array.isArray(list) ? list : []).filter(isObject).map(fieldFromJson)
  if (field.type === 'flexible_content') {
    const layouts = Array.isArray(value.layouts)
      ? value.layouts
      : isObject(value.layouts)
        ? Object.values(value.layouts)
        : []
    field.layouts = layouts.filter(isObject).map((l) => ({
      key: text(l.key),
      name: text(l.name),
      label: text(l.label),
      subFields: subFields(l.sub_fields),
    }))
  } else {
    field.subFields = subFields(value.sub_fields)
  }
  return field
}

/**
 * Field groups from ACF's JSON: a group as ACF saves it in `acf-json/`, or the list of groups
 * that ACF's export tool writes. Post types, taxonomies and options pages in the same format are
 * ignored.
 */
export const groupsFromJson = (value: unknown): AcfFieldGroup[] =>
  (Array.isArray(value) ? value : [value])
    .filter(isObject)
    .filter((g) => text(g.key).startsWith('group_') && Array.isArray(g.fields))
    .map((g) => ({
      key: text(g.key),
      title: text(g.title),
      fields: (g.fields as unknown[]).filter(isObject).map(fieldFromJson),
      location: locationOf(g.location),
      order: typeof g.menu_order === 'number' ? g.menu_order : 0,
      source: 'json' as const,
    }))

/** Reads ACF JSON files, and the `.json` files of directories, in a stable order. */
export const loadAcfJson = async (paths: string[]): Promise<AcfFieldGroup[]> => {
  const files: string[] = []
  for (const path of paths) {
    let info
    try {
      info = await stat(path)
    } catch {
      throw new AcfJsonError(`ACF JSON: ${path} does not exist`)
    }
    if (info.isDirectory()) {
      const names = (await readdir(path)).filter((n) => n.endsWith('.json')).sort()
      files.push(...names.map((n) => join(path, n)))
    } else {
      files.push(path)
    }
  }
  const groups: AcfFieldGroup[] = []
  for (const file of files) {
    let value: unknown
    try {
      value = JSON.parse(await readFile(file, 'utf8')) as unknown
    } catch (error) {
      throw new AcfJsonError(`ACF JSON: cannot read ${file}: ${(error as Error).message}`)
    }
    groups.push(...groupsFromJson(value))
  }
  return groups
}

/** All field groups of a site, and their fields by key. */
export class AcfDefinitions {
  /** In ACF's order. A group in the JSON files replaces the export's group with the same key. */
  readonly groups: AcfFieldGroup[]
  /** Every field by key, sub-fields included. */
  readonly fields = new Map<string, AcfField>()
  /** The group of each top-level field, by field key. */
  readonly groupOf = new Map<string, AcfFieldGroup>()

  constructor(fromExport: AcfFieldGroup[], fromJson: AcfFieldGroup[] = []) {
    const byKey = new Map<string, AcfFieldGroup>()
    for (const group of [...fromExport, ...fromJson]) byKey.set(group.key, group)
    this.groups = [...byKey.values()].sort(
      (a, b) => a.order - b.order || a.title.localeCompare(b.title) || a.key.localeCompare(b.key),
    )
    const add = (field: AcfField) => {
      if (field.key) this.fields.set(field.key, field)
      for (const sub of field.subFields) add(sub)
      for (const layout of field.layouts) for (const sub of layout.subFields) add(sub)
    }
    for (const group of this.groups) {
      for (const field of group.fields) {
        add(field)
        if (field.key) this.groupOf.set(field.key, group)
      }
    }
  }

  get empty(): boolean {
    return this.groups.length === 0
  }

  /** Number of fields, sub-fields included. */
  get fieldCount(): number {
    return this.fields.size
  }
}

/** A setting that ACF stores as a string, a list, or nothing: `post_type`, `clone`. */
export const settingList = (field: AcfField, setting: string): string[] => {
  const value = field.settings[setting]
  if (Array.isArray(value)) return value.map(text).filter(Boolean)
  if (isObject(value)) return Object.values(value).map(text).filter(Boolean)
  const single = text(value)
  return single ? [single] : []
}

/** Whether a setting is on (`1`, `true`, `"1"`). */
export const settingOn = (field: AcfField, setting: string): boolean => {
  const value = field.settings[setting]
  return value === true || value === 1 || value === '1'
}

/** A PHP value read from meta, for code that only wants lists of strings or numbers. */
export type AcfMetaValue = PhpValue
