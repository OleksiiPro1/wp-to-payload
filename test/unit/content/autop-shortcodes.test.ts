import { describe, expect, it } from 'vitest'
import { autop } from '../../../src/content/autop.js'
import { parseShortcodeAttrs, replaceShortcodes } from '../../../src/content/shortcodes.js'

describe('autop', () => {
  it('wraps paragraphs and turns single line breaks into <br>', () => {
    expect(autop('First line\nsecond line\n\nNext paragraph')).toBe(
      '<p>First line<br />\nsecond line</p>\n<p>Next paragraph</p>',
    )
  })

  it('leaves block-level HTML and preformatted text alone', () => {
    expect(autop('Intro\n<ul>\n<li>A</li>\n</ul>\nOutro\n\n<pre>a\n\nb</pre>')).toBe(
      '<p>Intro</p>\n<ul>\n<li>A</li>\n</ul>\n<p>Outro</p>\n<pre>a\n\nb</pre>',
    )
  })

  it('returns an empty string for blank input', () => {
    expect(autop(' \n\n ')).toBe('')
  })
})

describe('shortcodes', () => {
  it('parses quoted, unquoted and positional attributes', () => {
    expect(parseShortcodeAttrs(` id="5" title='Contact' width=300 "https://x.test" flag`)).toEqual({
      attrs: { id: '5', title: 'Contact', width: '300' },
      args: ['https://x.test', 'flag'],
    })
  })

  it('replaces enclosing and self-contained shortcodes, innermost first', () => {
    const out = replaceShortcodes(
      'A [outer x="1"]B [inner/] C[/outer] D [gallery ids="1,2"] [Note] [[caption]]',
      (s) => `<${s.name}${s.content !== undefined ? `>${s.content}</${s.name}>` : '/>'}`,
    )
    expect(out).toBe('A <outer>B <inner/> C</outer> D <gallery/> [Note] [caption]')
  })
})
