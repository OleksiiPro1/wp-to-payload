import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { analyzeExport } from '../../../src/analyze/analyze.js'
import {
  contentSource,
  elementorToHtml,
  parseElementorData,
} from '../../../src/content/elementor.js'
import { prepareContent } from '../../../src/content/pipeline.js'
import type { WxrItem } from '../../../src/wxr/model.js'
import { readWxr } from '../../../src/wxr/reader.js'
import { buildSiteIndex, type SiteIndex } from '../../../src/wxr/site-index.js'
import { contentContext } from '../../support/content-context.js'

const exportFile = fileURLToPath(
  new URL('../../fixtures/wxr/wordpress/elementor.xml', import.meta.url),
)

const items = async (file: string): Promise<Map<number, WxrItem>> => {
  const found = new Map<number, WxrItem>()
  for await (const record of readWxr(file)) {
    if (record.kind === 'item') found.set(record.item.id, record.item)
  }
  return found
}

const widget = (widgetType: string, settings: Record<string, unknown>) => ({
  id: 'x',
  elType: 'widget',
  widgetType,
  settings,
  elements: [],
})

describe('Elementor', () => {
  let index: SiteIndex
  let all: Map<number, WxrItem>
  beforeAll(async () => {
    index = await buildSiteIndex(exportFile)
    all = await items(exportFile)
  })
  const item = (id: number) => {
    const found = all.get(id)
    if (!found) throw new Error(`no item ${id}`)
    return found
  }
  const prepared = (id: number) => {
    const source = contentSource(item(id))
    const ctx = contentContext(index, { builders: source.builders, postId: id })
    return { source, ...prepareContent(source.content, ctx), warnings: ctx.warnings.warnings }
  }

  it('converts the widgets of a page in reading order', () => {
    const { source, html, blocks, warnings } = prepared(9)
    expect(source.warnings.map((w) => [w.code, w.subject])).toEqual([
      ['BUILDER_MARKUP', 'elementor'],
      ['BUILDER_WIDGET_UNKNOWN', 'counter'],
      ['BUILDER_WIDGET_UNKNOWN', 'google_maps'],
    ])
    expect(source.builders).toEqual([])
    expect(html.split('\n').filter(Boolean)).toEqual([
      '<h1>Gärten für Wien</h1>',
      '<p>Wir planen und pflegen Gärten.</p>',
      '<p>Seit 1999 in <strong>Wien</strong>.</p>',
      '<p><a href="/kontakt">Angebot anfragen</a></p>',
      '<img data-lexical-upload-relation-to="media" data-lexical-upload-id="m3"><p>Ein Garten im Sommer</p>',
      '<ul><li><a href="/kontakt">Planung</a></li><li>Pflege</li></ul>',
      '<img data-lexical-upload-relation-to="media" data-lexical-upload-id="m4">',
      '<h3><a href="/kontakt">Teichbau</a></h3>',
      '<p>Naturteiche mit heimischen Pflanzen.</p>',
      '<h4>Heckenschnitt</h4>',
      '<p>Zweimal im Jahr.</p>',
      '<img data-lexical-upload-relation-to="media" data-lexical-upload-id="m3"><img data-lexical-upload-relation-to="media" data-lexical-upload-id="m5">',
      '<p>WP2PBLOCK0X</p>',
      '<img data-lexical-upload-relation-to="media" data-lexical-upload-id="m6">',
      '<blockquote>Unser Garten blüht wie nie.<br>— Maria Beispiel, Kundin</blockquote>',
      '<h3>Was kostet eine Planung?</h3>',
      '<p>Ab 300 Euro.</p>',
      '<h3>Wie lange dauert es?</h3>',
      '<p>Zwei Wochen.</p>',
      '<h3>Pflegen Sie auch im Winter?</h3>',
      '<p>Ja, den Winterschnitt.</p>',
      '<h3>Frühling</h3>',
      '<p>Pflanzen.</p>',
      '<h3>Herbst</h3>',
      '<p>Laub rechen.</p>',
      '<hr>',
      '<p>Öffnungszeiten: <strong>Mo–Fr</strong></p>',
      '<p><strong>Hinweis</strong></p>',
      '<p>Im Jänner haben wir geschlossen.</p>',
      '<h3><a href="/kontakt">Besuchen Sie uns</a></h3>',
    ])
    expect(blocks).toEqual([
      {
        token: 'WP2PBLOCK0X',
        blockType: 'embed',
        fields: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', provider: 'youtube' },
      },
    ])
    expect(warnings.map((w) => `${w.code} ${w.subject}`)).toEqual([
      'SHORTCODE_REMOVED [contact-form-7]',
      'ELEMENT_REMOVED script',
    ])
  })

  it('converts posts, and a linked image without its link', () => {
    const { html, source } = prepared(11)
    expect(source.warnings.map((w) => w.code)).toEqual(['BUILDER_MARKUP'])
    expect(html).toBe(
      '<p>Jetzt ist die Zeit für den Rückschnitt.</p>\n<img data-lexical-upload-relation-to="media" data-lexical-upload-id="m5">',
    )
  })

  it('falls back to the stored HTML when the data is broken', () => {
    const { html, source, warnings } = prepared(13)
    expect(source.warnings.map((w) => w.code)).toEqual(['BUILDER_DATA_INVALID'])
    expect(html).toBe('<h2>Über uns</h2>\n<p>Eine kleine Gärtnerei.</p>')
    expect(warnings.map((w) => w.code)).toEqual(['BUILDER_MARKUP'])
  })

  it("converts the elements of Elementor 4's editor", () => {
    const { html, blocks, source } = prepared(15)
    expect(source.warnings.map((w) => w.code)).toEqual(['BUILDER_MARKUP'])
    expect(html.split('\n').filter(Boolean)).toEqual([
      '<h2>Unsere <strong>Leistungen</strong></h2>',
      '<p>Planung, Pflege und Teichbau aus einer Hand.</p>',
      // An internal link by page ID gets the page's new URL.
      '<p><a href="/kontakt">Zum Kontakt</a></p>',
      '<img data-lexical-upload-relation-to="media" data-lexical-upload-id="m4">',
      '<hr>',
      '<p>WP2PBLOCK0X</p>',
      '<p><a href="https://example.org/gartenblog">Mehr auf unserem Blog.</a></p>',
    ])
    expect(blocks.map((b) => [b.blockType, b.fields.url])).toEqual([
      ['embed', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
    ])
  })

  it('leaves content without Elementor alone', () => {
    for (const id of [7, 8]) {
      const source = contentSource(item(id))
      expect(source).toEqual({ content: item(id).content, builders: [], warnings: [] })
    }
  })

  it('converts the widgets of Elementor Pro', () => {
    const result = elementorToHtml([
      {
        elType: 'container',
        elements: [
          widget('call-to-action', {
            bg_image: {
              id: 3,
              url: 'https://elementor.example.com/wp-content/uploads/2024/01/garten.png',
            },
            title: 'Jetzt planen',
            description: 'Wir kommen vorbei.',
            button: 'Termin',
            link: { url: '/kontakt/' },
          }),
          widget('slides', {
            slides: [
              {
                heading: 'Teiche',
                description: 'Mit Fischen.',
                button_text: 'Mehr',
                link: { url: '/teiche/' },
              },
              { heading: 'Hecken', description: '' },
            ],
          }),
          widget('blockquote', {
            blockquote_content: 'Gärten brauchen Zeit.',
            author_name: 'Anna',
          }),
          widget('animated-headline', {
            headline_style: 'rotate',
            before_text: 'Wir bauen',
            rotating_text: 'Teiche\nWege\nZäune',
            tag: 'h2',
          }),
          widget('flip-box', {
            title_text_a: 'Vorne',
            description_text_a: 'Text vorne',
            title_text_b: 'Hinten',
            description_text_b: 'Text hinten',
            button_text: 'Los',
            link: { url: '/los/' },
          }),
          widget('global', { templateID: 12 }),
          widget('price-table', {}),
        ],
      },
    ])
    expect(result.html.split('\n\n').filter(Boolean)).toEqual([
      '<figure><img src="https://elementor.example.com/wp-content/uploads/2024/01/garten.png" alt="" class="wp-image-3"></figure>',
      '<h2>Jetzt planen</h2>',
      '<p>Wir kommen vorbei.</p>',
      '<p><a href="/kontakt/">Termin</a></p>',
      '<h2>Teiche</h2>',
      '<p>Mit Fischen.</p>',
      '<p><a href="/teiche/">Mehr</a></p>',
      '<h2>Hecken</h2>',
      '<blockquote><p>Gärten brauchen Zeit.</p><cite>Anna</cite></blockquote>',
      '<h2>Wir bauen Teiche / Wege / Zäune</h2>',
      '<h3>Vorne</h3>',
      '<p>Text vorne</p>',
      '<h3>Hinten</h3>',
      '<p>Text hinten</p>',
      '<p><a href="/los/">Los</a></p>',
    ])
    expect(result.unknown).toEqual(['global', 'price-table'])
    expect(result.warnings.map((w) => w.message)).toEqual([
      'An Elementor global widget was left out: its content is stored in the template it refers to.',
      'Elementor widget "price-table" has no converter; it was left out.',
    ])
  })

  it("converts Elementor 4's tabs, videos and links, and leaves out forms", () => {
    const typed = (type: string, value: unknown) => ({ $$type: type, value })
    const html = (content: string) => typed('html-v3', { content: typed('string', content) })
    const element = (elType: string, elements: unknown[], settings = {}) => ({
      id: 'x',
      elType,
      settings,
      elements,
    })
    const paragraph = (content: string) => widget('e-paragraph', { paragraph: html(content) })
    const result = elementorToHtml([
      element('e-flexbox', [
        widget('e-heading', {
          title: html('Kontakt'),
          tag: typed('string', 'div'),
          link: typed('link', { destination: typed('url', 'https://example.org/kontakt') }),
        }),
        element('e-tabs', [
          element('e-tabs-menu', [
            element('e-tab', [paragraph('Frühling')]),
            element('e-tab', [paragraph('Herbst')]),
          ]),
          element('e-tabs-content-area', [
            element('e-tab-content', [paragraph('Pflanzen.')]),
            element('e-tab-content', [paragraph('Laub rechen.')]),
          ]),
        ]),
        widget('e-image', {
          image: typed('image', {
            src: typed('image-src', { id: null, url: typed('url', 'https://example.org/a.png') }),
          }),
        }),
        widget('e-self-hosted-video', {
          source: typed('video-src', { id: null, url: typed('url', 'https://example.org/a.mp4') }),
        }),
        // A video of the media library is named by ID; the [video] handler finds its file.
        widget('e-self-hosted-video', {
          source: typed('video-src', { id: typed('video-attachment-id', 21), url: null }),
        }),
        widget('e-svg', { svg: typed('svg-src', { id: null, url: typed('url', '/a.svg') }) }),
        element('e-form', [element('e-form-success-message', [paragraph('Danke!')])]),
      ]),
    ])
    expect(result.html.split('\n\n').filter(Boolean)).toEqual([
      '<p><a href="https://example.org/kontakt">Kontakt</a></p>',
      '<h3>Frühling</h3>',
      '<p>Pflanzen.</p>',
      '<h3>Herbst</h3>',
      '<p>Laub rechen.</p>',
      '<figure><img src="https://example.org/a.png" alt=""></figure>',
      '[video src="https://example.org/a.mp4"]',
      '[video id="21"]',
    ])
    expect(result.unknown).toEqual(['e-form'])
  })

  it('reads only valid data', () => {
    expect(parseElementorData('[{"elType":"section"}]')).toEqual([{ elType: 'section' }])
    expect(parseElementorData('{"elType":"section"}')).toBeUndefined()
    expect(parseElementorData('[{"broken"')).toBeUndefined()
  })

  it('uses the stored content when the page left the Elementor editor', () => {
    const page = item(9)
    const meta = new Map(page.meta)
    meta.delete('_elementor_edit_mode')
    expect(contentSource({ content: page.content, meta }).content).toBe(page.content)
  })

  it('reports the widgets in analyze, with the ones that have no converter', async () => {
    const r = await analyzeExport(exportFile)
    expect(r.builders.elementor).toMatchObject({
      detected: true,
      items: 4,
      details: {
        converted: 3,
        invalidData: 1,
        withoutConverter: ['counter', 'google_maps'],
      },
    })
    expect(r.builders.elementor.details?.widgets).toMatchObject({
      heading: 2,
      'text-editor': 2,
      image: 2,
      counter: 1,
      'e-heading': 1,
      'e-paragraph': 2,
    })
    expect(r.complexity.reasons.map((x) => [x.points, x.reason])).toEqual([
      [3, 'Elementor on 4 items (widgets are converted, the layout is not)'],
      [1, 'Elementor widgets without a converter: counter, google_maps'],
      [2, 'broken Elementor data on 1 items (their stored HTML is used)'],
      [1, 'plugin shortcodes: contact-form-7'],
    ])
    expect(r.complexity.level).toBe('complex')
  })
})
