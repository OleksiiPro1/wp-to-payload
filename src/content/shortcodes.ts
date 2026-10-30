import { CORE_SHORTCODES, isBuilderShortcode } from './shortcodes-scan.js'

export interface Shortcode {
  name: string
  attrs: Record<string, string>
  /** Positional (unnamed) attributes. */
  args: string[]
  /** Content between the opening and closing tag, or `undefined` for a self-contained tag. */
  content: string | undefined
}

/** Returns replacement HTML for a shortcode. */
export type ShortcodeHandler = (shortcode: Shortcode) => string

export const parseShortcodeAttrs = (text: string): Pick<Shortcode, 'attrs' | 'args'> => {
  const attrs: Record<string, string> = {}
  const args: string[] = []
  const pattern =
    /([\w-]+)\s*=\s*"([^"]*)"|([\w-]+)\s*=\s*'([^']*)'|([\w-]+)\s*=\s*([^\s'"]+)|"([^"]*)"|(\S+)/g
  for (const m of text.matchAll(pattern)) {
    if (m[1] !== undefined) attrs[m[1].toLowerCase()] = m[2] ?? ''
    else if (m[3] !== undefined) attrs[m[3].toLowerCase()] = m[4] ?? ''
    else if (m[5] !== undefined) attrs[m[5].toLowerCase()] = m[6] ?? ''
    else if (m[7] !== undefined) args.push(m[7])
    else if (m[8] !== undefined && m[8] !== '/') args.push(m[8])
  }
  return { attrs, args }
}

const OPENER = /(\[?)\[([a-zA-Z][\w-]*)((?:\s[^\]]*?)?)(\/)?\](\]?)/g

/**
 * Replaces shortcodes in `text`, innermost content first. A bracketed word only counts as a
 * shortcode when it looks like one (see `scanShortcodes`), so text such as "[Note]" is kept.
 * `[[name]]` is the WordPress escape for a literal `[name]`.
 */
export const replaceShortcodes = (text: string, handler: ShortcodeHandler): string => {
  let result = ''
  let offset = 0
  OPENER.lastIndex = 0
  for (;;) {
    OPENER.lastIndex = offset
    const m = OPENER.exec(text)
    if (!m) break
    const [whole, escapeOpen, name = '', rawAttrs = '', selfClosing, escapeClose] = m
    const start = m.index
    const closeTag = `[/${name}]`
    const closeAt = selfClosing ? -1 : text.indexOf(closeTag, start + whole.length)

    if (escapeOpen && escapeClose) {
      result += text.slice(offset, start) + whole.slice(1, -1)
      offset = start + whole.length
      continue
    }
    const looksLikeShortcode =
      CORE_SHORTCODES.has(name) ||
      isBuilderShortcode(name) ||
      rawAttrs.includes('=') ||
      selfClosing !== undefined ||
      closeAt !== -1
    if (!looksLikeShortcode) {
      result += text.slice(offset, start + 1)
      offset = start + 1
      continue
    }

    // An escape bracket on one side only is ordinary text.
    const lead = escapeOpen ?? ''
    const { attrs, args } = parseShortcodeAttrs(rawAttrs)
    let end = start + whole.length - (escapeClose ? 1 : 0)
    let content: string | undefined
    if (closeAt !== -1) {
      content = replaceShortcodes(text.slice(end, closeAt), handler)
      end = closeAt + closeTag.length
    }
    result += text.slice(offset, start) + lead + handler({ name, attrs, args, content })
    offset = end
  }
  return result + text.slice(offset)
}
