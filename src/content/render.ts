import { escapeHtml } from '../util/html.js'
import { autop } from './autop.js'
import { blockSupport, hasBlocks, normalizeBlockName } from './blocks.js'
import { joinInnerContent, parseBlocks, type ParsedBlock } from './block-parser.js'
import { BUILDER_LABELS } from './builders.js'
import { replaceShortcodes, type Shortcode } from './shortcodes.js'
import { isBuilderShortcode } from './shortcodes-scan.js'
import type { ContentContext } from './types.js'

/** Blocks removed without a warning: they only add space or split the post. */
const SILENT_DROPS = new Set(['core/spacer', 'core/more', 'core/nextpage'])

const embedElement = (url: string, provider = ''): string =>
  `<wp2p-embed data-url="${escapeHtml(url)}" data-provider="${escapeHtml(provider)}"></wp2p-embed>`

const imageElement = (ctx: ContentContext, id: number): string => {
  const a = ctx.media.get(id)
  if (!a) return ''
  return `<img src="${escapeHtml(a.url)}" alt="${escapeHtml(a.alt ?? '')}" class="wp-image-${id}">`
}

/** Blocks whose text a pattern override can replace: their `content` attribute. */
const OVERRIDABLE = new Set(['core/paragraph', 'core/heading'])

/**
 * Pattern overrides (WordPress 6.6+): a `core/block` reference can carry new values for blocks
 * of the pattern that have a name and are bound to `core/pattern-overrides`. Paragraph and
 * heading texts are applied; any other override is reported.
 */
const applyOverrides = (
  blocks: ParsedBlock[],
  overrides: Record<string, unknown>,
  unapplied: Set<string>,
): ParsedBlock[] =>
  blocks.map((b) => {
    const metadata = b.attrs.metadata as { name?: unknown } | undefined
    const name = typeof metadata?.name === 'string' ? metadata.name : undefined
    const values = name === undefined ? undefined : overrides[name]
    let block = { ...b, innerBlocks: applyOverrides(b.innerBlocks, overrides, unapplied) }
    if (!values || typeof values !== 'object') return block
    for (const [attribute, value] of Object.entries(values as Record<string, unknown>)) {
      const blockName = normalizeBlockName(b.name ?? '')
      if (attribute === 'content' && typeof value === 'string' && OVERRIDABLE.has(blockName)) {
        // The stored HTML holds the pattern's text; keep its tag and attributes, swap the text.
        block = {
          ...block,
          innerContent: block.innerContent.map((html) =>
            html === null
              ? null
              : html.replace(/^(\s*<[a-z0-9]+\b[^>]*>)[\s\S]*(<\/[a-z0-9]+>\s*)$/i, `$1${value}$2`),
          ),
        }
      } else {
        unapplied.add(`${blockName} ${attribute}`)
      }
    }
    return block
  })

const renderBlock = (
  b: ParsedBlock,
  ctx: ContentContext,
  reported: Set<string>,
  shortcodes: (html: string) => string,
  /** Synced patterns being rendered, outermost first, against reference loops. */
  patterns: number[] = [],
): string => {
  const inner = () =>
    joinInnerContent(b, (child) => renderBlock(child, ctx, reported, shortcodes, patterns))
  // Classic content and shortcode blocks: shortcodes first, then paragraphs, as WordPress does.
  if (b.name === null || b.name === 'core/freeform' || b.name === 'core/shortcode') {
    return autop(shortcodes(inner()))
  }

  const name = normalizeBlockName(b.name)
  const once = (code: Parameters<ContentContext['warnings']['add']>[0], message: string) => {
    if (reported.has(`${code}:${name}`)) return
    reported.add(`${code}:${name}`)
    ctx.warnings.add(code, message, name)
  }

  if (name === 'core/embed' || name.startsWith('core-embed/')) {
    const html = inner()
    const url =
      (typeof b.attrs.url === 'string' && b.attrs.url) ||
      /https?:\/\/[^\s<"]+/.exec(html.replace(/<[^>]+>/g, ' '))?.[0]
    const provider =
      typeof b.attrs.providerNameSlug === 'string'
        ? b.attrs.providerNameSlug
        : name.replace('core-embed/', '')
    return url ? embedElement(url, provider === 'core/embed' ? '' : provider) : ''
  }

  if (name === 'core/block') {
    // A synced pattern: its content is a `wp_block` item of the export.
    const ref = Number(b.attrs.ref)
    const content = Number.isInteger(ref) && ref > 0 ? ctx.pattern?.(ref) : undefined
    if (content === undefined) {
      const id = Number.isInteger(ref) && ref > 0 ? `${ref} ` : ''
      once(
        'BLOCK_REMOVED',
        `Synced pattern (reusable block) ${id}removed: it is not in the export.`,
      )
      return ''
    }
    if (patterns.includes(ref)) {
      once(
        'BLOCK_REMOVED',
        `Synced pattern ${ref} contains itself; the repeated part was left out.`,
      )
      return ''
    }
    if (!hasBlocks(content)) return autop(shortcodes(content))
    const overrides =
      b.attrs.content && typeof b.attrs.content === 'object'
        ? (b.attrs.content as Record<string, unknown>)
        : {}
    const unapplied = new Set<string>()
    const html = applyOverrides(parseBlocks(content), overrides, unapplied)
      .map((child) => renderBlock(child, ctx, reported, shortcodes, [...patterns, ref]))
      .join('\n')
    if (unapplied.size > 0) {
      once(
        'BLOCK_PARTIAL',
        `Synced pattern ${ref}: overrides of ${[...unapplied].join(', ')} were not applied; the pattern's own values were kept.`,
      )
    }
    return html
  }

  const support = blockSupport(name)
  if (support === 'dropped') {
    if (!SILENT_DROPS.has(name)) {
      once(
        'BLOCK_REMOVED',
        `Block "${name}" removed: it is rendered by WordPress at request time and has no stored content.`,
      )
    }
    return ''
  }
  const html = inner()
  if (support === 'partial') {
    once('BLOCK_PARTIAL', `Block "${name}" converted with loss of layout or features.`)
  } else if (support === 'unknown') {
    if (html.replace(/<[^>]*>/g, '').trim() === '' && !/<img\b/i.test(html)) {
      once(
        'BLOCK_REMOVED',
        `Block "${name}" removed: it has no stored content (probably rendered by a plugin).`,
      )
      return ''
    }
    once('BLOCK_UNKNOWN', `Block "${name}" has no converter; its HTML was converted as is.`)
  }
  return html
}

const stripTags = (html: string): string => html.replace(/<[^>]*>/g, '')

const handleShortcode = (s: Shortcode, ctx: ContentContext, reported: Set<string>): string => {
  const content = s.content ?? ''
  const warnOnce = (
    code: 'SHORTCODE_REMOVED' | 'BUILDER_MARKUP' | 'EMBED_AS_LINK',
    message: string,
  ) => {
    if (reported.has(`${code}:${s.name}`)) return
    reported.add(`${code}:${s.name}`)
    ctx.warnings.add(code, message, `[${s.name}]`)
  }

  switch (s.name) {
    case 'caption':
    case 'wp_caption': {
      const image = /(<a\b[^>]*>\s*)?<img\b[^>]*>(\s*<\/a>)?/i.exec(content)?.[0] ?? ''
      const text = (s.attrs.caption ?? content.replace(image, '')).trim()
      return `<figure>${image}${text ? `<figcaption>${text}</figcaption>` : ''}</figure>`
    }
    case 'gallery': {
      const ids = (s.attrs.ids ?? s.attrs.include ?? '')
        .split(',')
        .map((id) => Number(id.trim()))
        .filter((id) => Number.isInteger(id) && id > 0)
      const attachments = ids.length > 0 ? ids : ctx.attachmentsOf(ctx.postId).map((a) => a.id)
      return `<figure class="wp2p-gallery">${attachments.map((id) => imageElement(ctx, id)).join('')}</figure>`
    }
    case 'embed':
      return content.trim() ? embedElement(stripTags(content).trim()) : ''
    case 'audio':
    case 'video': {
      // `id` is not WordPress's: the Elementor converter names a file of the media library so.
      const id = Number(s.attrs.id)
      const src =
        s.attrs.src ??
        s.attrs.mp3 ??
        s.attrs.mp4 ??
        s.attrs.m4a ??
        s.attrs.ogg ??
        s.attrs.webm ??
        s.attrs.wav ??
        (id > 0 ? ctx.media.get(id)?.url : undefined)
      if (!src) {
        if (id > 0) {
          ctx.warnings.add(
            'REFERENCE_MISSING',
            `The file ${id} of a [${s.name}] player is not in the export; the player was left out.`,
            `[${s.name}]`,
          )
        }
        return ''
      }
      warnOnce('EMBED_AS_LINK', `[${s.name}] player replaced by a link to the file.`)
      return `<p><a href="${escapeHtml(src)}">${escapeHtml(src.split('/').pop() ?? src)}</a></p>`
    }
  }

  if (isBuilderShortcode(s.name)) {
    if (s.name === 'vc_single_image' && s.attrs.image && /^\d+$/.test(s.attrs.image)) {
      return imageElement(ctx, Number(s.attrs.image))
    }
    if (s.name === 'et_pb_image' && s.attrs.src) {
      return `<img src="${escapeHtml(s.attrs.src)}" alt="${escapeHtml(s.attrs.alt ?? '')}">`
    }
    if (s.name === 'et_pb_button' && s.attrs.button_url) {
      return `<p><a href="${escapeHtml(s.attrs.button_url)}">${escapeHtml(s.attrs.button_text ?? s.attrs.button_url)}</a></p>`
    }
    // Layout wrappers: keep what is inside, on its own lines so autop keeps paragraphs apart.
    return content ? `\n\n${content}\n\n` : ''
  }

  warnOnce(
    'SHORTCODE_REMOVED',
    content.trim()
      ? `Shortcode [${s.name}] removed; the text inside it was kept.`
      : `Shortcode [${s.name}] removed (it has no text content).`,
  )
  return content
}

/**
 * Turns WordPress post content (blocks or classic) into plain HTML: blocks are resolved,
 * shortcodes replaced, classic text wrapped in paragraphs. Embeds become `<wp2p-embed>`
 * elements for the DOM step.
 */
export const renderContent = (content: string, ctx: ContentContext): string => {
  const reported = new Set<string>()
  for (const builder of ctx.builders) {
    ctx.warnings.add(
      'BUILDER_MARKUP',
      `${BUILDER_LABELS[builder]} layout is not migrated; only the text and images were kept.`,
      builder,
    )
  }
  const shortcodes = (html: string) =>
    replaceShortcodes(html, (s) => handleShortcode(s, ctx, reported))
  if (!hasBlocks(content)) return autop(shortcodes(content))
  const html = parseBlocks(content)
    .map((b) => renderBlock(b, ctx, reported, shortcodes))
    .join('\n')
  return shortcodes(html)
}
