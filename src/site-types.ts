import type { Config } from './config.js'
import type { PathPatterns } from './paths/patterns.js'
import type { SiteUrlsOptions, TermArchive } from './paths/site-urls.js'
import type { WxrItemTerm, WxrTerm } from './wxr/model.js'
import { INTERNAL_TYPES, type SiteIndex } from './wxr/site-index.js'

/**
 * The post types and taxonomies of a site and where they go in Payload. WordPress does not export
 * how a type was registered, so this is read from the data: a type is hierarchical when its items
 * have parents of the same type, and a taxonomy belongs to the post types whose items use it.
 * `analyze`, `scaffold`, `import` and `redirects` all decide through this module.
 */

/** Post types of plugins that hold settings, templates or records rather than content. */
export const PLUGIN_POST_TYPES: Readonly<Record<string, string>> = {
  'acf-field-group': 'ACF field definitions',
  'acf-field': 'ACF field definitions',
  'acf-post-type': 'ACF post type settings',
  'acf-taxonomy': 'ACF taxonomy settings',
  'acf-ui-options-page': 'ACF options page settings',
  elementor_library: 'Elementor templates',
  elementor_font: 'Elementor custom fonts',
  elementor_icons: 'Elementor icon sets',
  elementor_snippet: 'Elementor code snippets',
  et_pb_layout: 'Divi library layouts',
  'fl-builder-template': 'Beaver Builder templates',
  'fl-theme-layout': 'Beaver Themer layouts',
  vc_grid_item: 'WPBakery grid templates',
  templatera: 'WPBakery templates',
  ct_template: 'Oxygen templates',
  bricks_template: 'Bricks templates',
  fusion_template: 'Avada templates',
  fusion_element: 'Avada library elements',
  wpcf7_contact_form: 'Contact Form 7 forms',
  flamingo_contact: 'Flamingo address book (personal data)',
  flamingo_inbound: 'Flamingo form messages (personal data)',
  feedback: 'Jetpack form responses (personal data)',
  wpforms: 'WPForms forms',
  wpforms_log: 'WPForms logs',
  nf_sub: 'Ninja Forms submissions (personal data)',
  'mc4wp-form': 'Mailchimp for WordPress forms',
  forminator_forms: 'Forminator forms',
  product: 'WooCommerce products',
  product_variation: 'WooCommerce product variations',
  shop_order: 'WooCommerce orders (personal data)',
  shop_order_placehold: 'WooCommerce orders (personal data)',
  shop_order_refund: 'WooCommerce refunds',
  shop_coupon: 'WooCommerce coupons',
  'scheduled-action': 'Action Scheduler jobs',
  amp_validated_url: 'AMP validation results',
  wpcode: 'WPCode snippets',
  jp_pay_order: 'Jetpack payment orders (personal data)',
  jp_pay_product: 'Jetpack payment products',
}

/**
 * Taxonomies that are not content terms. Taxonomies used only by post types that are not
 * imported (such as the categories of a form plugin) are left out as well.
 */
export const PLUGIN_TAXONOMIES: Readonly<Record<string, string>> = {
  nav_menu: 'menus, not imported yet',
  link_category: 'link categories (links manager)',
  post_format: 'post formats',
  wp_theme: 'block theme templates',
  wp_template_part_area: 'block theme template areas',
  wp_pattern_category: 'pattern categories',
  language: 'Polylang languages',
  term_language: 'Polylang languages',
  post_translations: 'Polylang translation groups',
  term_translations: 'Polylang translation groups',
  translation_priority: 'WPML translation priorities',
  product_cat: 'WooCommerce product categories',
  product_tag: 'WooCommerce product tags',
  product_type: 'WooCommerce product types',
  product_visibility: 'WooCommerce product visibility',
  product_shipping_class: 'WooCommerce shipping classes',
  elementor_library_type: 'Elementor template types',
  elementor_library_category: 'Elementor template categories',
  elementor_font_type: 'Elementor font types',
  layout_category: 'Divi library categories',
  layout_pack: 'Divi library packs',
  layout_type: 'Divi library types',
  'fl-builder-template-category': 'Beaver Builder template categories',
  'fl-builder-template-type': 'Beaver Builder template types',
  yst_prominent_words: 'Yoast internal linking data',
  flamingo_inbound_channel: 'Flamingo message channels',
}

const pluginTaxonomy = (name: string): string | undefined =>
  PLUGIN_TAXONOMIES[name] ?? (name.startsWith('pa_') ? 'WooCommerce product attributes' : undefined)

/** WordPress's own post types, imported into `collections.posts` and `collections.pages`. */
export const BUILTIN_POST_TYPES: ReadonlySet<string> = new Set(['post', 'page'])
/** WordPress's own taxonomies, imported into `collections.categories` and `collections.tags`. */
export const BUILTIN_TAXONOMIES: ReadonlySet<string> = new Set(['category', 'post_tag'])

// Survey ------------------------------------------------------------------------------------------

export interface PostTypeSurvey {
  name: string
  /** Items of every status. */
  items: number
  byStatus: Record<string, number>
  /** Some item has a parent of the same type. */
  hasParents: boolean
  /** Taxonomies of the terms on its items, sorted. */
  taxonomies: string[]
}

export interface TaxonomySurvey {
  name: string
  /** Terms listed in the export. */
  terms: number
  /** Some term has a parent. */
  hasParents: boolean
  /** Post types whose items use its terms, sorted. */
  postTypes: string[]
}

export interface TypeSurvey {
  postTypes: Map<string, PostTypeSurvey>
  taxonomies: Map<string, TaxonomySurvey>
}

/** What an item contributes to the survey; `IndexedPost` and `WxrItem` both fit. */
export interface SurveyItem {
  id: number
  type: string
  status: string
  parentId: number
  terms: WxrItemTerm[]
}

/** Collects what an export says about its post types and taxonomies, record by record. */
export class TypeSurveyor {
  private readonly types = new Map<
    string,
    { items: number; byStatus: Record<string, number>; taxonomies: Set<string> }
  >()
  private readonly taxonomies = new Map<
    string,
    { terms: number; hasParents: boolean; postTypes: Set<string> }
  >()
  private readonly typeOf = new Map<number, string>()
  private readonly parents: [id: number, parentId: number][] = []

  /** Adds an item. Attachments and WordPress internals (menu items, revisions) are ignored. */
  addItem(item: SurveyItem): void {
    if (item.type === 'attachment' || INTERNAL_TYPES.has(item.type)) return
    const type = this.types.get(item.type) ?? { items: 0, byStatus: {}, taxonomies: new Set() }
    this.types.set(item.type, type)
    type.items++
    const status = item.status || 'unknown'
    type.byStatus[status] = (type.byStatus[status] ?? 0) + 1
    for (const term of item.terms) {
      type.taxonomies.add(term.taxonomy)
      this.taxonomy(term.taxonomy).postTypes.add(item.type)
    }
    this.typeOf.set(item.id, item.type)
    if (item.parentId) this.parents.push([item.id, item.parentId])
  }

  /** Adds a term from the export's term list. Each term once, please. */
  addTerm(term: WxrTerm): void {
    const taxonomy = this.taxonomy(term.taxonomy)
    taxonomy.terms++
    if (term.parentSlug) taxonomy.hasParents = true
  }

  result(): TypeSurvey {
    const hierarchical = new Set<string>()
    for (const [id, parentId] of this.parents) {
      const type = this.typeOf.get(id)
      if (type && this.typeOf.get(parentId) === type) hierarchical.add(type)
    }
    const sorted = <T>(map: Map<string, T>) => [...map].sort(([a], [b]) => a.localeCompare(b))
    return {
      postTypes: new Map(
        sorted(this.types).map(([name, t]) => [
          name,
          {
            name,
            items: t.items,
            byStatus: t.byStatus,
            hasParents: hierarchical.has(name),
            taxonomies: [...t.taxonomies].sort(),
          },
        ]),
      ),
      taxonomies: new Map(
        sorted(this.taxonomies).map(([name, t]) => [
          name,
          { name, terms: t.terms, hasParents: t.hasParents, postTypes: [...t.postTypes].sort() },
        ]),
      ),
    }
  }

  private taxonomy(name: string) {
    const taxonomy = this.taxonomies.get(name) ?? {
      terms: 0,
      hasParents: false,
      postTypes: new Set(),
    }
    this.taxonomies.set(name, taxonomy)
    return taxonomy
  }
}

export const surveyIndex = (index: SiteIndex): TypeSurvey => {
  const surveyor = new TypeSurveyor()
  for (const term of index.terms) surveyor.addTerm(term)
  for (const post of index.posts.values()) surveyor.addItem(post)
  return surveyor.result()
}

export const EMPTY_SURVEY: TypeSurvey = { postTypes: new Map(), taxonomies: new Map() }

// Targets -----------------------------------------------------------------------------------------

/** A WordPress post type that the import writes into a Payload collection. */
export interface PostTypeTarget {
  /** WordPress post type, such as `post`, `page` or `recipe`. */
  wpType: string
  /** Import step for `--only` and the report: `posts`, `pages`, or the collection slug. */
  phase: string
  /** Payload collection slug. */
  collection: string
  /**
   * Hierarchical types (pages) may reuse a slug under different parents and get their parent
   * set after all documents exist. Slugs of other types are made unique.
   */
  hierarchical: boolean
  builtin: boolean
  /** Imported taxonomies whose terms its items carry. */
  taxonomies: string[]
}

/** A WordPress taxonomy whose terms the import writes into a Payload collection. */
export interface TaxonomyTarget {
  taxonomy: string
  /** Import step: `categories`, `tags`, or the collection slug. */
  phase: string
  collection: string
  hierarchical: boolean
  builtin: boolean
  /** Relationship field of the documents that holds their terms. */
  field: string
  /** Path of the term archives on the old site before the term: `category`, `rezeptkategorie`. */
  base: string
}

/** A post type or taxonomy in the export that is not imported, and why. */
export interface SkippedType {
  kind: 'post type' | 'taxonomy'
  name: string
  /** Items or terms in the export. */
  count: number
  reason: string
}

export interface SiteTypes {
  /** In import order: posts, pages, then custom post types by name. */
  postTypes: PostTypeTarget[]
  /** In import order: categories, tags, then custom taxonomies by name. */
  taxonomies: TaxonomyTarget[]
  skipped: SkippedType[]
  /** New URL pattern per post type: the configured ones, and a default for custom types. */
  patterns: PathPatterns
  /** Custom taxonomies whose archives have a new URL (configured with `taxonomies.<name>.path`). */
  archives: TermArchive[]
}

/** Words that are the same in plural, as far as they show up as post type names. */
const UNCOUNTABLE = new Set([
  'audio',
  'content',
  'data',
  'equipment',
  'feedback',
  'info',
  'information',
  'media',
  'music',
  'software',
  'staff',
])

const pluralize = (word: string): string => {
  if (!/[a-z]$/.test(word) || word.endsWith('s') || UNCOUNTABLE.has(word)) return word
  if (/(x|z|ch|sh)$/.test(word)) return `${word}es`
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`
  return `${word}s`
}

/** Default collection slug of a post type or taxonomy: `recipe_category` → `recipe-categories`. */
export const defaultCollectionSlug = (name: string): string => {
  const words = name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  const last = words.pop() ?? 'item'
  return [...words, pluralize(last)].join('-')
}

/** Field name for a collection slug: `recipe-categories` → `recipeCategories`. */
export const camelCase = (slug: string): string =>
  slug.replace(/[-_]+([a-z0-9])/g, (_, c: string) => c.toUpperCase()).replace(/[-_]/g, '')

/** Field names every scaffolded document collection already has, besides the configured ones. */
const RESERVED_FIELDS = ['id', '_status', 'createdAt', 'updatedAt']

/**
 * Decides which post types and taxonomies are imported, into which collections, and what their
 * new URLs are. Plugin internals are skipped unless the config names them under `postTypes` or
 * `taxonomies`, which always wins.
 */
export const resolveSiteTypes = (config: Config, survey: TypeSurvey): SiteTypes => {
  const c = config.collections
  const skipped: SkippedType[] = []
  // Collection slugs and steps that are taken, so defaults never collide.
  const collections = new Set(Object.values(c))
  for (const s of [...Object.values(config.postTypes), ...Object.values(config.taxonomies)]) {
    if (s.collection) collections.add(s.collection)
  }
  const phases = new Set(['media', 'categories', 'tags', 'authors', 'posts', 'pages', 'redirects'])
  const allocate = (name: string): string => {
    const preferred = defaultCollectionSlug(name)
    let slug = collections.has(preferred) ? `wp-${preferred}` : preferred
    for (let n = 2; collections.has(slug); n++) slug = `wp-${preferred}-${n}`
    collections.add(slug)
    return slug
  }
  const phaseFor = (collection: string, name: string): string => {
    let phase = phases.has(collection) ? name : collection
    for (let n = 2; phases.has(phase); n++) phase = `${name}-${n}`
    phases.add(phase)
    return phase
  }

  const postTypes: PostTypeTarget[] = [
    {
      wpType: 'post',
      phase: 'posts',
      collection: c.posts,
      hierarchical: false,
      builtin: true,
      taxonomies: [],
    },
    {
      wpType: 'page',
      phase: 'pages',
      collection: c.pages,
      hierarchical: true,
      builtin: true,
      taxonomies: [],
    },
  ]
  const typeNames = [...new Set([...survey.postTypes.keys(), ...Object.keys(config.postTypes)])]
  for (const name of typeNames.sort()) {
    if (BUILTIN_POST_TYPES.has(name)) continue
    const settings = config.postTypes[name]
    const found = survey.postTypes.get(name)
    const reason = PLUGIN_POST_TYPES[name]
    if (reason && !settings) {
      skipped.push({ kind: 'post type', name, count: found?.items ?? 0, reason })
      continue
    }
    const collection = settings?.collection ?? allocate(name)
    postTypes.push({
      wpType: name,
      phase: phaseFor(collection, name),
      collection,
      hierarchical: settings?.hierarchical ?? found?.hasParents ?? false,
      builtin: false,
      taxonomies: [],
    })
  }
  const imported = new Set(postTypes.map((t) => t.wpType))

  const f = config.fields
  const taxonomies: TaxonomyTarget[] = [
    {
      taxonomy: 'category',
      phase: 'categories',
      collection: c.categories,
      hierarchical: true,
      builtin: true,
      field: f.categories,
      base: 'category',
    },
    {
      taxonomy: 'post_tag',
      phase: 'tags',
      collection: c.tags,
      hierarchical: false,
      builtin: true,
      field: f.tags,
      base: 'tag',
    },
  ]
  const reservedFields = new Set([...Object.values(f), ...RESERVED_FIELDS])
  const taxonomyNames = [
    ...new Set([...survey.taxonomies.keys(), ...Object.keys(config.taxonomies)]),
  ]
  for (const name of taxonomyNames.sort()) {
    if (BUILTIN_TAXONOMIES.has(name)) continue
    const settings = config.taxonomies[name]
    const found = survey.taxonomies.get(name)
    const users = found?.postTypes ?? []
    const reason =
      pluginTaxonomy(name) ??
      (users.length > 0 && !users.some((t) => imported.has(t))
        ? `terms of ${users.join(', ')}, which ${users.length === 1 ? 'is' : 'are'} not imported`
        : undefined)
    if (reason && !settings) {
      skipped.push({ kind: 'taxonomy', name, count: found?.terms ?? 0, reason })
      continue
    }
    const collection = settings?.collection ?? allocate(name)
    let field = settings?.field ?? camelCase(defaultCollectionSlug(name))
    if (!settings?.field && reservedFields.has(field)) {
      const base = `wp${field[0]?.toUpperCase()}${field.slice(1)}`
      field = base
      for (let n = 2; reservedFields.has(field); n++) field = `${base}${n}`
    }
    reservedFields.add(field)
    taxonomies.push({
      taxonomy: name,
      phase: phaseFor(collection, name),
      collection,
      hierarchical: settings?.hierarchical ?? found?.hasParents ?? false,
      builtin: false,
      field,
      base: (settings?.base ?? name).replace(/^\/+|\/+$/g, ''),
    })
  }
  const importedTaxonomies = new Set(taxonomies.map((t) => t.taxonomy))
  for (const type of postTypes) {
    type.taxonomies = (survey.postTypes.get(type.wpType)?.taxonomies ?? []).filter((t) =>
      importedTaxonomies.has(t),
    )
  }

  const patterns: PathPatterns = { ...config.paths }
  for (const type of postTypes) {
    if (type.builtin || patterns[type.wpType] !== undefined) continue
    const configured = config.postTypes[type.wpType]?.path
    const base = defaultCollectionSlug(type.wpType)
    patterns[type.wpType] = configured ?? (type.hierarchical ? `/${base}/:path` : `/${base}/:slug`)
  }
  const archives: TermArchive[] = []
  for (const taxonomy of taxonomies) {
    const pattern = taxonomy.builtin ? undefined : config.taxonomies[taxonomy.taxonomy]?.path
    if (pattern) archives.push({ taxonomy: taxonomy.taxonomy, base: taxonomy.base, pattern })
  }
  return { postTypes, taxonomies, skipped, patterns, archives }
}

/** Options for `SiteUrls` that match the resolved types, so links and redirects agree. */
export const siteUrlsOptions = (config: Config, types: SiteTypes): SiteUrlsOptions => ({
  patterns: types.patterns,
  extraHosts: config.siteHosts,
  archives: types.archives,
})
