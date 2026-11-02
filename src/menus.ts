import type { Config } from './config.js'
import type { SiteLanguages } from './languages.js'
import { decodeEntities } from './util/entities.js'
import type { WxrItem, WxrTerm } from './wxr/model.js'
import { metaValue } from './wxr/model.js'

/**
 * WordPress menus. An export has a `nav_menu` term per menu and a `nav_menu_item` item per
 * entry, which names its menu as a term and keeps the rest in post meta: what it links to
 * (`_menu_item_type`, `_menu_item_object`, `_menu_item_object_id`, `_menu_item_url`), its
 * parent entry and whether it opens a new tab. Which menu a theme shows where is a theme setting
 * and not in the export, so menus go into Payload's `header` and `footer` globals by the config
 * or by their names.
 */

export interface MenuItem {
  id: number
  /** Position in the menu. */
  order: number
  /** The parent entry's ID, or 0. */
  parentId: number
  /** `post_type`, `taxonomy`, `custom` or `post_type_archive`. */
  type: string
  /** Post type, taxonomy or `custom`. */
  object: string
  objectId: number
  url: string
  newTab: boolean
  /** The label set in the menu editor; empty when the menu shows the linked item's title. */
  title: string
}

export interface WpMenu {
  slug: string
  name: string
  /** In menu order. */
  items: MenuItem[]
}

/** An entry with its depth in the menu: 0 for the top level. */
export interface FlatMenuItem {
  item: MenuItem
  depth: number
}

/** Collects menus record by record. */
export class MenuCollector {
  private readonly names = new Map<string, string>()
  private readonly items = new Map<string, MenuItem[]>()

  addTerm(term: WxrTerm): void {
    if (term.taxonomy === 'nav_menu') this.names.set(term.slug, decodeEntities(term.name))
  }

  addItem(item: WxrItem): void {
    if (item.type !== 'nav_menu_item' || item.status === 'trash' || item.status === 'draft') return
    const menu = item.terms.find((t) => t.taxonomy === 'nav_menu')
    if (!menu) return
    if (!this.names.has(menu.slug)) this.names.set(menu.slug, decodeEntities(menu.name))
    const number = (key: string) => Number(metaValue(item, key) ?? 0) || 0
    const list = this.items.get(menu.slug) ?? []
    list.push({
      id: item.id,
      order: item.menuOrder,
      parentId: number('_menu_item_menu_item_parent'),
      type: metaValue(item, '_menu_item_type') ?? 'custom',
      object: metaValue(item, '_menu_item_object') ?? 'custom',
      objectId: number('_menu_item_object_id'),
      url: (metaValue(item, '_menu_item_url') ?? '').trim(),
      newTab: metaValue(item, '_menu_item_target') === '_blank',
      title: decodeEntities(item.title).trim(),
    })
    this.items.set(menu.slug, list)
  }

  /** Menus in the order of their names, empty ones included. */
  result(): WpMenu[] {
    return [...this.names]
      .map(([slug, name]) => ({
        slug,
        name,
        items: (this.items.get(slug) ?? []).sort((a, b) => a.order - b.order || a.id - b.id),
      }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug))
  }
}

/** The entries of a menu in reading order: each parent followed by its submenu. */
export const flattenMenu = (menu: WpMenu): FlatMenuItem[] => {
  const ids = new Set(menu.items.map((i) => i.id))
  const children = new Map<number, MenuItem[]>()
  for (const item of menu.items) {
    // Entries whose parent is gone are shown at the top level, as WordPress does.
    const parent = ids.has(item.parentId) && item.parentId !== item.id ? item.parentId : 0
    children.set(parent, [...(children.get(parent) ?? []), item])
  }
  const out: FlatMenuItem[] = []
  const seen = new Set<number>()
  const walk = (parent: number, depth: number) => {
    for (const item of children.get(parent) ?? []) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      out.push({ item, depth })
      walk(item.id, depth + 1)
    }
  }
  walk(0, 0)
  // Entries in a loop of parents still appear, at the end.
  for (const item of menu.items) if (!seen.has(item.id)) out.push({ item, depth: 1 })
  return out
}

/** Number of levels: 1 for a flat menu. */
export const menuLevels = (menu: WpMenu): number =>
  menu.items.length === 0 ? 0 : Math.max(...flattenMenu(menu).map((f) => f.depth)) + 1

/** The language of a menu: the one most of its linked items and terms are in. */
export const menuLanguage = (menu: WpMenu, languages: SiteLanguages): string => {
  const counts = new Map<string, number>()
  for (const item of menu.items) {
    const language =
      item.type === 'post_type'
        ? languages.itemLanguage.get(item.objectId)
        : item.type === 'taxonomy'
          ? languages.termLanguage.get(item.objectId)
          : undefined
    if (language) counts.set(language, (counts.get(language) ?? 0) + 1)
  }
  let best = languages.defaultLanguage
  let most = 0
  for (const [language, n] of counts) {
    if (n > most || (n === most && language === languages.defaultLanguage)) {
      best = language
      most = n
    }
  }
  return best
}

/** Where a menu goes: a global and, on multilingual sites, a language; or why it does not. */
export interface MenuPlacement {
  menu: WpMenu
  /** Payload global slug. */
  global?: string
  language?: string
  /** How the global was chosen, or why the menu is not imported. */
  reason: string
  /** The config set the menu to false: not imported, on purpose. */
  excluded?: boolean
}

const FOOTER = /foot|fu(ß|ss)|bottom|legal|unten|secondary|pied|pie de/i
const HEADER = /main|primary|header|haupt|top|navigation|principal|kopf/i

/**
 * Decides which global each menu goes into. The config (`menus`, by menu slug or name) comes
 * first; then names: footer menus by words like "footer", header menus by words like "main" or
 * "Hauptmenü". A language without a header menu gets its largest remaining menu. One menu per
 * global and language.
 */
export const placeMenus = (
  menus: WpMenu[],
  config: Config,
  languages: SiteLanguages | undefined,
): MenuPlacement[] => {
  const languageOf = (menu: WpMenu) => (languages ? menuLanguage(menu, languages) : undefined)
  const taken = new Map<string, WpMenu>()
  const key = (global: string, language: string | undefined) => `${global}:${language ?? ''}`
  const placements = new Map<WpMenu, MenuPlacement>()
  const place = (menu: WpMenu, global: string, reason: string) => {
    const language = languageOf(menu)
    const other = taken.get(key(global, language))
    if (other) {
      placements.set(menu, {
        menu,
        ...(language ? { language } : {}),
        reason: `the ${global} ${language ? `in ${language} ` : ''}is "${other.name}" already`,
      })
      return
    }
    taken.set(key(global, language), menu)
    placements.set(menu, { menu, global, ...(language ? { language } : {}), reason })
  }
  const configured = (menu: WpMenu) => config.menus[menu.slug] ?? config.menus[menu.name]
  // The config first, then names, so a configured menu wins its place.
  for (const menu of menus) {
    const setting = configured(menu)
    if (setting === false) {
      placements.set(menu, {
        menu,
        reason: 'set to false in the config',
        excluded: true,
      })
    } else if (typeof setting === 'string') {
      place(menu, setting, 'set in the config')
    }
  }
  const nameOf = (menu: WpMenu) => `${menu.name} ${menu.slug}`
  for (const menu of menus) {
    if (placements.has(menu) || menu.items.length === 0) continue
    if (FOOTER.test(nameOf(menu))) place(menu, 'footer', 'its name')
  }
  for (const menu of menus) {
    if (placements.has(menu) || menu.items.length === 0) continue
    if (HEADER.test(nameOf(menu))) place(menu, 'header', 'its name')
  }
  const rest = menus
    .filter((m) => !placements.has(m) && m.items.length > 0)
    .sort((a, b) => b.items.length - a.items.length)
  for (const menu of rest) {
    if (!taken.has(key('header', languageOf(menu)))) {
      place(menu, 'header', 'the largest menu without a place')
    }
  }
  return menus.map(
    (menu) =>
      placements.get(menu) ?? {
        menu,
        ...(languageOf(menu) ? { language: languageOf(menu) } : {}),
        reason:
          menu.items.length === 0
            ? 'it has no entries'
            : 'its name is not a header or footer menu; name its global under "menus" in the config',
      },
  )
}

/** The label of an entry: its own, or the title of what it links to. */
export const menuItemLabel = (
  item: MenuItem,
  titles: { post: (id: number) => string | undefined; term: (id: number) => string | undefined },
): string => {
  if (item.title) return item.title
  const linked =
    item.type === 'post_type'
      ? titles.post(item.objectId)
      : item.type === 'taxonomy'
        ? titles.term(item.objectId)
        : undefined
  return linked || item.url || item.object
}
