/** WordPress core shortcodes. */
export const CORE_SHORTCODES = new Set([
  'caption',
  'wp_caption',
  'gallery',
  'audio',
  'video',
  'playlist',
  'embed',
])

/** Shortcodes that page builders use as layout markup (Divi, WPBakery, Avada). */
export const BUILDER_SHORTCODE_PREFIXES = ['et_pb_', 'vc_', 'fusion_']

export const isBuilderShortcode = (name: string): boolean =>
  BUILDER_SHORTCODE_PREFIXES.some((prefix) => name.startsWith(prefix))

/**
 * Finds shortcode names in content. A bracketed word only counts when it looks like a shortcode
 * (it has attributes, is self-closing, has a closing tag, or is a core shortcode), so plain text
 * such as "[Note]" is not reported.
 */
export const scanShortcodes = (content: string): Map<string, number> => {
  const found = new Map<string, number>()
  const opener = /(\[?)\[([a-zA-Z][\w-]*)(\s[^\]]*?)?(\/)?\](\]?)/g
  for (const match of content.matchAll(opener)) {
    const [, escapeOpen, name = '', attrs, selfClosing, escapeClose] = match
    if (escapeOpen && escapeClose) continue
    const isShortcode =
      CORE_SHORTCODES.has(name) ||
      /=/.test(attrs ?? '') ||
      selfClosing !== undefined ||
      content.includes(`[/${name}]`)
    if (isShortcode) found.set(name, (found.get(name) ?? 0) + 1)
  }
  return found
}
