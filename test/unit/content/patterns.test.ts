import { beforeAll, describe, expect, it } from 'vitest'
import { prepareContent } from '../../../src/content/pipeline.js'
import { buildSiteIndex, type SiteIndex } from '../../../src/wxr/site-index.js'
import { fromString, wxr } from '../../helpers.js'
import { contentContext } from '../../support/content-context.js'

const paragraph = (text: string, name?: string) =>
  `<!-- wp:paragraph ${name ? `{"metadata":{"name":"${name}","bindings":{"__default":{"source":"core/pattern-overrides"}}}} ` : ''}-->\n<p>${text}</p>\n<!-- /wp:paragraph -->`

const patterns = new Map<number, string>([
  [1, paragraph('Montag bis Freitag, 8 bis 18 Uhr.')],
  [2, `${paragraph('Öffnungszeiten:')}\n\n<!-- wp:block {"ref":1} /-->`],
  [3, `${paragraph('Schleife')}\n\n<!-- wp:block {"ref":3} /-->`],
  [
    4,
    [
      '<!-- wp:heading {"metadata":{"name":"Titel","bindings":{"__default":{"source":"core/pattern-overrides"}}}} -->\n<h2 class="wp-block-heading">Angebot</h2>\n<!-- /wp:heading -->',
      paragraph('Brot zum halben Preis.', 'Text'),
      '<!-- wp:image {"metadata":{"name":"Bild","bindings":{"__default":{"source":"core/pattern-overrides"}}}} -->\n<figure class="wp-block-image"><img src="https://site.example.com/brot.png" alt=""/></figure>\n<!-- /wp:image -->',
    ].join('\n\n'),
  ],
  [5, 'Klassischer Text.\n\nZweiter Absatz.'],
])

describe('synced patterns', () => {
  let index: SiteIndex
  beforeAll(async () => {
    index = await buildSiteIndex(fromString(wxr('')))
  })
  const render = (content: string) => {
    const ctx = contentContext(index, { pattern: (id) => patterns.get(id) })
    // Blank lines between blocks do not matter to the editor.
    const html = prepareContent(content, ctx).html.replace(/\n{2,}/g, '\n')
    return { html, warnings: ctx.warnings.warnings.map((w) => `${w.code}: ${w.message}`) }
  }

  it('puts the pattern where it is used, also inside other patterns', () => {
    expect(render('<!-- wp:block {"ref":1} /-->')).toEqual({
      html: '<p>Montag bis Freitag, 8 bis 18 Uhr.</p>',
      warnings: [],
    })
    expect(render('<!-- wp:block {"ref":2} /-->').html).toBe(
      '<p>Öffnungszeiten:</p>\n<p>Montag bis Freitag, 8 bis 18 Uhr.</p>',
    )
    expect(render('<!-- wp:block {"ref":5} /-->').html).toBe(
      '<p>Klassischer Text.</p>\n<p>Zweiter Absatz.</p>',
    )
  })

  it('stops at a pattern that contains itself, and reports missing ones', () => {
    expect(render('<!-- wp:block {"ref":3} /-->')).toEqual({
      html: '<p>Schleife</p>',
      warnings: [
        'BLOCK_REMOVED: Synced pattern 3 contains itself; the repeated part was left out.',
      ],
    })
    expect(render('<!-- wp:block {"ref":99} /-->')).toEqual({
      html: '',
      warnings: [
        'BLOCK_REMOVED: Synced pattern (reusable block) 99 removed: it is not in the export.',
      ],
    })
  })

  it('applies overrides of headings and paragraphs, and reports the others', () => {
    const { html, warnings } = render(
      '<!-- wp:block {"ref":4,"content":{"Titel":{"content":"Sonntagsangebot"},"Text":{"content":"Croissants <strong>gratis</strong>."},"Bild":{"url":"https://site.example.com/croissant.png"}}} /-->',
    )
    expect(html.split('\n').slice(0, 2)).toEqual([
      '<h2 class="wp-block-heading">Sonntagsangebot</h2>',
      '<p>Croissants <strong>gratis</strong>.</p>',
    ])
    // The image is not in this test's export, so it is reported as well.
    expect(warnings.filter((w) => w.startsWith('BLOCK_'))).toEqual([
      "BLOCK_PARTIAL: Synced pattern 4: overrides of core/image url were not applied; the pattern's own values were kept.",
    ])
    // Without overrides, the pattern's own texts.
    expect(render('<!-- wp:block {"ref":4} /-->').html).toContain('<p>Brot zum halben Preis.</p>')
  })
})
