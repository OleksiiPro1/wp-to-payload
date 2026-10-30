/**
 * Turns classic-editor text into HTML paragraphs: blank lines separate paragraphs and single
 * line breaks become `<br>`. Our own implementation of the behaviour WordPress applies when it
 * displays classic content. Block-level HTML (lists, tables, figures, …) is kept as it is; only
 * text between block elements is wrapped.
 */

const BLOCK_TAGS = new Set(
  'address article aside blockquote details dd div dl dt fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header li main nav ol p pre section summary table tbody td tfoot th thead tr ul iframe video audio object style script noscript textarea wp2p-embed'.split(
    ' ',
  ),
)
const VOID_BLOCK_TAGS = new Set(['hr'])
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g
const RAW_TEXT = new Set(['pre', 'script', 'style', 'textarea'])

const wrap = (text: string): string =>
  text
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => `<p>${chunk.replace(/\s*\n\s*/g, '<br />\n')}</p>`)
    .join('\n')

export const autop = (text: string): string => {
  const html = text.replace(/\r\n?/g, '\n')
  if (html.trim() === '') return ''
  const out: string[] = []
  let depth = 0
  let rawText: string | undefined
  let segmentStart = 0
  let blockStart = 0

  for (const m of html.matchAll(TAG)) {
    const [whole, closing, rawName = '', selfClosing] = m
    const name = rawName.toLowerCase()
    const at = m.index
    if (rawText) {
      if (closing && name === rawText) rawText = undefined
      else continue
    } else if (RAW_TEXT.has(name) && !closing) {
      rawText = name
    }
    if (VOID_BLOCK_TAGS.has(name) && depth === 0) {
      out.push(wrap(html.slice(segmentStart, at)), whole)
      segmentStart = at + whole.length
      continue
    }
    if (!BLOCK_TAGS.has(name)) continue
    if (!closing) {
      if (depth === 0) {
        out.push(wrap(html.slice(segmentStart, at)))
        blockStart = at
      }
      if (selfClosing) {
        if (depth === 0) {
          out.push(whole)
          segmentStart = at + whole.length
        }
      } else {
        depth++
      }
    } else if (depth > 0) {
      depth--
      if (depth === 0) {
        out.push(html.slice(blockStart, at + whole.length).trim())
        segmentStart = at + whole.length
      }
    }
  }
  if (depth > 0) out.push(html.slice(blockStart).trim())
  else out.push(wrap(html.slice(segmentStart)))
  return out.filter(Boolean).join('\n')
}
