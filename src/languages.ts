import type { Config } from './config.js'
import { maybeUnserializePhp, phpEntries } from './util/php-serialize.js'
import type { WxrItemTerm, WxrTerm } from './wxr/model.js'
import type { SiteIndex } from './wxr/site-index.js'

/**
 * Languages of a multilingual site: the language of each item and term, and which ones are
 * translations of each other. Polylang keeps all of this in taxonomies that every export
 * contains. WPML keeps it in its own tables; only its WPML Export and Import add-on writes it
 * into the export, as documented post meta. Without either, the first directory of a URL
 * (`/en/…`) gives the language and translations stay unlinked.
 */

export type LanguageSource = 'polylang' | 'wpml' | 'url'

export interface SiteLanguage {
  /** Code as WordPress uses it: Polylang's language slug, WPML's code or the URL directory. */
  code: string
  /** WordPress locale (`de_DE`), when the export has it. */
  locale?: string
  name?: string
}

export interface SiteLanguages {
  source: LanguageSource
  languages: SiteLanguage[]
  defaultLanguage: string
  /** Where the default language came from. */
  defaultFrom: 'config' | 'urls' | 'site' | 'first'
  /** Language of items (posts, pages, custom types, attachments) by ID. */
  itemLanguage: Map<number, string>
  /** For items that have translations: all of them by language, the item itself included. */
  itemTranslations: Map<number, ReadonlyMap<string, number>>
  /** Language of terms by term ID. */
  termLanguage: Map<number, string>
  /** For terms that have translations: all of them by language, by term ID. */
  termTranslations: Map<number, ReadonlyMap<string, number>>
  /** The directory each language had in the old URLs: `/en`, or empty for none. */
  oldPrefixes: Map<string, string>
}

/** What an item contributes; `IndexedPost` fits. */
export interface LanguageItem {
  id: number
  type: string
  status: string
  link: string
  terms: WxrItemTerm[]
  /** Values of WPML Export and Import's post meta, when present. */
  wpml?: WpmlKeys
}

/** The documented post meta (and term meta) of WPML Export and Import. */
export interface WpmlKeys {
  language?: string
  sourceLanguage?: string
  translationGroup?: string
}

export const WPML_KEYS = {
  language: '_wpml_import_language_code',
  sourceLanguage: '_wpml_import_source_language_code',
  translationGroup: '_wpml_import_translation_group',
} as const

/** The WPML Export and Import values of an item's or term's meta, if it has them. */
export const wpmlKeysOf = (meta: Map<string, string[]>): WpmlKeys | undefined => {
  const value = (key: string) => meta.get(key)?.[0]?.trim() || undefined
  const language = value(WPML_KEYS.language)
  const translationGroup = value(WPML_KEYS.translationGroup)
  const sourceLanguage = value(WPML_KEYS.sourceLanguage)
  if (!language && !translationGroup) return undefined
  return {
    ...(language ? { language } : {}),
    ...(sourceLanguage ? { sourceLanguage } : {}),
    ...(translationGroup ? { translationGroup } : {}),
  }
}

/** Polylang's translation groups and languages store a serialized PHP array in the description. */
const serializedMap = (text: string | undefined): Map<string, unknown> => {
  const map = new Map<string, unknown>()
  if (!text) return map
  for (const [key, value] of phpEntries(maybeUnserializePhp(text))) map.set(String(key), value)
  return map
}

const LANGUAGE_CODE = /^[a-z]{2,3}(?:-[a-z]{2,4})?$/

/** Collects what an export says about its languages, record by record. */
export class LanguageCollector {
  private readonly terms: WxrTerm[] = []
  private readonly items: LanguageItem[] = []
  private wpmlDetected = false

  addTerm(term: WxrTerm): void {
    this.terms.push(term)
    if (term.taxonomy === 'translation_priority') this.wpmlDetected = true
  }

  /** Adds a content item or attachment. `wpmlTraces` marks WPML's own meta (`_icl_…`). */
  addItem(item: LanguageItem, wpmlTraces = false): void {
    if (item.type === 'nav_menu_item' || item.type === 'revision') return
    this.items.push(item)
    if (wpmlTraces || item.wpml) this.wpmlDetected = true
  }

  /** The site's languages, or undefined for a site in one language. */
  result(config: Config, siteLanguage = ''): SiteLanguages | undefined {
    const configured = Object.keys(config.localization.locales)
    const polylang = this.terms.filter((t) => t.taxonomy === 'language')
    const wpmlItems = this.items.filter((i) => i.wpml?.language)
    let source: LanguageSource
    const languages: SiteLanguage[] = []
    const itemLanguage = new Map<number, string>()
    const itemTranslations = new Map<number, ReadonlyMap<string, number>>()
    const termLanguage = new Map<number, string>()
    const termTranslations = new Map<number, ReadonlyMap<string, number>>()
    const itemIds = new Set(this.items.map((i) => i.id))
    const termIds = new Set(this.terms.flatMap((t) => (t.id === undefined ? [] : [t.id])))

    if (polylang.length > 0) {
      source = 'polylang'
      for (const term of polylang) {
        const meta = serializedMap(term.description)
        const locale = meta.get('locale')
        languages.push({
          code: term.slug,
          name: term.name,
          ...(typeof locale === 'string' && locale ? { locale } : {}),
        })
      }
      for (const item of this.items) {
        const language = item.terms.find((t) => t.taxonomy === 'language')?.slug
        if (language) itemLanguage.set(item.id, language)
      }
      for (const term of this.terms) {
        if (term.taxonomy !== 'post_translations' && term.taxonomy !== 'term_translations') {
          continue
        }
        const known = term.taxonomy === 'post_translations' ? itemIds : termIds
        const group = new Map<string, number>()
        for (const [language, id] of serializedMap(term.description)) {
          const n = Number(id)
          if (Number.isInteger(n) && known.has(n)) group.set(language, n)
        }
        const target = term.taxonomy === 'post_translations' ? itemTranslations : termTranslations
        for (const [language, id] of group) {
          target.set(id, group)
          if (term.taxonomy === 'term_translations') termLanguage.set(id, language)
        }
      }
    } else if (wpmlItems.length > 0) {
      source = 'wpml'
      const groups = new Map<string, Map<string, number>>()
      const add = (code: string) => {
        if (!languages.some((l) => l.code === code)) languages.push({ code })
      }
      for (const item of wpmlItems) {
        const { language, translationGroup } = item.wpml as WpmlKeys
        if (!language) continue
        add(language)
        itemLanguage.set(item.id, language)
        if (!translationGroup) continue
        const group = groups.get(translationGroup) ?? new Map<string, number>()
        groups.set(translationGroup, group)
        group.set(language, item.id)
      }
      for (const group of groups.values()) {
        for (const id of group.values()) itemTranslations.set(id, group)
      }
      const termGroups = new Map<string, Map<string, number>>()
      for (const term of this.terms) {
        const keys = wpmlKeysOf(term.meta)
        if (!keys?.language || term.id === undefined) continue
        add(keys.language)
        termLanguage.set(term.id, keys.language)
        if (!keys.translationGroup) continue
        const group = termGroups.get(keys.translationGroup) ?? new Map<string, number>()
        termGroups.set(keys.translationGroup, group)
        group.set(keys.language, term.id)
      }
      for (const group of termGroups.values()) {
        for (const id of group.values()) termTranslations.set(id, group)
      }
    } else if (this.wpmlDetected || configured.length > 0) {
      source = 'url'
      const codes = new Set(configured)
      if (codes.size === 0) {
        // Without a list of languages, directories that look like language codes count.
        for (const item of this.items) {
          const first = firstDirectory(item.link)
          if (first && LANGUAGE_CODE.test(first)) codes.add(first)
        }
      }
      for (const code of codes) languages.push({ code })
      for (const item of this.items) {
        const first = firstDirectory(item.link)
        if (first && codes.has(first)) itemLanguage.set(item.id, first)
      }
    } else {
      return undefined
    }

    const oldPrefixes = new Map<string, string>()
    const prefixed = new Map<string, number>()
    const counted = new Map<string, number>()
    for (const item of this.items) {
      if (item.status !== 'publish') continue
      const language = itemLanguage.get(item.id)
      if (!language) continue
      counted.set(language, (counted.get(language) ?? 0) + 1)
      if (firstDirectory(item.link) === language) {
        prefixed.set(language, (prefixed.get(language) ?? 0) + 1)
      }
    }
    for (const { code } of languages) {
      oldPrefixes.set(code, (prefixed.get(code) ?? 0) > 0 ? `/${code}` : '')
    }

    // The default language: configured, or the one whose URLs have no directory, or the site's.
    let defaultLanguage: string | undefined
    let defaultFrom: SiteLanguages['defaultFrom'] = 'first'
    const unprefixed = languages.filter(
      (l) => (counted.get(l.code) ?? 0) > 0 && (prefixed.get(l.code) ?? 0) === 0,
    )
    const siteCode = siteLanguage.toLowerCase().split(/[-_]/)[0] ?? ''
    if (config.localization.defaultLanguage) {
      defaultLanguage = config.localization.defaultLanguage
      defaultFrom = 'config'
    } else if (source === 'url') {
      // Items without a directory are in the site's language; "und" (undetermined) when the
      // export does not name it, so the config has to.
      defaultLanguage = siteCode || 'und'
      defaultFrom = 'site'
    } else if (unprefixed.length === 1 && unprefixed[0]) {
      defaultLanguage = unprefixed[0].code
      defaultFrom = 'urls'
    } else if (languages.some((l) => l.code === siteCode)) {
      defaultLanguage = siteCode
      defaultFrom = 'site'
    } else {
      defaultLanguage = languages[0]?.code ?? siteCode
    }
    if (defaultLanguage && !languages.some((l) => l.code === defaultLanguage)) {
      languages.unshift({ code: defaultLanguage })
    }
    if (source === 'url') {
      // Items without a language directory are in the default language.
      for (const item of this.items) {
        if (!itemLanguage.has(item.id)) itemLanguage.set(item.id, defaultLanguage)
      }
    }
    if (languages.length < 2 && source === 'url') return undefined
    return {
      source,
      languages,
      defaultLanguage,
      defaultFrom,
      itemLanguage,
      itemTranslations,
      termLanguage,
      termTranslations,
      oldPrefixes,
    }
  }
}

const firstDirectory = (link: string): string | undefined => {
  try {
    return new URL(link).pathname.split('/').filter(Boolean)[0]?.toLowerCase()
  } catch {
    return undefined
  }
}

/** The languages of an indexed export, or undefined for a site in one language. */
export const indexLanguages = (index: SiteIndex, config: Config): SiteLanguages | undefined => {
  const collector = new LanguageCollector()
  for (const term of index.terms) collector.addTerm(term)
  for (const attachment of index.attachments.values()) {
    collector.addItem({
      id: attachment.id,
      type: 'attachment',
      status: 'inherit',
      link: attachment.link,
      terms: attachment.terms,
    })
  }
  for (const post of index.posts.values()) collector.addItem(post, post.wpmlTraces === true)
  return collector.result(config, index.site.language)
}

/** Translations of an item, by language; a lone item is its own group. */
export const translationsOf = (languages: SiteLanguages, id: number): ReadonlyMap<string, number> =>
  languages.itemTranslations.get(id) ??
  new Map([[languages.itemLanguage.get(id) ?? languages.defaultLanguage, id]])

/** Translations of a term, by language. */
export const termTranslationsOf = (
  languages: SiteLanguages,
  id: number,
): ReadonlyMap<string, number> =>
  languages.termTranslations.get(id) ??
  new Map([[languages.termLanguage.get(id) ?? languages.defaultLanguage, id]])

/** The URL directory of a language on the new site: none for the default language. */
export const newPrefixOf = (languages: SiteLanguages, config: Config, code: string): string => {
  if (code === languages.defaultLanguage && !config.localization.prefixDefaultLanguage) return ''
  return config.localization.locales[code] ?? code
}
