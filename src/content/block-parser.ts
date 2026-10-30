/**
 * Parser for the block format Gutenberg stores in post_content: HTML with block boundaries in
 * comments, `<!-- wp:name {"attr":1} -->…<!-- /wp:name -->` or `<!-- wp:name /-->`. Written from
 * the documented format; it never throws, and content outside blocks becomes freeform blocks.
 */

export interface ParsedBlock {
  /** Full block name such as `core/paragraph`, or `null` for content outside any block. */
  name: string | null
  attrs: Record<string, unknown>
  innerBlocks: ParsedBlock[]
  /** HTML of the block itself; `null` entries mark where inner blocks go, in order. */
  innerContent: (string | null)[]
}

const DELIMITER =
  /<!--\s+(\/)?wp:([a-z][a-z0-9_-]*\/)?([a-z][a-z0-9_-]*)\s+(\{[\s\S]*?\}\s+)?(\/)?-->/g

const parseAttrs = (json: string | undefined): Record<string, unknown> => {
  if (!json) return {}
  try {
    const value: unknown = JSON.parse(json)
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

const block = (name: string | null, attrs: Record<string, unknown> = {}): ParsedBlock => ({
  name,
  attrs,
  innerBlocks: [],
  innerContent: [],
})

const freeform = (html: string): ParsedBlock => ({ ...block(null), innerContent: [html] })

export const parseBlocks = (content: string): ParsedBlock[] => {
  const output: ParsedBlock[] = []
  const stack: ParsedBlock[] = []
  let offset = 0

  const addText = (text: string) => {
    if (text === '') return
    const parent = stack[stack.length - 1]
    if (parent) parent.innerContent.push(text)
    else if (text.trim() !== '') output.push(freeform(text))
  }

  const addBlock = (b: ParsedBlock) => {
    const parent = stack[stack.length - 1]
    if (parent) {
      parent.innerBlocks.push(b)
      parent.innerContent.push(null)
    } else {
      output.push(b)
    }
  }

  for (const match of content.matchAll(DELIMITER)) {
    const [whole, closer, namespace, local, json, selfClosing] = match
    const name = `${namespace ?? 'core/'}${local}`
    addText(content.slice(offset, match.index))
    offset = match.index + whole.length

    if (closer) {
      // Close the nearest open block with this name; blocks opened inside it are closed too.
      const at = stack.map((b) => b.name).lastIndexOf(name)
      if (at === -1) continue
      while (stack.length > at) {
        const done = stack.pop() as ParsedBlock
        addBlock(done)
      }
      continue
    }

    const b = block(name, parseAttrs(json))
    if (selfClosing) addBlock(b)
    else stack.push(b)
  }
  addText(content.slice(offset))
  // Unclosed blocks at the end are closed implicitly.
  while (stack.length > 0) addBlock(stack.pop() as ParsedBlock)
  return output
}

/** The HTML a block saved, with its inner blocks rendered by `render`. */
export const joinInnerContent = (
  b: ParsedBlock,
  render: (inner: ParsedBlock) => string,
): string => {
  let next = 0
  return b.innerContent
    .map((part) => {
      if (part !== null) return part
      const inner = b.innerBlocks[next++]
      return inner ? render(inner) : ''
    })
    .join('')
}
