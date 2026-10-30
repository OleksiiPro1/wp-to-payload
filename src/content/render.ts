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

const renderBlock = (
  b: ParsedBlock,
  ctx: ContentContext,
  reported: Set<string>,
  shortcodes: (html: string) => string,
): string => {
  const inner = () => joinInnerContent(b, (child) => renderBlock(child, ctx, reported, shortcodes))
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
    once(
      'BLOCK_REMOVED',
      'Reusable block (synced pattern) removed: its content is stored separately.',
    )
    return ''
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
      const src =
        s.attrs.src ??
        s.attrs.mp3 ??
        s.attrs.mp4 ??
        s.attrs.m4a ??
        s.attrs.ogg ??
        s.attrs.webm ??
        s.attrs.wav
      if (!src) return ''
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
