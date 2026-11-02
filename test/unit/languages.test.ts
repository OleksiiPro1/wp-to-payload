import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, parseConfig } from '../../src/config.js'
import { indexLanguages, type SiteLanguages, translationsOf } from '../../src/languages.js'
import { buildSiteIndex, type SiteIndex } from '../../src/wxr/site-index.js'
import { fromString, wxr } from '../helpers.js'

const multilingual = fileURLToPath(
  new URL('../fixtures/wxr/wordpress/multilingual.xml', import.meta.url),
)

const group = (languages: SiteLanguages, id: number) =>
  Object.fromEntries(translationsOf(languages, id))

describe('Polylang', () => {
  let index: SiteIndex
  let languages: SiteLanguages
  beforeAll(async () => {
    index = await buildSiteIndex(multilingual)
    languages = indexLanguages(index, DEFAULT_CONFIG) as SiteLanguages
  })

  it('reads the languages and finds the default one from the URLs', () => {
    expect(languages.source).toBe('polylang')
    expect(languages.languages).toEqual([
      { code: 'de', name: 'Deutsch', locale: 'de_DE' },
      { code: 'en', name: 'English', locale: 'en_US' },
    ])
    expect(languages.defaultLanguage).toBe('de')
    expect(languages.defaultFrom).toBe('urls')
    expect(Object.fromEntries(languages.oldPrefixes)).toEqual({ de: '', en: '/en' })
  })

  it('links translations of posts, pages, images and terms', () => {
    expect(group(languages, 3)).toEqual({ de: 3, en: 4 })
    expect(group(languages, 11)).toEqual({ de: 10, en: 11 })
    // The German draft and its published English translation.
    expect(group(languages, 16)).toEqual({ de: 15, en: 16 })
    expect(group(languages, 2)).toEqual({ en: 2, de: 1 })
    // Items in one language only.
    expect(group(languages, 9)).toEqual({ de: 9 })
    expect(group(languages, 14)).toEqual({ en: 14 })
    const produkte = index.terms.find((t) => t.slug === 'produkte')?.id as number
    expect(Object.fromEntries(languages.termTranslations.get(produkte) ?? [])).toEqual({
      de: produkte,
      en: index.terms.find((t) => t.slug === 'products')?.id,
    })
    const handwerk = index.terms.find((t) => t.slug === 'handwerk')?.id as number
    expect(languages.termLanguage.get(handwerk)).toBe('de')
  })

  it('takes the default language from the config', () => {
    const config = parseConfig({ localization: { defaultLanguage: 'en' } })
    expect(indexLanguages(index, config)).toMatchObject({
      defaultLanguage: 'en',
      defaultFrom: 'config',
    })
  })
})

const item = (id: number, link: string, meta: Record<string, string> = {}) =>
  `<item><title>T${id}</title><link>https://site.example.com${link}</link><wp:post_id>${id}</wp:post_id><wp:post_name>p${id}</wp:post_name><wp:status>publish</wp:status><wp:post_type>post</wp:post_type>${Object.entries(
    meta,
  )
    .map(
      ([k, v]) =>
        `<wp:postmeta><wp:meta_key>${k}</wp:meta_key><wp:meta_value>${v}</wp:meta_value></wp:postmeta>`,
    )
    .join('')}</item>`

describe('WPML', () => {
  it('links translations with the keys of WPML Export and Import', async () => {
    const index = await buildSiteIndex(
      fromString(
        wxr(
          [
            item(1, '/ueber-uns/', {
              _wpml_import_language_code: 'de',
              _wpml_import_translation_group: 'g1',
            }),
            item(2, '/en/about-us/', {
              _wpml_import_language_code: 'en',
              _wpml_import_source_language_code: 'de',
              _wpml_import_translation_group: 'g1',
            }),
            item(3, '/en/only-english/', {
              _wpml_import_language_code: 'en',
              _wpml_import_translation_group: 'g2',
            }),
          ].join('\n'),
        ),
      ),
    )
    const languages = indexLanguages(index, DEFAULT_CONFIG) as SiteLanguages
    expect(languages.source).toBe('wpml')
    expect(languages.languages.map((l) => l.code)).toEqual(['de', 'en'])
    expect(languages.defaultLanguage).toBe('de')
    expect(group(languages, 2)).toEqual({ de: 1, en: 2 })
    expect(group(languages, 3)).toEqual({ en: 3 })
  })

  it('falls back to the language directory of the URL, without translations', async () => {
    const index = await buildSiteIndex(
      fromString(
        wxr(
          [
            item(1, '/ueber-uns/', { _icl_lang_duplicate_of: '' }),
            item(2, '/en/about-us/'),
            item(3, '/fr/a-propos/'),
          ].join('\n'),
          '<language>de-AT</language>',
        ),
      ),
    )
    const languages = indexLanguages(index, DEFAULT_CONFIG) as SiteLanguages
    expect(languages.source).toBe('url')
    // Items without a language directory are in the site's language.
    expect(languages.defaultLanguage).toBe('de')
    expect(languages.languages.map((l) => l.code)).toEqual(['de', 'en', 'fr'])
    expect(languages.itemLanguage.get(1)).toBe('de')
    expect(languages.itemLanguage.get(3)).toBe('fr')
    expect(languages.itemTranslations.size).toBe(0)
  })

  it('is not multilingual without any of this', async () => {
    const index = await buildSiteIndex(fromString(wxr(item(1, '/a/'))))
    expect(indexLanguages(index, DEFAULT_CONFIG)).toBeUndefined()
  })
})
