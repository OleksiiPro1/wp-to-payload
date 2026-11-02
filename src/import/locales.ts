import type { Config } from '../config.js'
import type { SiteLanguages } from '../languages.js'

/** How the languages of a WordPress site map to the locales of the Payload project. */
export interface ImportLocales {
  /** Payload has localization configured. */
  localized: boolean
  /**
   * The Payload locale for a WordPress language; `null` to write without a locale (Payload is
   * not localized, and this is the default language); `undefined` when the language is skipped.
   */
  localeOf(language: string): string | null | undefined
  /** Why each skipped language is skipped. */
  skipped: Map<string, string>
}

interface PayloadLocalization {
  locales?: (string | { code?: string })[]
  defaultLocale?: string
}

/** The locale codes of a Payload config, or none when it is not localized. */
export const payloadLocales = (payloadConfig: unknown): string[] => {
  const localization = (payloadConfig as { localization?: PayloadLocalization | false } | undefined)
    ?.localization
  if (!localization || !Array.isArray(localization.locales)) return []
  return localization.locales
    .map((l) => (typeof l === 'string' ? l : (l.code ?? '')))
    .filter(Boolean)
}

/**
 * Maps every language of the site to a Payload locale: the one named in the config's
 * `localization.locales`, else the locale with the same code (`en`), else one that matches the
 * WordPress locale (`en_US` → `en-US`). Without localization in Payload only the default
 * language is imported.
 */
export const importLocales = (
  languages: SiteLanguages,
  config: Config,
  payloadConfig: unknown,
): ImportLocales => {
  const available = payloadLocales(payloadConfig)
  const lower = new Map(available.map((code) => [code.toLowerCase(), code]))
  const mapping = new Map<string, string | null>()
  const skipped = new Map<string, string>()
  for (const language of languages.languages) {
    const { code } = language
    if (available.length === 0) {
      if (code === languages.defaultLanguage) mapping.set(code, null)
      else skipped.set(code, 'the Payload config has no localization')
      continue
    }
    const configured = config.localization.locales[code]
    const candidates = configured
      ? [configured]
      : [code, language.locale?.replace('_', '-') ?? '', language.locale?.split('_')[0] ?? '']
    const found = candidates.map((c) => lower.get(c.toLowerCase())).find(Boolean)
    if (found) mapping.set(code, found)
    else
      skipped.set(
        code,
        configured
          ? `the Payload config has no locale "${configured}"`
          : `the Payload config has no locale for it (map it under localization.locales)`,
      )
  }
  return {
    localized: available.length > 0,
    localeOf: (language) => mapping.get(language),
    skipped,
  }
}
