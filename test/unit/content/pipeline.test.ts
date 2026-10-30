import { beforeAll, describe, expect, it } from 'vitest'
import { mediaKey } from '../../../src/content/media-match.js'
import { prepareContent } from '../../../src/content/pipeline.js'
import type { WxrItem } from '../../../src/wxr/model.js'
import { buildSiteIndex, type SiteIndex } from '../../../src/wxr/site-index.js'
import { collect, fixture } from '../../helpers.js'
import { contentContext } from '../../support/content-context.js'

/** Whitespace between top-level elements does not matter to the converter. */
const compact = (html: string) => html.replace(/>\s+</g, '><')

let index: SiteIndex
let items: Map<number, WxrItem>
beforeAll(async () => {
  index = await buildSiteIndex(fixture('blog-gutenberg.xml'))
  const { records } = await collect(fixture('blog-gutenberg.xml'))
  items = new Map(records.flatMap((r) => (r.kind === 'item' ? [[r.item.id, r.item]] : [])))
})

const block = (html: string, caps = {}) => {
  const ctx = contentContext(index, { postId: 10, capabilities: caps })
  const result = prepareContent(html, ctx)
  return { ...result, html: compact(result.html), warnings: ctx.warnings.warnings }
}

describe('mediaKey', () => {
  it('ignores host, scheme and generated size suffixes', () => {
    const key = mediaKey('https://blog.example.com/wp-content/uploads/2024/01/loaf.png')
    expect(mediaKey('http://cdn.example.net/wp-content/uploads/2024/01/loaf-300x200.png')).toBe(key)
    expect(mediaKey('/wp-content/uploads/2024/01/loaf-scaled.png')).toBe(key)
    expect(mediaKey('/wp-content/uploads/2024/01/loaf-e1700000000000.PNG')).toBe(key)
    expect(mediaKey('/wp-content/uploads/2024/01/other.png')).not.toBe(key)
  })
})

describe('prepareContent: core blocks', () => {
  it('paragraph with formatting and internal links', () => {
    const { html } = block(
      '<!-- wp:paragraph -->\n<p>Hi <strong>you</strong>, see <a href="https://blog.example.com/about/team/">team</a> and <a href="https://elsewhere.example.org/">this</a>.</p>\n<!-- /wp:paragraph -->',
    )
    expect(html).toBe(
      '<p>Hi <strong>you</strong>, see <a href="/about/team">team</a> and <a href="https://elsewhere.example.org/">this</a>.</p>',
    )
  })

  it('heading and list', () => {
    const { html } = block(
      '<!-- wp:heading {"level":3} -->\n<h3 class="wp-block-heading">Title</h3>\n<!-- /wp:heading -->\n<!-- wp:list -->\n<ul class="wp-block-list"><!-- wp:list-item -->\n<li>One</li>\n<!-- /wp:list-item --></ul>\n<!-- /wp:list -->',
    )
    expect(html).toContain('<h3 class="wp-block-heading">Title</h3>')
    expect(html).toMatch(/<ul class="wp-block-list">\s*<li>One<\/li>\s*<\/ul>/)
  })

  it('image becomes an upload node and its caption a paragraph', () => {
    const { html, warnings } = block(
      '<!-- wp:image {"id":102} -->\n<figure class="wp-block-image"><a href="https://blog.example.com/wp-content/uploads/2024/01/loaf.png"><img src="https://blog.example.com/wp-content/uploads/2024/01/loaf-300x200.png" alt="Loaf" class="wp-image-102"/></a><figcaption class="wp-element-caption">Our loaf</figcaption></figure>\n<!-- /wp:image -->',
    )
    expect(html).toBe(
      '<img data-lexical-upload-relation-to="media" data-lexical-upload-id="m102"><p>Our loaf</p>',
    )
    expect(warnings).toEqual([])
  })

  it('image inside a paragraph is moved out between the two halves', () => {
    const { html } = block(
      '<p>Before <img src="/wp-content/uploads/2024/02/croissant.png"> after</p>',
    )
    expect(html).toBe(
      '<p>Before </p><img data-lexical-upload-relation-to="media" data-lexical-upload-id="m103"><p> after</p>',
    )
  })

  it('unknown images become links with a warning', () => {
    const { html, warnings } = block(
      '<p><img src="https://other.example.org/pic.jpg" alt="Pic"></p>',
    )
    expect(html).toBe('<p><a href="https://other.example.org/pic.jpg">Pic</a></p>')
    expect(warnings.map((w) => w.code)).toEqual(['IMAGE_NOT_FOUND'])
  })

  it('gallery becomes a series of images', () => {
    const { html } = block(
      '<!-- wp:gallery -->\n<figure class="wp-block-gallery"><!-- wp:image {"id":102} -->\n<figure class="wp-block-image"><img src="x" class="wp-image-102"/></figure>\n<!-- /wp:image --><!-- wp:image {"id":103} -->\n<figure class="wp-block-image"><img src="y" class="wp-image-103"/></figure>\n<!-- /wp:image --></figure>\n<!-- /wp:gallery -->',
    )
    expect(html.match(/data-lexical-upload-id="(m\d+)"/g)).toEqual([
      'data-lexical-upload-id="m102"',
      'data-lexical-upload-id="m103"',
    ])
  })

  it('quote keeps paragraphs as line breaks and the citation', () => {
    const { html } = block(
      '<!-- wp:quote -->\n<blockquote class="wp-block-quote"><!-- wp:paragraph -->\n<p>One</p>\n<!-- /wp:paragraph --><!-- wp:paragraph -->\n<p>Two</p>\n<!-- /wp:paragraph --><cite>Someone</cite></blockquote>\n<!-- /wp:quote -->',
    )
    expect(html).toBe('<blockquote class="wp-block-quote">One<br>Two<br>— Someone</blockquote>')
  })

  it('code becomes a block placeholder, or inline code without a code block', () => {
    const source =
      '<!-- wp:code -->\n<pre class="wp-block-code"><code class="language-js">a &lt; b\nc</code></pre>\n<!-- /wp:code -->'
    const withBlock = block(source)
    expect(withBlock.html).toBe('<p>WP2PBLOCK0X</p>')
    expect(withBlock.blocks).toEqual([
      { token: 'WP2PBLOCK0X', blockType: 'code', fields: { code: 'a < b\nc', language: 'js' } },
    ])
    const without = block(source, { codeBlock: false })
    expect(without.html).toBe('<p><code>a &lt; b<br>c</code></p>')
    expect(without.warnings.map((w) => w.code)).toEqual(['CODE_AS_TEXT'])
  })

  it('preformatted text keeps its line breaks', () => {
    const { html } = block(
      '<!-- wp:preformatted -->\n<pre class="wp-block-preformatted">a\nb</pre>\n<!-- /wp:preformatted -->',
    )
    expect(html).toBe('<p>a<br>b</p>')
  })

  it('table is kept, or flattened when the editor has no tables', () => {
    const source =
      '<!-- wp:table -->\n<figure class="wp-block-table"><table><tbody><tr><td>A</td><td>1</td></tr></tbody></table></figure>\n<!-- /wp:table -->'
    expect(block(source).html).toBe('<table><tbody><tr><td>A</td><td>1</td></tr></tbody></table>')
    const flat = block(source, { table: false })
    expect(flat.html).toBe('<p>A | 1</p>')
    expect(flat.warnings.map((w) => w.code)).toEqual(['TABLE_FLATTENED'])
  })

  it('separator, buttons, columns and group', () => {
    const item = items.get(10)
    if (!item) throw new Error('fixture item 10 missing')
    const { html } = block(item.content)
    expect(html).toContain('<hr class="wp-block-separator has-alpha-channel-opacity">')
    expect(html).toContain(
      '<p><a class="wp-block-button__link wp-element-button" href="/contact">Order now</a></p>',
    )
    expect(html).toContain('<p>Left column text.</p>')
    expect(html).toContain('<p>Grouped right column text.</p>')
    expect(html).not.toContain('<div')
  })

  it('embeds become blocks or links', () => {
    const source =
      '<!-- wp:embed {"url":"https://www.youtube.com/watch?v=abc","providerNameSlug":"youtube"} -->\n<figure class="wp-block-embed"><div class="wp-block-embed__wrapper">\nhttps://www.youtube.com/watch?v=abc\n</div></figure>\n<!-- /wp:embed -->'
    expect(block(source).blocks).toEqual([
      {
        token: 'WP2PBLOCK0X',
        blockType: 'embed',
        fields: { url: 'https://www.youtube.com/watch?v=abc', provider: 'youtube' },
      },
    ])
    const link = block(source, { embedBlock: false })
    expect(link.html).toBe(
      '<p><a href="https://www.youtube.com/watch?v=abc">https://www.youtube.com/watch?v=abc</a></p>',
    )
  })

  it('dynamic and unknown blocks are reported', () => {
    const { html, warnings } = block(
      '<!-- wp:latest-posts /-->\n<!-- wp:spacer -->\n<div class="wp-block-spacer"></div>\n<!-- /wp:spacer -->\n<!-- wp:acme/box -->\n<div class="acme-box"><p>Inside</p></div>\n<!-- /wp:acme/box -->\n<!-- wp:acme/counter /-->',
    )
    expect(html).toBe('<p>Inside</p>')
    expect(warnings.map((w) => `${w.code}:${w.subject}`)).toEqual([
      'BLOCK_REMOVED:core/latest-posts',
      'BLOCK_UNKNOWN:acme/box',
      'BLOCK_REMOVED:acme/counter',
    ])
  })

  it('iframes and scripts are removed safely', () => {
    const { html, warnings } = block(
      '<p>x</p><iframe src="https://maps.example.com/embed?q=1"></iframe><script>alert(1)</script><p><a href="javascript:alert(1)">bad</a></p>',
    )
    expect(html).toBe(
      '<p>x</p><p><a href="https://maps.example.com/embed?q=1">https://maps.example.com/embed?q=1</a></p><p>bad</p>',
    )
    expect(warnings.map((w) => w.code).sort()).toEqual(['ELEMENT_REMOVED', 'IFRAME_REMOVED'])
  })
})

describe('prepareContent: classic content and shortcodes', () => {
  it('wraps paragraphs, converts [caption] and removes plugin shortcodes', () => {
    const item = items.get(11)
    if (!item) throw new Error('fixture item 11 missing')
    const ctx = contentContext(index, { postId: 11 })
    const html = compact(prepareContent(item.content, ctx).html)
    expect(html).toBe(
      [
        '<p>We have news! Our shop opens <strong>earlier</strong> from March.</p>',
        '<img data-lexical-upload-relation-to="media" data-lexical-upload-id="m103"><p>Fresh croissants every morning</p>',
        '<p>See the <a href="/blog/hello-sourdough">sourdough post</a> and our  form.</p>',
        '<p>Line one<br>\nline two</p>',
      ].join(''),
    )
    expect(ctx.warnings.warnings).toEqual([
      {
        code: 'SHORTCODE_REMOVED',
        message: 'Shortcode [contact-form-7] removed (it has no text content).',
        subject: '[contact-form-7]',
      },
    ])
  })

  it('expands [gallery] from ids and from attached images', () => {
    const ctx = contentContext(index, { postId: 10 })
    expect(prepareContent('[gallery ids="103"]', ctx).html).toBe(
      '<img data-lexical-upload-relation-to="media" data-lexical-upload-id="m103">',
    )
    const attached = prepareContent('[gallery]', ctx).html
    expect(attached.match(/upload-id="(m\d+)"/g)).toEqual(['upload-id="m101"', 'upload-id="m102"'])
  })

  it('unwraps page builder markup and keeps its text', () => {
    const ctx = contentContext(index, { postId: 2, builders: ['divi'] })
    const html = compact(
      prepareContent(
        '[et_pb_section][et_pb_row][et_pb_column][et_pb_text]<h2>Services</h2><p>Design.</p>[/et_pb_text][et_pb_button button_url="/contact/" button_text="Call"][/et_pb_column][/et_pb_row][/et_pb_section]',
        ctx,
      ).html,
    )
    expect(html).toBe('<h2>Services</h2><p>Design.</p><p><a href="/contact">Call</a></p>')
    expect(ctx.warnings.warnings.map((w) => w.code)).toEqual(['BUILDER_MARKUP'])
  })
})
