import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { analyzeExport } from '../../src/analyze/analyze.js'
import { DEFAULT_CONFIG, parseConfig } from '../../src/config.js'
import { indexLanguages, type SiteLanguages, translationsOf } from '../../src/languages.js'
import { buildRedirects } from '../../src/redirects/build.js'
import { describeSite } from '../../src/site.js'
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

describe('URLs of a multilingual site', () => {
  let index: SiteIndex
  beforeAll(async () => {
    index = await buildSiteIndex(multilingual)
  })
  const urlsFor = (raw: unknown) => describeSite(index, parseConfig(raw)).urls

  it('puts the language directory in front of new paths, except for the default language', () => {
    const urls = urlsFor({ paths: { page: '/:path' } })
    expect(urls.newPath(3)).toBe('/ueber-uns')
    expect(urls.newPath(4)).toBe('/en/about-us')
    expect(urls.newPath(6)).toBe('/en/about-us/our-team')
    expect(urls.rewriteHref('https://multilingual.example.com/en/about-us/')).toBe('/en/about-us')
    const prefixed = urlsFor({
      paths: { page: '/:locale/seiten/:slug' },
      localization: { prefixDefaultLanguage: true, locales: { en: 'en-gb' } },
    })
    expect(prefixed.newPath(3)).toBe('/de/seiten/ueber-uns')
    expect(prefixed.newPath(4)).toBe('/en-gb/seiten/about-us')
  })

  it('redirects every language version, earlier slugs and term archives', () => {
    const urls = urlsFor({
      paths: { post: '/blog/:slug', page: '/:path', category: '/blog/category/:path' },
    })
    const { redirects, warnings } = buildRedirects(index, urls)
    expect(warnings).toEqual([])
    const map = Object.fromEntries(redirects.map((r) => [r.from, r.to]))
    expect(map).toMatchObject({
      '/2024/02/01/neue-werkbank/': '/blog/neue-werkbank',
      '/en/2024/02/01/new-workbench/': '/en/blog/new-workbench',
      '/en/2024/02/01/new-bench/': '/en/blog/new-workbench',
      '/category/produkte/moebel/': '/blog/category/produkte/moebel',
      '/en/category/products/furniture/': '/en/blog/category/products/furniture',
    })
    // Attachment pages get no redirect, as before.
    expect(map['/en/werkstatt-2/']).toBeUndefined()
    expect(map['/ueber-uns/']).toBeUndefined()
    expect(map['/en/about-us/our-team/']).toBeUndefined()
  })
})

describe('analyze', () => {
  it('reports languages, items per language and translation groups', async () => {
    const r = await analyzeExport(multilingual)
    expect(r.languages).toEqual({
      source: 'polylang',
      defaultLanguage: 'de',
      defaultFrom: 'urls',
      languages: [
        { code: 'de', name: 'Deutsch', locale: 'de_DE', items: 7 },
        { code: 'en', name: 'English', locale: 'en_US', items: 6 },
      ],
      groups: { complete: 5, incomplete: 0 },
      untranslated: 3,
    })
    expect(r.complexity.reasons.map((x) => x.reason)).toContain(
      '2 languages (Polylang): each translation group becomes one document with locales',
    )
    expect(r.complexity.level).toBe('simple')
  })
})

describe('the WP-CLI export of the same site', () => {
  it('has the same languages and translations', async () => {
    const cli = fileURLToPath(
      new URL('../fixtures/wxr/wordpress/multilingual.wp-cli.xml', import.meta.url),
    )
    const summary = async (file: string) => {
      const languages = indexLanguages(await buildSiteIndex(file), DEFAULT_CONFIG) as SiteLanguages
      return {
        languages: languages.languages,
        defaultLanguage: languages.defaultLanguage,
        items: [...languages.itemLanguage].sort((a, b) => a[0] - b[0]),
        groups: [...languages.itemTranslations]
          .map(([id, group]) => `${id}:${[...group].sort().join(',')}`)
          .sort(),
      }
    }
    expect(await summary(cli)).toEqual(await summary(multilingual))
  })
})
