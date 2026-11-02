import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { AcfCollector } from '../acf/collect.js'
import { type AcfField, type AcfFieldGroup, loadAcfJson } from '../acf/definitions.js'
import { planSiteAcf } from '../acf/site.js'
import { BUILDERS, type Builder, detectBuilders } from '../content/builders.js'
import { contentSource } from '../content/elementor.js'
import { BLOCK_OPENER, blockSupport, hasBlocks, normalizeBlockName } from '../content/blocks.js'
import { scanShortcodes } from '../content/shortcodes-scan.js'
import { DEFAULT_CONFIG } from '../config.js'
import { LanguageCollector, wpmlKeysOf } from '../languages.js'
import { MenuCollector, menuLevels, placeMenus } from '../menus.js'
import {
  BUILTIN_POST_TYPES,
  BUILTIN_TAXONOMIES,
  PLUGIN_POST_TYPES,
  resolveSiteTypes,
  TypeSurveyor,
} from '../site-types.js'
import { mimeTypeOf } from '../util/mime.js'
import { VERSION } from '../version.js'
import type { WxrItem, WxrParseIssue, WxrSite, WxrTerm } from '../wxr/model.js'
import { metaValue } from '../wxr/model.js'
import { readWxr } from '../wxr/reader.js'
import { INTERNAL_TYPES, siteUrlOf } from '../wxr/site-index.js'
import { scoreComplexity } from './complexity.js'
import type {
  AnalyzeReport,
  BlockUsage,
  CustomFieldsReport,
  CustomPostType,
  CustomTaxonomy,
  Detection,
  LanguagesReport,
  MenuReport,
  NamedCount,
  StatusCounts,
} from './report.js'

const SEO_KEYS = ['yoast', 'rankmath', 'aioseo', 'seopress'] as const

type Seo = (typeof SEO_KEYS)[number]

const WOO_TYPES = new Set([
  'product',
  'product_variation',
  'shop_order',
  'shop_coupon',
  'shop_order_refund',
])
const ACF_TYPES = new Set([
  'acf-field-group',
  'acf-field',
  'acf-post-type',
  'acf-taxonomy',
  'acf-ui-options-page',
])
const SKIPPED_STATUSES = new Set(['trash', 'auto-draft'])
const POLYLANG_TAXONOMIES = new Set([
  'language',
  'post_translations',
  'term_language',
  'term_translations',
])

const detectSeo = (item: WxrItem): Seo[] => {
  const found = new Set<Seo>()
  for (const key of item.meta.keys()) {
    if (key.startsWith('_yoast_wpseo_')) found.add('yoast')
    else if (key.startsWith('rank_math_')) found.add('rankmath')
    else if (key.startsWith('_aioseo_')) found.add('aioseo')
    else if (key.startsWith('_seopress_')) found.add('seopress')
  }
  return [...found]
}

/** ACF stores a reference meta `_<field>` = `field_<key>` next to each value. */
const hasAcfMeta = (item: WxrItem): boolean => {
  for (const [key, values] of item.meta) {
    if (key.startsWith('_') && /^field_[a-z0-9]+$/i.test(values[0] ?? '')) return true
  }
  return false
}

const emptyDetection = (): Detection => ({ detected: false, items: 0 })

const statusCounts = (): StatusCounts => ({ total: 0, byStatus: {} })

const bump = (record: Record<string, number>, key: string, by = 1) => {
  record[key] = (record[key] ?? 0) + by
}

interface Usage {
  count: number
  items: number
}

const bumpUsage = (map: Map<string, Usage>, name: string, count: number) => {
  const usage = map.get(name) ?? { count: 0, items: 0 }
  usage.count += count
  usage.items += 1
  map.set(name, usage)
}

const byCount = <T extends { name: string; count: number }>(a: T, b: T) =>
  b.count - a.count || a.name.localeCompare(b.name)

export interface AnalyzeOptions {
  /** ACF JSON files or folders with field groups that are not in the export. */
  acfJson?: string[]
}

/** Streams an export once and builds the analysis report. Needs no Payload project. */
export const analyzeExport = async (
  file: string,
  options: AnalyzeOptions = {},
): Promise<AnalyzeReport> => {
  const acfJson: AcfFieldGroup[] = await loadAcfJson(options.acfJson ?? [])
  let site: WxrSite | undefined
  const terms: WxrTerm[] = []
  const termKeys = new Set<string>()
  const issues: WxrParseIssue[] = []
  let authors = 0

  const posts = statusCounts()
  const pages = statusCounts()
  let attachments = 0
  let comments = 0
  let menuItems = 0
  const surveyor = new TypeSurveyor()
  const languageCollector = new LanguageCollector()
  /** Content items that count per language: no images, menus, trash or auto-drafts. */
  const languageItems = new Set<number>()
  const mediaTypes: Record<string, number> = {}
  const mediaHosts = new Set<string>()
  const blocks = new Map<string, Usage>()
  const shortcodes = new Map<string, Usage>()
  let gutenbergItems = 0
  let classicItems = 0
  let emptyItems = 0
  let passwordProtected = 0

  const builders = Object.fromEntries(BUILDERS.map((k) => [k, emptyDetection()])) as Record<
    Builder,
    Detection
  >
  const seo = Object.fromEntries(SEO_KEYS.map((k) => [k, emptyDetection()])) as Record<
    Seo,
    Detection
  >
  const seoWithTitle: Record<Seo, number> = { yoast: 0, rankmath: 0, aioseo: 0, seopress: 0 }
  const wpml = emptyDetection()
  const polylang = emptyDetection()
  const woo = emptyDetection()
  const wooTypes: Record<string, number> = {}
  const elementorWidgets = new Map<string, number>()
  const elementorUnknown = new Set<string>()
  let elementorConverted = 0
  let elementorInvalid = 0
  const acf = emptyDetection()
  let acfFieldGroups = 0
  let acfFields = 0
  const acfCollector = new AcfCollector()
  const menuCollector = new MenuCollector()
  const typeOfPost = new Map<number, string>()

  const scanContent = (item: WxrItem) => {
    const content = item.content
    if (content.trim() === '') {
      emptyItems++
      return
    }
    if (hasBlocks(content)) {
      gutenbergItems++
      const perItem = new Map<string, number>()
      for (const match of content.matchAll(BLOCK_OPENER)) {
        const name = normalizeBlockName(match[1] ?? '')
        perItem.set(name, (perItem.get(name) ?? 0) + 1)
      }
      for (const [name, count] of perItem) bumpUsage(blocks, name, count)
    } else {
      classicItems++
    }
    for (const [name, count] of scanShortcodes(content)) bumpUsage(shortcodes, name, count)
  }

  for await (const record of readWxr(file, { onIssue: (i) => issues.push(i) })) {
    if (record.kind === 'site') {
      site = record.site
      continue
    }
    if (record.kind === 'author') {
      authors++
      continue
    }
    if (record.kind === 'term') {
      // Some exports list a term twice (as wp:category and as wp:term).
      const key = `${record.term.taxonomy}:${record.term.slug}`
      if (!termKeys.has(key)) {
        termKeys.add(key)
        terms.push(record.term)
        surveyor.addTerm(record.term)
        languageCollector.addTerm(record.term)
        acfCollector.addTerm(record.term)
        menuCollector.addTerm(record.term)
      }
      continue
    }

    const { item } = record
    surveyor.addItem(item)
    acfCollector.addItem(item)
    menuCollector.addItem(item)
    typeOfPost.set(item.id, item.type)
    const wpmlKeys = wpmlKeysOf(item.meta)
    languageCollector.addItem(
      {
        id: item.id,
        type: item.type,
        status: item.status,
        link: item.link,
        terms: item.terms,
        ...(wpmlKeys ? { wpml: wpmlKeys } : {}),
      },
      [...item.meta.keys()].some((k) => k.startsWith('_icl_')),
    )
    comments += item.commentCount

    if (item.type === 'attachment') {
      attachments++
      const url = item.attachmentUrl ?? item.guid
      bump(mediaTypes, mimeTypeOf(url))
      try {
        mediaHosts.add(new URL(url).host)
      } catch {
        // Relative or broken URL; nothing to record.
      }
      continue
    }
    if (item.type === 'nav_menu_item') {
      menuItems++
      continue
    }
    if (INTERNAL_TYPES.has(item.type)) continue
    if (item.type === 'acf-field-group') acfFieldGroups++
    if (item.type === 'acf-field') acfFields++
    if (ACF_TYPES.has(item.type)) continue

    if (WOO_TYPES.has(item.type)) {
      woo.items++
      bump(wooTypes, item.type)
    }

    if (item.type === 'post') {
      posts.total++
      bump(posts.byStatus, item.status || 'unknown')
    } else if (item.type === 'page') {
      pages.total++
      bump(pages.byStatus, item.status || 'unknown')
    }

    // Trashed and auto-saved items are counted by status but never migrated, so their content
    // does not count; neither does that of plugin types such as page builder templates.
    if (SKIPPED_STATUSES.has(item.status) || PLUGIN_POST_TYPES[item.type]) continue
    languageItems.add(item.id)
    if (item.hasPassword) passwordProtected++
    scanContent(item)

    const itemBuilders = detectBuilders(item)
    for (const builder of itemBuilders) builders[builder].items++
    if (itemBuilders.includes('elementor')) {
      // The same decision as the import: Elementor's widgets, or the stored HTML.
      const source = contentSource(item)
      if (source.elementor) {
        elementorConverted++
        for (const [type, n] of source.elementor.widgets) {
          elementorWidgets.set(type, (elementorWidgets.get(type) ?? 0) + n)
        }
        for (const type of source.elementor.unknown) elementorUnknown.add(type)
      } else if (source.warnings.some((w) => w.code === 'BUILDER_DATA_INVALID')) {
        elementorInvalid++
      }
    }
    for (const plugin of detectSeo(item)) {
      seo[plugin].items++
      const titleKey = {
        yoast: '_yoast_wpseo_title',
        rankmath: 'rank_math_title',
        aioseo: '_aioseo_title',
        seopress: '_seopress_titles_title',
      }[plugin]
      if (metaValue(item, titleKey)) seoWithTitle[plugin]++
    }
    if ([...item.meta.keys()].some((k) => k.startsWith('_icl_') || k.startsWith('_wpml_'))) {
      wpml.items++
    } else if (item.terms.some((t) => t.taxonomy === 'translation_priority')) {
      wpml.items++
    }
    if (item.terms.some((t) => POLYLANG_TAXONOMIES.has(t.taxonomy))) polylang.items++
    if (hasAcfMeta(item)) acf.items++
  }

  const finish = (d: Detection) => ({ ...d, detected: d.detected || d.items > 0 })

  let languagesReport: LanguagesReport | undefined
  const siteLanguages = languageCollector.result(DEFAULT_CONFIG, site?.language ?? '')
  if (siteLanguages) {
    const perLanguage = new Map<string, number>()
    let untranslated = 0
    const groups = new Set<ReadonlyMap<string, number>>()
    for (const id of languageItems) {
      const language = siteLanguages.itemLanguage.get(id) ?? siteLanguages.defaultLanguage
      perLanguage.set(language, (perLanguage.get(language) ?? 0) + 1)
      const group = siteLanguages.itemTranslations.get(id)
      if (group && group.size > 1) groups.add(group)
      else untranslated++
    }
    let complete = 0
    for (const group of groups) if (group.size >= siteLanguages.languages.length) complete++
    languagesReport = {
      source: siteLanguages.source,
      defaultLanguage: siteLanguages.defaultLanguage,
      defaultFrom: siteLanguages.defaultFrom,
      languages: siteLanguages.languages.map((l) => ({
        ...l,
        items: perLanguage.get(l.code) ?? 0,
      })),
      groups: { complete, incomplete: groups.size - complete },
      untranslated,
    }
  }

  for (const key of BUILDERS) builders[key] = finish(builders[key])
  if (elementorConverted > 0 || elementorInvalid > 0) {
    builders.elementor.details = {
      converted: elementorConverted,
      invalidData: elementorInvalid,
      widgets: Object.fromEntries(
        [...elementorWidgets].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
      ),
      withoutConverter: [...elementorUnknown].sort(),
    }
  }
  for (const key of SEO_KEYS) {
    seo[key] = finish(seo[key])
    if (seo[key].detected) seo[key].details = { itemsWithTitle: seoWithTitle[key] }
  }

  const languages = terms.filter((t) => t.taxonomy === 'language').map((t) => t.slug)
  if (languages.length > 0) polylang.details = { languages }
  polylang.detected = polylang.items > 0 || languages.length > 0
  wpml.detected = wpml.items > 0 || terms.some((t) => t.taxonomy === 'translation_priority')

  const productCategories = terms.filter((t) => t.taxonomy === 'product_cat').length
  woo.detected = woo.items > 0 || productCategories > 0
  if (woo.detected) woo.details = { ...wooTypes, product_cat: productCategories }

  acf.detected = acf.items > 0 || acfFieldGroups > 0
  if (acf.detected) acf.details = { fieldGroups: acfFieldGroups, fields: acfFields }

  const otherTerms: Record<string, number> = {}
  for (const term of terms) {
    if (term.taxonomy !== 'category' && term.taxonomy !== 'post_tag')
      bump(otherTerms, term.taxonomy)
  }

  // What the import does with each custom type, with the default settings.
  const survey = surveyor.result()
  const types = resolveSiteTypes(DEFAULT_CONFIG, survey)
  const reasonOf = (kind: 'post type' | 'taxonomy', name: string) =>
    types.skipped.find((s) => s.kind === kind && s.name === name)?.reason
  const customPostTypes: Record<string, number> = {}
  const customTypeList: CustomPostType[] = []
  for (const t of survey.postTypes.values()) {
    if (BUILTIN_POST_TYPES.has(t.name)) continue
    const target = types.postTypes.find((x) => x.wpType === t.name)
    if (target) customPostTypes[t.name] = t.items
    const reason = reasonOf('post type', t.name)
    customTypeList.push({
      name: t.name,
      items: t.items,
      byStatus: t.byStatus,
      hierarchical: target?.hierarchical ?? t.hasParents,
      taxonomies: t.taxonomies,
      imported: target !== undefined,
      ...(reason ? { reason } : {}),
    })
  }
  const customTaxonomyList: CustomTaxonomy[] = []
  for (const t of survey.taxonomies.values()) {
    // Menus have their own count.
    if (BUILTIN_TAXONOMIES.has(t.name) || t.name === 'nav_menu') continue
    const target = types.taxonomies.find((x) => x.taxonomy === t.name)
    const reason = reasonOf('taxonomy', t.name)
    customTaxonomyList.push({
      name: t.name,
      terms: t.terms,
      hierarchical: target?.hierarchical ?? t.hasParents,
      postTypes: t.postTypes,
      imported: target !== undefined,
      ...(reason ? { reason } : {}),
    })
  }

  // ACF fields, as the import would bring them over with the default settings.
  let customFields: CustomFieldsReport | undefined
  const acfIndex = acfCollector.result()
  if (acf.detected || acfJson.length > 0) {
    const plan = planSiteAcf({
      acf: acfIndex,
      json: acfJson,
      config: DEFAULT_CONFIG,
      types,
      survey,
      typeOfPost: (id) => typeOfPost.get(id),
      localized: languagesReport !== undefined,
    })
    const fieldTypes: Record<string, number> = {}
    for (const field of plan.definitions.fields.values()) bump(fieldTypes, field.type || 'unknown')
    const countFields = (fields: AcfField[]): number =>
      fields.reduce(
        (n, f) =>
          n +
          1 +
          countFields(f.subFields) +
          f.layouts.reduce((m, l) => m + countFields(l.subFields), 0),
        0,
      )
    const placed = new Map<string, string[]>()
    for (const c of plan.collections.values()) {
      for (const { group } of c.groups)
        placed.set(group.key, [...(placed.get(group.key) ?? []), c.collection])
    }
    customFields = {
      groups: plan.definitions.groups.map((g) => ({
        key: g.key,
        title: g.title,
        source: g.source,
        fields: countFields(g.fields),
        collections: placed.get(g.key) ?? [],
        elsewhere: plan.unplaced.find((u) => u.group === g)?.where ?? [],
      })),
      fieldTypes,
      collections: [...plan.collections.values()].map((c) => ({
        collection: c.collection,
        fields: c.fields.map((f) => f.name),
      })),
      notes: plan.notes.map((n) => ({
        code: n.code,
        collection: n.collection,
        field: n.path,
        type: n.field.type,
        message: n.message,
        ...(n.values === undefined ? {} : { values: n.values }),
      })),
      undefinedValues: plan.undefinedValues,
      dateTimeFields: plan.dateTimeFields,
    }
  }

  const menus: MenuReport[] = placeMenus(menuCollector.result(), DEFAULT_CONFIG, siteLanguages).map(
    (p) => ({
      name: p.menu.name,
      slug: p.menu.slug,
      items: p.menu.items.length,
      levels: menuLevels(p.menu),
      ...(p.language ? { language: p.language } : {}),
      ...(p.global ? { global: p.global } : {}),
      reason: p.reason,
    }),
  )

  const toList = (map: Map<string, Usage>): NamedCount[] =>
    [...map].map(([name, u]) => ({ name, count: u.count, items: u.items })).sort(byCount)

  const blockList: BlockUsage[] = toList(blocks).map((b) => ({
    ...b,
    support: blockSupport(b.name),
  }))

  const s = site ?? {
    title: '',
    link: '',
    description: '',
    language: '',
    wxrVersion: '',
    baseSiteUrl: '',
    baseBlogUrl: '',
    generator: '',
  }
  const wpVersion = /[?&]v=([\w.-]+)/.exec(s.generator)?.[1]

  const report: AnalyzeReport = {
    tool: { name: 'wp-to-payload', version: VERSION },
    generatedAt: new Date().toISOString(),
    source: { file: basename(file), bytes: (await stat(file)).size },
    site: {
      title: s.title,
      url: siteUrlOf(s),
      language: s.language,
      wxrVersion: s.wxrVersion,
      ...(wpVersion ? { wordpressVersion: wpVersion } : {}),
      multisite:
        s.baseSiteUrl !== '' &&
        s.baseBlogUrl !== '' &&
        s.baseSiteUrl.replace(/\/+$/, '') !== s.baseBlogUrl.replace(/\/+$/, ''),
    },
    counts: {
      posts,
      pages,
      attachments,
      categories: terms.filter((t) => t.taxonomy === 'category').length,
      tags: terms.filter((t) => t.taxonomy === 'post_tag').length,
      otherTerms,
      authors,
      comments,
      menuItems,
      customPostTypes,
    },
    customTypes: { postTypes: customTypeList, taxonomies: customTaxonomyList },
    ...(languagesReport ? { languages: languagesReport } : {}),
    content: {
      gutenbergItems,
      classicItems,
      emptyItems,
      passwordProtected,
      blocks: blockList,
      shortcodes: toList(shortcodes),
    },
    media: { byType: mediaTypes, hosts: [...mediaHosts].sort() },
    builders,
    seo,
    multilingual: { wpml, polylang },
    woocommerce: woo,
    acf,
    ...(customFields ? { customFields } : {}),
    menus,
    complexity: { level: 'simple', score: 0, reasons: [] },
    issues,
  }
  report.complexity = scoreComplexity(report)
  return report
}
