import type { WxrItem } from '../wxr/model.js'
import { metaValue } from '../wxr/model.js'

export const BUILDERS = [
  'elementor',
  'divi',
  'wpbakery',
  'beaver',
  'oxygen',
  'bricks',
  'avada',
] as const
export type Builder = (typeof BUILDERS)[number]

export const BUILDER_LABELS: Record<Builder, string> = {
  elementor: 'Elementor',
  divi: 'Divi',
  wpbakery: 'WPBakery',
  beaver: 'Beaver Builder',
  oxygen: 'Oxygen',
  bricks: 'Bricks',
  avada: 'Avada',
}

/** Page builders used by an item, from its content and post meta. */
export const detectBuilders = (item: Pick<WxrItem, 'content' | 'meta'>): Builder[] => {
  const found: Builder[] = []
  const has = (key: string) => item.meta.has(key)
  const c = item.content
  if (has('_elementor_data') || metaValue(item, '_elementor_edit_mode') === 'builder') {
    found.push('elementor')
  }
  if (c.includes('[et_pb_') || metaValue(item, '_et_pb_use_builder') === 'on') found.push('divi')
  if (c.includes('[vc_row') || c.includes('[vc_column') || has('_wpb_vc_js_status')) {
    found.push('wpbakery')
  }
  if (metaValue(item, '_fl_builder_enabled') === '1' || has('_fl_builder_data'))
    found.push('beaver')
  if (has('ct_builder_shortcodes') || has('_ct_builder_json') || has('ct_builder_json')) {
    found.push('oxygen')
  }
  if (has('_bricks_page_content_2') || has('_bricks_editor_mode')) found.push('bricks')
  if (c.includes('[fusion_')) found.push('avada')
  return found
}
