import { CORE_SHORTCODES, isBuilderShortcode } from '../content/shortcodes-scan.js'
import type { AnalyzeReport, Complexity, ComplexityReason } from './report.js'

/** Score thresholds: below MEDIUM is simple, below COMPLEX is medium. */
export const MEDIUM_SCORE = 3
export const COMPLEX_SCORE = 6

const BUILDER_NAMES: Record<string, string> = {
  elementor: 'Elementor',
  divi: 'Divi',
  wpbakery: 'WPBakery',
  beaver: 'Beaver Builder',
  oxygen: 'Oxygen',
  bricks: 'Bricks',
  avada: 'Avada (Fusion Builder)',
}

/**
 * Rule-based estimate of migration effort. Every rule that applies adds points and a reason, so
 * the report explains the result. Page builders, WooCommerce and multilingual content make a
 * site complex on their own, because version 0.1 does not migrate them.
 */
export const scoreComplexity = (
  report: Omit<AnalyzeReport, 'complexity'>,
): { level: Complexity; score: number; reasons: ComplexityReason[] } => {
  const reasons: ComplexityReason[] = []
  let forceComplex = false
  const add = (points: number, reason: string) => reasons.push({ points, reason })

  const items = report.counts.posts.total + report.counts.pages.total
  if (items > 1000) add(2, `${items} posts and pages`)
  else if (items > 200) add(1, `${items} posts and pages`)

  if (report.counts.attachments > 2000) add(1, `${report.counts.attachments} media files`)

  for (const [key, detection] of Object.entries(report.builders)) {
    if (!detection.detected) continue
    const details = detection.details ?? {}
    const converted = typeof details.converted === 'number' ? details.converted : 0
    const invalid = typeof details.invalidData === 'number' ? details.invalidData : 0
    const unknown = Array.isArray(details.withoutConverter) ? details.withoutConverter : []
    if (key === 'elementor' && converted > 0 && converted >= detection.items - invalid) {
      // Elementor's widgets are converted; its layout has to be rebuilt.
      add(3, `Elementor on ${detection.items} items (widgets are converted, the layout is not)`)
      if (unknown.length > 0) add(1, `Elementor widgets without a converter: ${unknown.join(', ')}`)
      if (invalid > 0) {
        forceComplex = true
        add(2, `broken Elementor data on ${invalid} items (their stored HTML is used)`)
      }
      continue
    }
    forceComplex = true
    add(
      3,
      `${BUILDER_NAMES[key] ?? key} page builder on ${detection.items} items (content is flattened to text)`,
    )
  }

  if (report.woocommerce.detected) {
    forceComplex = true
    add(3, 'WooCommerce data (shop data is not migrated in 0.1)')
  }
  const languages = report.languages
  if (report.multilingual.wpml.detected || report.multilingual.polylang.detected) {
    if (languages && languages.source !== 'url') {
      const plugin = languages.source === 'polylang' ? 'Polylang' : 'WPML, experimental'
      add(
        2,
        `${languages.languages.length} languages (${plugin}): each translation group becomes one document with locales`,
      )
    } else {
      // Without Polylang's languages or WPML Export and Import, translations cannot be linked.
      forceComplex = true
      add(
        3,
        'multilingual content without data that links translations (WPML needs its WPML Export and Import add-on)',
      )
    }
  }
  const fields = report.customFields
  if (fields) {
    const imported = fields.collections.reduce((n, c) => n + c.fields.length, 0)
    if (imported > 0) {
      add(1, `${imported} ACF fields become Payload fields (check them after scaffold)`)
    }
    const lost = fields.notes.filter((n) => n.code === 'ACF_FIELD_SKIPPED' && (n.values ?? 0) > 0)
    if (lost.length > 0) {
      add(1, `ACF fields with values that are not imported: ${lost.map((n) => n.field).join(', ')}`)
    }
    if (fields.undefinedValues.length > 0) {
      add(
        2,
        `values of ${fields.undefinedValues.length} ACF fields without a definition in the export (pass the theme's acf-json with --acf-json)`,
      )
    }
  } else if (report.acf.detected) {
    add(1, 'Advanced Custom Fields')
  }

  const customTypes = Object.keys(report.counts.customPostTypes)
  if (customTypes.length > 0) {
    add(Math.min(customTypes.length, 3), `custom post types: ${customTypes.join(', ')}`)
  }

  const unknownBlocks = report.content.blocks.filter((b) => b.support === 'unknown')
  if (unknownBlocks.length > 5) add(2, `${unknownBlocks.length} block types without a converter`)
  else if (unknownBlocks.length > 0) {
    add(1, `block types without a converter: ${unknownBlocks.map((b) => b.name).join(', ')}`)
  }

  // Builder shortcodes are already scored with their builder.
  const pluginShortcodes = report.content.shortcodes.filter(
    (s) => !CORE_SHORTCODES.has(s.name) && !isBuilderShortcode(s.name),
  )
  const shortcodeItems = Math.max(0, ...pluginShortcodes.map((s) => s.items))
  if (pluginShortcodes.length > 0) {
    const share = items > 0 ? shortcodeItems / items : 0
    add(share > 0.2 ? 2 : 1, `plugin shortcodes: ${pluginShortcodes.map((s) => s.name).join(', ')}`)
  }

  if (report.site.multisite) add(1, 'exported from a multisite network')
  if (report.issues.length > 0) add(1, `${report.issues.length} XML errors in the export`)

  const score = reasons.reduce((sum, r) => sum + r.points, 0)
  const level: Complexity =
    forceComplex || score >= COMPLEX_SCORE ? 'complex' : score >= MEDIUM_SCORE ? 'medium' : 'simple'
  return { level, score, reasons }
}
