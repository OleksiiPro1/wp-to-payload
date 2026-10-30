import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { BUILDERS, type Builder, detectBuilders } from '../content/builders.js'
import { BLOCK_OPENER, blockSupport, hasBlocks, normalizeBlockName } from '../content/blocks.js'
import { scanShortcodes } from '../content/shortcodes-scan.js'
import { mimeTypeOf } from '../util/mime.js'
import { VERSION } from '../version.js'
import type { WxrItem, WxrParseIssue, WxrSite, WxrTerm } from '../wxr/model.js'
import { metaValue } from '../wxr/model.js'
import { readWxr } from '../wxr/reader.js'
import { INTERNAL_TYPES, siteUrlOf } from '../wxr/site-index.js'
import { scoreComplexity } from './complexity.js'
import type { AnalyzeReport, BlockUsage, Detection, NamedCount, StatusCounts } from './report.js'

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

/** Streams an export once and builds the analysis report. Needs no Payload project. */
export const analyzeExport = async (file: string): Promise<AnalyzeReport> => {
  let site: WxrSite | undefined
  const terms: WxrTerm[] = []
  const issues: WxrParseIssue[] = []
  let authors = 0

  const posts = statusCounts()
  const pages = statusCounts()
  let attachments = 0
  let comments = 0
  let menuItems = 0
  const customPostTypes: Record<string, number> = {}
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
  const acf = emptyDetection()
  let acfFieldGroups = 0
  let acfFields = 0

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
      terms.push(record.term)
      continue
    }

    const { item } = record
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
    } else if (!WOO_TYPES.has(item.type)) {
      bump(customPostTypes, item.type)
    }

    // Trashed and auto-saved items are counted by status but never migrated, so their content
    // does not count.
    if (SKIPPED_STATUSES.has(item.status)) continue
    if (item.hasPassword) passwordProtected++
    scanContent(item)

    for (const builder of detectBuilders(item)) builders[builder].items++
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

  for (const key of BUILDERS) builders[key] = finish(builders[key])
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
    complexity: { level: 'simple', score: 0, reasons: [] },
    issues,
  }
  report.complexity = scoreComplexity(report)
  return report
}
