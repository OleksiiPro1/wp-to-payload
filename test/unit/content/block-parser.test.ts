import { describe, expect, it } from 'vitest'
import {
  joinInnerContent,
  parseBlocks,
  type ParsedBlock,
} from '../../../src/content/block-parser.js'

const render = (b: ParsedBlock): string => joinInnerContent(b, render)

describe('parseBlocks', () => {
  it('parses blocks with attributes, nesting and void blocks', () => {
    const blocks = parseBlocks(`<!-- wp:paragraph {"align":"center"} -->
<p>Hi</p>
<!-- /wp:paragraph -->

<!-- wp:columns -->
<div class="wp-block-columns"><!-- wp:column -->
<div class="wp-block-column"><!-- wp:acme/widget {"a":[1,2]} /--></div>
<!-- /wp:column --></div>
<!-- /wp:columns -->`)
    expect(blocks.map((b) => b.name)).toEqual(['core/paragraph', 'core/columns'])
    expect(blocks[0]?.attrs).toEqual({ align: 'center' })
    expect(blocks[0]?.innerContent).toEqual(['\n<p>Hi</p>\n'])
    const column = blocks[1]?.innerBlocks[0]
    expect(column?.name).toBe('core/column')
    expect(column?.innerBlocks[0]).toMatchObject({ name: 'acme/widget', attrs: { a: [1, 2] } })
    expect(render(blocks[1] as ParsedBlock)).toBe(
      '\n<div class="wp-block-columns">\n<div class="wp-block-column"></div>\n</div>\n',
    )
  })

  it('keeps content outside blocks as freeform blocks and skips whitespace', () => {
    const blocks = parseBlocks(
      'Classic text\n\n<!-- wp:separator -->\n<hr/>\n<!-- /wp:separator -->\n\n',
    )
    expect(blocks.map((b) => b.name)).toEqual([null, 'core/separator'])
    expect(blocks[0]?.innerContent).toEqual(['Classic text\n\n'])
  })

  it('survives broken JSON, stray closers and unclosed blocks', () => {
    const blocks = parseBlocks(
      '<!-- /wp:quote --><!-- wp:image {broken json} --><img src="a.png"/><!-- wp:group --><p>x</p>',
    )
    expect(blocks.map((b) => b.name)).toEqual(['core/image'])
    expect(blocks[0]?.attrs).toEqual({})
    expect(blocks[0]?.innerBlocks[0]?.name).toBe('core/group')
  })

  it('does not treat ordinary HTML comments as blocks', () => {
    const blocks = parseBlocks('<!-- just a comment --><p>x</p><!--more-->')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.name).toBeNull()
  })
})
