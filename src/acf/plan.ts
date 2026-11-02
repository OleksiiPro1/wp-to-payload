import type { AcfIndex } from './collect.js'
import {
  type AcfDefinitions,
  type AcfField,
  type AcfFieldGroup,
  type AcfLayout,
  type AcfLocationRule,
  settingList,
  settingOn,
} from './definitions.js'

/**
 * How ACF fields become Payload fields. `scaffold` writes them into the collections, `import`
 * fills them and `analyze` reports them, all from this one plan, so they agree.
 *
 * Every field group goes into the collections of the post types and taxonomies its location
 * rules name, and of those whose items store values of its fields. Fields are top-level fields of
 * the collection under their ACF name (`price`); a name the collection uses already gets the
 * prefix `acf_`. Groups become groups, repeaters arrays, and flexible content blocks.
 */

/** Payload field types the plan uses. A link becomes a group of label, URL and new tab. */
export type AcfPayloadType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'email'
  | 'richText'
  | 'upload'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'date'
  | 'relationship'
  | 'link'
  | 'group'
  | 'array'
  | 'blocks'

export interface AcfPayloadField {
  /** Payload field name. */
  name: string
  acf: AcfField
  type: AcfPayloadType
  localized: boolean
  hasMany: boolean
  /** Collections an upload or relationship field points to. */
  relationTo: string[]
  options: { value: string; label: string }[]
  /** Date fields: with or without the time. */
  time: boolean
  fields: AcfPayloadField[]
  blocks: AcfPayloadBlock[]
  /** Taxonomy fields: the taxonomy whose terms they hold. */
  taxonomy?: string
  /**
   * Another field of the collection has the same ACF name. WordPress keeps one value for both;
   * it belongs to the field whose key the value's reference names.
   */
  matchKey: boolean
  /**
   * Relationship values name their collection (`{ relationTo, value }`). By default when the
   * field points to more than one collection; the import sets it from the Payload schema.
   */
  polymorphic?: boolean
}

export interface AcfPayloadBlock {
  /** Block slug, unique among all blocks of the plan. */
  slug: string
  layout: AcfLayout
  fields: AcfPayloadField[]
}

/** Where the import writes the fields of a post type or taxonomy. */
export interface AcfCollectionPlan {
  collection: string
  kind: 'document' | 'term'
  /** Post types or taxonomies whose items go into the collection. */
  wpNames: string[]
  /** The groups whose fields the collection has, with those fields. */
  groups: { group: AcfFieldGroup; fields: AcfPayloadField[] }[]
  /** All top-level fields, in order. */
  fields: AcfPayloadField[]
}

/** A field that is not imported, or imported under another name. */
export interface AcfPlanNote {
  code: 'ACF_FIELD_SKIPPED' | 'ACF_FIELD_RENAMED'
  collection: string
  /** Dotted path of ACF names, `nutrition.allergens`. */
  path: string
  field: AcfField
  message: string
  /** Items or terms that store a value of it (top-level fields only). */
  values?: number
}

export interface AcfPlan {
  definitions: AcfDefinitions
  collections: Map<string, AcfCollectionPlan>
  notes: AcfPlanNote[]
  /** Groups that go into no collection, and where they apply in WordPress. */
  unplaced: { group: AcfFieldGroup; where: string[] }[]
  /** Stored values whose field is not defined: in the export nor in the JSON files. */
  undefinedValues: { target: string; name: string; key: string; items: number }[]
  /** Number of date and time fields, whose values have no time zone. */
  dateTimeFields: number
}

export interface AcfPlanInput {
  definitions: AcfDefinitions
  index: AcfIndex
  /** Imported post types and taxonomies with their collection slugs, in import order. */
  postTypes: { wpType: string; collection: string }[]
  taxonomies: { taxonomy: string; collection: string }[]
  mediaCollection: string
  /** Field names a collection has besides ACF fields. */
  reserved: (collection: string, kind: 'document' | 'term') => Set<string>
  /** Post types whose items use a taxonomy, for rules on terms of posts. */
  postTypesWithTaxonomy: (taxonomy: string) => string[]
  /** Post type of an item, for rules on one post. */
  typeOfPost: (id: number) => string | undefined
  /** Fields get a value per locale (multilingual sites). */
  localized: boolean
}

// Location rules ----------------------------------------------------------------------------------

/** Rules that do not limit where a group applies. */
const UNRESTRICTED = new Set(['current_user', 'current_user_role'])

/** Places other than collections that ACF groups can apply to. */
const OTHER_PLACES: Record<string, string> = {
  attachment: 'media files',
  comment: 'comments',
  widget: 'widgets',
  nav_menu: 'menus',
  nav_menu_item: 'menu items',
  block: 'ACF blocks',
  options_page: 'options pages',
  user_form: 'users',
  user_role: 'users',
}

type Places = Set<string> | 'any' | 'unknown'

/** Where one rule applies: `post:<type>`, `term:<taxonomy>`, or `other:<place>`. */
const ruleTargets = (rule: AcfLocationRule, input: AcfPlanInput): Places => {
  const posts = input.postTypes.map((t) => `post:${t.wpType}`)
  const terms = input.taxonomies.map((t) => `term:${t.taxonomy}`)
  const not = rule.operator === '!='
  const only = (list: string[]) => new Set(list)
  switch (rule.param) {
    case 'post_type':
      if (rule.value === 'all') return only(posts)
      return not
        ? only(posts.filter((p) => p !== `post:${rule.value}`))
        : only([`post:${rule.value}`])
    case 'post_template':
    case 'post_status':
      return only(posts)
    case 'post_format':
      return only(['post:post'])
    case 'post_category':
      return only(input.postTypesWithTaxonomy('category').map((t) => `post:${t}`))
    case 'post_taxonomy': {
      const taxonomy = rule.value.split(':')[0] ?? ''
      return only(input.postTypesWithTaxonomy(taxonomy).map((t) => `post:${t}`))
    }
    case 'post': {
      const type = /^\d+$/.test(rule.value) ? input.typeOfPost(Number(rule.value)) : undefined
      return not || !type ? only(posts) : only([`post:${type}`])
    }
    case 'page_template':
    case 'page_type':
    case 'page_parent':
    case 'page':
      return only(['post:page'])
    case 'taxonomy':
      if (rule.value === 'all') return only(terms)
      return not
        ? only(terms.filter((t) => t !== `term:${rule.value}`))
        : only([`term:${rule.value}`])
    default:
      if (UNRESTRICTED.has(rule.param)) return 'any'
      if (OTHER_PLACES[rule.param]) return only([`other:${OTHER_PLACES[rule.param]}`])
      return 'unknown'
  }
}

/** Where a group applies by its location rules; `unknown` when a rule is not ACF's own. */
export const locationTargets = (
  group: AcfFieldGroup,
  input: AcfPlanInput,
): { places: Set<string>; unknown: boolean } => {
  const places = new Set<string>()
  let unknown = false
  for (const and of group.location) {
    // Undefined while no rule limits the places.
    let current: Set<string> | undefined
    let unknownRule = false
    for (const rule of and) {
      const targets = ruleTargets(rule, input)
      if (targets === 'unknown') {
        unknownRule = true
        break
      }
      if (targets === 'any') continue
      const before = current
      current = before ? new Set([...before].filter((t) => targets.has(t))) : targets
    }
    if (unknownRule) unknown = true
    else if (!current) for (const t of input.postTypes) places.add(`post:${t.wpType}`)
    else for (const t of current) places.add(t)
  }
  return { places, unknown }
}

// Field mapping -----------------------------------------------------------------------------------

const LAYOUT_ONLY = new Set(['tab', 'message', 'accordion', 'separator', 'output'])

const SIMPLE: Record<string, AcfPayloadType> = {
  text: 'text',
  textarea: 'textarea',
  number: 'number',
  range: 'number',
  email: 'email',
  url: 'text',
  oembed: 'text',
  color_picker: 'text',
  time_picker: 'text',
  wysiwyg: 'richText',
  image: 'upload',
  file: 'upload',
  gallery: 'upload',
  select: 'select',
  checkbox: 'select',
  radio: 'radio',
  button_group: 'radio',
  true_false: 'checkbox',
  date_picker: 'date',
  date_time_picker: 'date',
  link: 'link',
  post_object: 'relationship',
  page_link: 'relationship',
  relationship: 'relationship',
  taxonomy: 'relationship',
  group: 'group',
  repeater: 'array',
  flexible_content: 'blocks',
}

/** Why a field type is not imported. */
const SKIP_REASONS: Record<string, string> = {
  clone: 'clone fields repeat other fields and are not imported',
  google_map: 'map fields have no Payload equivalent',
  user: 'WordPress users are imported only as authors of items, not as values of fields',
  password: 'password fields are never imported',
}

/** A name Payload accepts: letters, digits and underscores, not starting with a digit. */
export const safeName = (name: string): string => {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, '_')
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned
}

/** Names a field of an array row or block cannot have. */
const ROW_RESERVED = new Set(['id'])
const BLOCK_RESERVED = new Set(['id', 'blockType', 'blockName'])

interface MapContext {
  input: AcfPlanInput
  collection: string
  notes: AcfPlanNote[]
}

const skipNote = (ctx: MapContext, field: AcfField, path: string, reason: string): AcfPlanNote => ({
  code: 'ACF_FIELD_SKIPPED',
  collection: ctx.collection,
  path,
  field,
  message: `ACF field "${path}" (${field.type}) of ${ctx.collection} is not imported: ${reason}.`,
})

/**
 * Payload fields for a list of ACF fields, with names unique among them. `reserved` are the
 * names of the other fields at this level; `taken` adds the ACF fields mapped before.
 */
const mapFields = (
  fields: AcfField[],
  ctx: MapContext,
  parentPath: string,
  reserved: ReadonlySet<string>,
  taken: Set<string> = new Set(reserved),
): AcfPayloadField[] => {
  const out: AcfPayloadField[] = []
  for (const field of fields) {
    const path = parentPath ? `${parentPath}.${field.name || field.label}` : field.name
    const mapped = mapField(field, ctx, path)
    if (!mapped) continue
    const wanted = safeName(field.name)
    let name = wanted
    if (taken.has(name)) {
      const base = `acf_${name}`
      name = base
      for (let n = 2; taken.has(name); n++) name = `${base}_${n}`
    }
    taken.add(name)
    mapped.name = name
    if (name !== field.name) {
      const why = reserved.has(wanted)
        ? `"${wanted}" is ${parentPath ? 'reserved by Payload' : 'a field of the collection already'}`
        : wanted !== field.name
          ? 'Payload field names may only contain letters, digits and underscores'
          : 'another ACF field here has the same name'
      ctx.notes.push({
        code: 'ACF_FIELD_RENAMED',
        collection: ctx.collection,
        path,
        field,
        message: `ACF field "${path}" of ${ctx.collection} is imported as "${name}": ${why}.`,
      })
    }
    out.push(mapped)
  }
  return out
}

const empty = (field: AcfField, type: AcfPayloadType): AcfPayloadField => ({
  name: field.name,
  acf: field,
  type,
  localized: false,
  hasMany: false,
  relationTo: [],
  options: [],
  time: false,
  fields: [],
  blocks: [],
  matchKey: false,
})

/** The Payload field for one ACF field, or undefined (with a note) when it is not imported. */
const mapField = (field: AcfField, ctx: MapContext, path: string): AcfPayloadField | undefined => {
  if (LAYOUT_ONLY.has(field.type)) {
    ctx.notes.push(
      skipNote(ctx, field, path || field.label, 'it only arranges the editor and holds no value'),
    )
    return undefined
  }
  const reason = SKIP_REASONS[field.type]
  if (reason) {
    ctx.notes.push(skipNote(ctx, field, path, reason))
    return undefined
  }
  const type = SIMPLE[field.type]
  if (!type || !field.name) {
    ctx.notes.push(
      skipNote(ctx, field, path || field.label, `the field type "${field.type}" is not supported`),
    )
    return undefined
  }
  const result = empty(field, type)
  const input = ctx.input
  switch (field.type) {
    case 'image':
    case 'file':
      result.relationTo = [input.mediaCollection]
      break
    case 'gallery':
      result.relationTo = [input.mediaCollection]
      result.hasMany = true
      break
    case 'select':
      result.options = field.choices
      result.hasMany = settingOn(field, 'multiple')
      break
    case 'checkbox':
      result.options = field.choices
      result.hasMany = true
      break
    case 'radio':
    case 'button_group':
      result.options = field.choices
      break
    case 'date_time_picker':
      result.time = true
      break
    case 'post_object':
    case 'page_link':
    case 'relationship': {
      const allowed = settingList(field, 'post_type')
      const targets = input.postTypes.filter(
        (t) => allowed.length === 0 || allowed.includes(t.wpType),
      )
      result.relationTo = [...new Set(targets.map((t) => t.collection))]
      result.hasMany = field.type === 'relationship' || settingOn(field, 'multiple')
      if (result.relationTo.length === 0) {
        ctx.notes.push(
          skipNote(
            ctx,
            field,
            path,
            `it points to ${allowed.join(', ')}, which ${allowed.length === 1 ? 'is' : 'are'} not imported`,
          ),
        )
        return undefined
      }
      break
    }
    case 'taxonomy': {
      const taxonomy = settingList(field, 'taxonomy')[0] ?? 'category'
      const target = input.taxonomies.find((t) => t.taxonomy === taxonomy)
      if (!target) {
        ctx.notes.push(skipNote(ctx, field, path, `its taxonomy ${taxonomy} is not imported`))
        return undefined
      }
      result.relationTo = [target.collection]
      result.taxonomy = taxonomy
      const single = ['select', 'radio'].includes(String(field.settings.field_type ?? ''))
      result.hasMany = !single
      break
    }
    case 'group':
      result.fields = mapFields(field.subFields, ctx, path, new Set())
      break
    case 'repeater':
      result.fields = mapFields(field.subFields, ctx, path, ROW_RESERVED)
      break
    case 'flexible_content':
      // A layout keeps its block even when none of its fields can be imported, so its rows
      // keep their place.
      result.blocks = field.layouts
        .filter((l) => l.name)
        .map((layout) => ({
          slug: safeName(layout.name),
          layout,
          fields: mapFields(layout.subFields, ctx, `${path}.${layout.name}`, BLOCK_RESERVED),
        }))
      break
  }
  const containers = { group: result.fields, array: result.fields, blocks: result.blocks }
  if (type in containers && containers[type as keyof typeof containers].length === 0) {
    ctx.notes.push(skipNote(ctx, field, path, 'it has no field that can be imported'))
    return undefined
  }
  return result
}

/** Every block of the plan, depth first. */
const blocksOf = (fields: AcfPayloadField[]): AcfPayloadBlock[] =>
  fields.flatMap((f) => [
    ...f.blocks.flatMap((b) => [b, ...blocksOf(b.fields)]),
    ...blocksOf(f.fields),
  ])

/** Block slugs of the editor that scaffold writes; ACF layouts must not reuse them. */
const EDITOR_BLOCKS = new Set(['code', 'embed'])

/**
 * Payload keeps one GraphQL type per block slug, so blocks of different layouts need different
 * slugs. A layout keeps its name unless another layout has it too; then the flexible field's name
 * goes in front.
 */
const assignBlockSlugs = (plans: AcfCollectionPlan[]) => {
  const blocks: { block: AcfPayloadBlock; field: string }[] = []
  const walk = (fields: AcfPayloadField[]) => {
    for (const f of fields) {
      for (const b of f.blocks) {
        blocks.push({ block: b, field: f.name })
        walk(b.fields)
      }
      walk(f.fields)
    }
  }
  for (const plan of plans) walk(plan.fields)
  const layoutsBySlug = new Map<string, Set<string>>()
  for (const { block } of blocks) {
    const keys = layoutsBySlug.get(block.slug.toLowerCase()) ?? new Set<string>()
    keys.add(block.layout.key || block.slug)
    layoutsBySlug.set(block.slug.toLowerCase(), keys)
  }
  const slugOfLayout = new Map<string, string>()
  const taken = new Set<string>()
  for (const { block, field } of blocks) {
    const layoutKey = block.layout.key || `${field}:${block.slug}`
    const known = slugOfLayout.get(layoutKey)
    if (known) {
      block.slug = known
      continue
    }
    let slug = block.slug
    const shared = (layoutsBySlug.get(slug.toLowerCase())?.size ?? 0) > 1
    if (shared || EDITOR_BLOCKS.has(slug.toLowerCase())) slug = `${field}_${slug}`
    const base = slug
    for (let n = 2; taken.has(slug.toLowerCase()); n++) slug = `${base}_${n}`
    taken.add(slug.toLowerCase())
    slugOfLayout.set(layoutKey, slug)
    block.slug = slug
  }
}

/** Items or terms of the targets that store a value of a top-level field. */
const countValues = (input: AcfPlanInput, targets: string[], field: AcfField): number => {
  let n = 0
  for (const target of targets)
    n += input.index.usage.get(target)?.get(field.name)?.get(field.key) ?? 0
  return n
}

/** Decides which ACF fields every collection gets and how. */
export const planAcf = (input: AcfPlanInput): AcfPlan => {
  const { definitions } = input
  const notes: AcfPlanNote[] = []
  const placesOf = new Map<AcfFieldGroup, Set<string>>()
  const unknownRules = new Set<AcfFieldGroup>()
  for (const group of definitions.groups) {
    const { places, unknown } = locationTargets(group, input)
    placesOf.set(group, places)
    if (unknown) unknownRules.add(group)
  }
  // Values stored under a group's field names count as well: rules change, and plugins add rules
  // of their own.
  for (const [target, names] of input.index.usage) {
    for (const [name, keys] of names) {
      for (const key of keys.keys()) {
        const group = definitions.groupOf.get(key)
        if (group && definitions.fields.get(key)?.name === name) placesOf.get(group)?.add(target)
      }
    }
  }

  // Collections in import order, with the targets (post types, taxonomies) they hold.
  const collections = new Map<
    string,
    { kind: 'document' | 'term'; targets: string[]; wpNames: string[] }
  >()
  const addTarget = (collection: string, kind: 'document' | 'term', target: string, wp: string) => {
    const entry = collections.get(collection) ?? { kind, targets: [], wpNames: [] }
    entry.targets.push(target)
    entry.wpNames.push(wp)
    collections.set(collection, entry)
  }
  for (const t of input.postTypes) addTarget(t.collection, 'document', `post:${t.wpType}`, t.wpType)
  for (const t of input.taxonomies)
    addTarget(t.collection, 'term', `term:${t.taxonomy}`, t.taxonomy)

  const plans = new Map<string, AcfCollectionPlan>()
  const placed = new Set<AcfFieldGroup>()
  for (const [collection, entry] of collections) {
    const groups = definitions.groups.filter((g) =>
      entry.targets.some((t) => placesOf.get(g)?.has(t)),
    )
    if (groups.length === 0) continue
    const ctx: MapContext = { input, collection, notes }
    const reserved = input.reserved(collection, entry.kind)
    const taken = new Set(reserved)
    const seenKeys = new Set<string>()
    const plan: AcfCollectionPlan = {
      collection,
      kind: entry.kind,
      wpNames: entry.wpNames,
      groups: [],
      fields: [],
    }
    for (const group of groups) {
      placed.add(group)
      const fresh = group.fields.filter((f) => !seenKeys.has(f.key))
      for (const f of fresh) seenKeys.add(f.key)
      const before = notes.length
      const fields = mapFields(fresh, ctx, '', reserved, taken)
      for (const note of notes.slice(before)) {
        if (note.path !== note.field.name || note.code !== 'ACF_FIELD_SKIPPED') continue
        note.values = countValues(input, entry.targets, note.field)
        if (note.values > 0) {
          const noun = entry.kind === 'term' ? 'term' : 'item'
          note.message += ` ${note.values} ${noun}${note.values === 1 ? ' has' : 's have'} a value.`
        }
      }
      for (const f of fields) f.localized = input.localized
      plan.groups.push({ group, fields })
      plan.fields.push(...fields)
    }
    // Fields that share an ACF name share one value in WordPress.
    const byName = new Map<string, AcfPayloadField[]>()
    for (const f of plan.fields) byName.set(f.acf.name, [...(byName.get(f.acf.name) ?? []), f])
    for (const list of byName.values()) if (list.length > 1) for (const f of list) f.matchKey = true
    plans.set(collection, plan)
  }
  assignBlockSlugs([...plans.values()])

  const unplaced = definitions.groups
    .filter((g) => !placed.has(g))
    .map((group) => {
      const where = [...(placesOf.get(group) ?? [])].map((p) =>
        p.replace(/^(post|term|other):/, ''),
      )
      if (unknownRules.has(group)) where.push('location rules of another plugin')
      return { group, where }
    })

  const undefinedValues: AcfPlan['undefinedValues'] = []
  for (const [target, names] of input.index.usage) {
    const unknown = [...names]
      .flatMap(([name, keys]) =>
        [...keys]
          .filter(([key]) => !definitions.fields.has(key))
          .map(([key, items]) => ({ target, name, key, items })),
      )
      .sort((a, b) => a.name.localeCompare(b.name))
    // Sub-fields (`rows_0_text`) of an unknown field are not listed on their own.
    for (const value of unknown) {
      if (unknown.some((o) => o !== value && value.name.startsWith(`${o.name}_`))) continue
      undefinedValues.push(value)
    }
  }

  let dateTimeFields = 0
  for (const field of definitions.fields.values()) {
    if (field.type === 'date_time_picker') dateTimeFields++
  }

  return { definitions, collections: plans, notes, unplaced, undefinedValues, dateTimeFields }
}

/** All blocks in the plan's collections, for tests and reports. */
export const planBlocks = (plan: AcfPlan): AcfPayloadBlock[] =>
  [...plan.collections.values()].flatMap((c) => blocksOf(c.fields))
