import { heading, out, paint, table } from '../cli/output.js'
import type { AnalyzeReport } from './report.js'

const LEVEL_STYLE = { simple: 'green', medium: 'yellow', complex: 'red' } as const

export const printSummary = (r: AnalyzeReport): void => {
  heading(`${r.site.title || r.source.file}  ${paint('dim', r.site.url)}`)
  out()
  const c = r.counts
  table([
    ['Posts', c.posts.total],
    ['Pages', c.pages.total],
    ['Media files', c.attachments],
    ['Categories', c.categories],
    ['Tags', c.tags],
    ['Authors', c.authors],
    ['Comments', c.comments],
    ...Object.entries(c.customPostTypes).map(([t, n]): [string, number] => [`Type "${t}"`, n]),
  ])
  out()

  const found: string[] = []
  const names: [string, boolean][] = [
    ['Elementor', r.builders.elementor.detected],
    ['Divi', r.builders.divi.detected],
    ['WPBakery', r.builders.wpbakery.detected],
    ['Beaver Builder', r.builders.beaver.detected],
    ['Oxygen', r.builders.oxygen.detected],
    ['Bricks', r.builders.bricks.detected],
    ['Avada', r.builders.avada.detected],
    ['Yoast SEO', r.seo.yoast.detected],
    ['Rank Math', r.seo.rankmath.detected],
    ['All in One SEO', r.seo.aioseo.detected],
    ['SEOPress', r.seo.seopress.detected],
    ['WPML', r.multilingual.wpml.detected],
    ['Polylang', r.multilingual.polylang.detected],
    ['WooCommerce', r.woocommerce.detected],
    ['ACF', r.acf.detected],
  ]
  for (const [name, detected] of names) if (detected) found.push(name)
  out(`  Editor       ${r.content.gutenbergItems} block, ${r.content.classicItems} classic`)
  out(`  Detected     ${found.join(', ') || 'no builders or plugins'}`)
  if (r.languages) {
    const l = r.languages
    out(
      `  Languages    ${l.languages.map((x) => `${x.code} (${x.items})`).join(', ')}, default ${l.defaultLanguage}; ${l.groups.complete + l.groups.incomplete} translation groups`,
    )
  }
  if (r.customFields) {
    const c = r.customFields
    const imported = c.collections.reduce((n, x) => n + x.fields.length, 0)
    const skipped = c.notes.filter((n) => n.code === 'ACF_FIELD_SKIPPED').length
    out(
      `  ACF fields   ${c.groups.length} groups; ${imported} fields in ${c.collections.map((x) => x.collection).join(', ') || 'no collection'}${skipped > 0 ? `, ${skipped} not imported` : ''}${c.undefinedValues.length > 0 ? `, ${c.undefinedValues.length} without a definition` : ''}`,
    )
  }
  const menus = r.menus.filter((m) => m.items > 0)
  if (menus.length > 0) {
    out(
      `  Menus        ${menus.map((m) => `${m.name} → ${m.global ? `${m.global}${m.language ? ` (${m.language})` : ''}` : 'not imported'}`).join(', ')}`,
    )
  }
  const pluginData = r.customTypes.postTypes.filter((t) => !t.imported)
  if (pluginData.length > 0) {
    out(
      `  Plugin data  ${pluginData.map((t) => `${t.name} (${t.items})`).join(', ')}: not imported`,
    )
  }
  const unsupported = r.content.blocks.filter((b) => b.support === 'unknown').map((b) => b.name)
  if (unsupported.length > 0) out(`  No converter ${unsupported.join(', ')}`)
  if (r.content.shortcodes.length > 0) {
    out(`  Shortcodes   ${r.content.shortcodes.map((s) => s.name).join(', ')}`)
  }
  out()
  const level = r.complexity.level
  out(
    `  Complexity   ${paint(['bold', LEVEL_STYLE[level]], level.toUpperCase())} (score ${r.complexity.score})`,
  )
  for (const reason of r.complexity.reasons)
    out(`               +${reason.points} ${reason.reason}`)
  if (r.issues.length > 0)
    out(paint('yellow', `  ${r.issues.length} XML errors were skipped; see the report.`))
}
