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
  const multilingual = [
    report.multilingual.wpml.detected ? 'WPML' : '',
    report.multilingual.polylang.detected ? 'Polylang' : '',
  ].filter(Boolean)
  if (multilingual.length > 0) {
    forceComplex = true
    add(
      3,
      `${multilingual.join(' and ')} multilingual content (translations are not linked in 0.1)`,
    )
  }
  if (report.acf.detected) add(2, 'Advanced Custom Fields (custom fields are not migrated in 0.1)')

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
