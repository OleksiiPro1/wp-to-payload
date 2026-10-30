import { JSDOM } from 'jsdom'
import type { ContentContext, PlaceholderBlock, PreparedContent } from './types.js'

const BLOCK_ELEMENTS = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'DETAILS',
  'DIV',
  'DL',
  'FIGURE',
  'FOOTER',
  'FORM',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'HR',
  'IMG',
  'MAIN',
  'NAV',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'TABLE',
  'UL',
  'FIGCAPTION',
  'SUMMARY',
])
const CONTAINERS = new Set([
  'DIV',
  'SECTION',
  'ARTICLE',
  'MAIN',
  'HEADER',
  'FOOTER',
  'ASIDE',
  'NAV',
  'ADDRESS',
  'DETAILS',
  'SUMMARY',
  'CENTER',
])
/** Removed with their content. */
const JUNK =
  'script, style, noscript, template, form, input, select, textarea, button, svg, canvas, object, embed, link, meta, map'
const REPORTED_JUNK = new Set(['SCRIPT', 'FORM', 'OBJECT', 'EMBED'])
const VIDEO_HOSTS = /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be|vimeo\.com)$/i

const isBlank = (el: Element): boolean =>
  (el.textContent ?? '').replace(/\u00a0/g, ' ').trim() === '' &&
  !el.querySelector('img, hr, br + br')

const unwrap = (el: Element): void => {
  el.replaceWith(...Array.from(el.childNodes))
}

const rename = (el: Element, tag: string): Element => {
  const doc = el.ownerDocument
  const next = doc.createElement(tag)
  next.append(...Array.from(el.childNodes))
  el.replaceWith(next)
  return next
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

const providerOf = (url: string): string => {
  const host = hostOf(url)
  if (/youtu/i.test(host)) return 'youtube'
  if (/vimeo/i.test(host)) return 'vimeo'
  return host.replace(/^www\./, '')
}

/** Splits the top-level ancestor of `node` so that `node` ends up between the two halves. */
const hoistToTop = (node: Element, body: HTMLElement): void => {
  let top: Element = node
  while (top.parentElement && top.parentElement !== body) top = top.parentElement
  if (top === node) return
  const doc = node.ownerDocument
  const range = doc.createRange()
  range.setStartBefore(top.firstChild ?? node)
  range.setEndBefore(node)
  const before = range.extractContents()
  range.setStartAfter(node)
  range.setEndAfter(top.lastChild ?? node)
  const after = range.extractContents()
  const head = top.cloneNode(false) as Element
  head.append(before)
  const tail = top.cloneNode(false) as Element
  tail.append(after)
  const parts: Node[] = []
  if (!isBlank(head)) parts.push(head)
  parts.push(node)
  if (!isBlank(tail)) parts.push(tail)
  top.replaceWith(...parts)
}

/**
 * Cleans HTML for Payload's HTML → Lexical converter: images point to imported media, internal
 * links to new paths, embeds and code become placeholders for Lexical blocks (or fallbacks), and
 * markup Lexical cannot hold is simplified or removed. Every loss is reported as a warning.
 */
export const prepareDom = (html: string, ctx: ContentContext): PreparedContent => {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`)
  const doc = dom.window.document
  const body = doc.body
  const blocks: PlaceholderBlock[] = []
  const warned = new Set<string>()
  const warnOnce = (...args: Parameters<ContentContext['warnings']['add']>) => {
    const key = `${args[0]}:${args[2] ?? ''}`
    if (warned.has(key)) return
    warned.add(key)
    ctx.warnings.add(...args)
  }
  const all = (selector: string) => Array.from(body.querySelectorAll(selector))

  const placeholder = (
    blockType: PlaceholderBlock['blockType'],
    fields: Record<string, string>,
  ) => {
    const token = `WP2PBLOCK${blocks.length}X`
    blocks.push({ token, blockType, fields })
    const p = doc.createElement('p')
    p.textContent = token
    return p
  }
  const linkParagraph = (href: string, text: string) => {
    const p = doc.createElement('p')
    const a = doc.createElement('a')
    a.href = href
    a.textContent = text
    p.append(a)
    return p
  }

  // Comments (including <!--more-->) and markup without content.
  const walker = doc.createTreeWalker(body, dom.window.NodeFilter.SHOW_COMMENT)
  const comments: Node[] = []
  while (walker.nextNode()) comments.push(walker.currentNode)
  for (const c of comments) c.parentNode?.removeChild(c)
  for (const el of all(JUNK)) {
    if (REPORTED_JUNK.has(el.tagName)) {
      warnOnce(
        'ELEMENT_REMOVED',
        `<${el.tagName.toLowerCase()}> removed.`,
        el.tagName.toLowerCase(),
      )
    }
    el.remove()
  }
  for (const el of all('.wp-block-spacer')) el.remove()

  // Embeds: Lexical block when the editor has one, otherwise a link.
  const embed = (el: Element, url: string, provider: string) => {
    if (!url) return el.remove()
    if (ctx.capabilities.embedBlock) {
      hoistToTop(el, body)
      el.replaceWith(placeholder('embed', { url, provider }))
    } else {
      warnOnce(
        'EMBED_AS_LINK',
        'Embed converted to a link (the editor has no embed block).',
        provider || 'embed',
      )
      hoistToTop(el, body)
      el.replaceWith(linkParagraph(url, url))
    }
  }
  for (const el of all('wp2p-embed')) {
    const url = el.getAttribute('data-url') ?? ''
    embed(el, url, el.getAttribute('data-provider') || providerOf(url))
  }
  for (const el of all('iframe')) {
    const src = el.getAttribute('src') ?? ''
    if (VIDEO_HOSTS.test(hostOf(src))) {
      embed(el, src, providerOf(src))
    } else {
      warnOnce(
        'IFRAME_REMOVED',
        `iframe from ${hostOf(src) || 'an unknown source'} replaced by a link.`,
        hostOf(src),
      )
      if (src) {
        hoistToTop(el, body)
        el.replaceWith(linkParagraph(src, src))
      } else el.remove()
    }
  }
  for (const el of all('video, audio')) {
    const src = el.getAttribute('src') ?? el.querySelector('source')?.getAttribute('src') ?? ''
    warnOnce(
      'EMBED_AS_LINK',
      `<${el.tagName.toLowerCase()}> player replaced by a link to the file.`,
      el.tagName.toLowerCase(),
    )
    if (!src) {
      el.remove()
      continue
    }
    hoistToTop(el, body)
    el.replaceWith(linkParagraph(src, src.split('/').pop() ?? src))
  }

  // Code and preformatted text.
  for (const pre of all('pre')) {
    const code = pre.querySelector('code')
    const isCode = code !== null || pre.classList.contains('wp-block-code')
    const text = (pre.textContent ?? '').replace(/\n$/, '')
    hoistToTop(pre, body)
    if (isCode && ctx.capabilities.codeBlock) {
      const language =
        /\blanguage-([\w+-]+)/.exec(`${code?.className ?? ''} ${pre.className}`)?.[1] ?? ''
      pre.replaceWith(placeholder('code', { code: text, language }))
      continue
    }
    if (isCode)
      warnOnce(
        'CODE_AS_TEXT',
        'Code block converted to inline code (the editor has no code block).',
        'code',
      )
    const p = doc.createElement('p')
    const target = isCode ? p.appendChild(doc.createElement('code')) : p
    text.split('\n').forEach((line, i) => {
      if (i > 0) target.append(doc.createElement('br'))
      target.append(line)
    })
    pre.replaceWith(p)
  }

  // Figures and galleries: images and captions become separate top-level items.
  for (const el of all('figcaption')) rename(el, 'p')
  for (const el of all('ul.blocks-gallery-grid, ul.wp-block-gallery')) {
    for (const li of Array.from(el.querySelectorAll(':scope > li'))) unwrap(li)
    unwrap(el)
  }
  for (const el of all('figure')) unwrap(el)

  // Quotes hold inline content in Lexical: paragraphs inside become line breaks.
  for (const quote of all('blockquote')) {
    for (const cite of Array.from(quote.querySelectorAll('cite'))) {
      cite.replaceWith(doc.createTextNode(`— ${cite.textContent ?? ''}`))
    }
    const parts = Array.from(quote.childNodes)
    quote.replaceChildren()
    let first = true
    let previousWasBlock = false
    for (const part of parts) {
      const isBlock = part.nodeType === 1 && BLOCK_ELEMENTS.has((part as Element).tagName)
      if (part.nodeType === 3 && (part.textContent ?? '').trim() === '') continue
      if (!first && (isBlock || previousWasBlock)) quote.append(doc.createElement('br'))
      if (isBlock) quote.append(...Array.from(part.childNodes))
      else quote.append(part)
      first = false
      previousWasBlock = isBlock
    }
  }

  if (!ctx.capabilities.table) {
    for (const table of all('table')) {
      warnOnce(
        'TABLE_FLATTENED',
        'Table converted to paragraphs (the editor has no table feature).',
        'table',
      )
      const rows = Array.from(table.querySelectorAll('tr')).map((tr) => {
        const p = doc.createElement('p')
        p.textContent = Array.from(tr.children)
          .map((cell) => (cell.textContent ?? '').trim())
          .join(' | ')
        return p
      })
      hoistToTop(table, body)
      table.replaceWith(...rows)
    }
  }

  if (!ctx.capabilities.horizontalRule) for (const hr of all('hr')) hr.remove()

  // Layout containers: unwrap when they hold blocks, otherwise they are a paragraph.
  for (const el of all('*').reverse()) {
    if (!CONTAINERS.has(el.tagName) || !el.isConnected) continue
    const hasBlockChild = Array.from(el.children).some((c) => BLOCK_ELEMENTS.has(c.tagName))
    if (hasBlockChild || isBlank(el)) unwrap(el)
    else rename(el, 'p')
  }

  // Images: imported media become upload nodes; anything else becomes a link.
  for (const img of all('img')) {
    const src = img.getAttribute('src') ?? img.getAttribute('data-src') ?? ''
    const link = img.parentElement?.tagName === 'A' ? img.parentElement : undefined
    if (link && (link.textContent ?? '').trim() === '' && link.children.length === 1)
      link.replaceWith(img)
    const wpId = ctx.media.match(src, img.getAttribute('class') ?? '')
    const payloadId = wpId === undefined ? undefined : ctx.mediaId(wpId)
    hoistToTop(img, body)
    if (payloadId !== undefined && ctx.capabilities.upload) {
      const upload = doc.createElement('img')
      upload.setAttribute('data-lexical-upload-relation-to', ctx.mediaCollection)
      upload.setAttribute('data-lexical-upload-id', String(payloadId))
      img.replaceWith(upload)
      continue
    }
    if (!src) {
      img.remove()
      continue
    }
    ctx.warnings.add(
      'IMAGE_NOT_FOUND',
      wpId === undefined
        ? `Image ${src} is not in the export's media library; replaced by a link.`
        : `Image ${src} was not imported; replaced by a link.`,
      src,
    )
    const alt = img.getAttribute('alt')?.trim()
    img.replaceWith(linkParagraph(src, alt || src.split('/').pop() || src))
  }

  // Links: internal links point to the new site.
  for (const a of all('a')) {
    const href = a.getAttribute('href')?.trim() ?? ''
    if (!href || /^javascript:/i.test(href)) {
      unwrap(a)
      continue
    }
    const rewritten = ctx.urls.rewriteHref(href)
    if (rewritten !== undefined) {
      a.setAttribute('href', rewritten)
      continue
    }
    // Links to files in the media library (PDFs, downloads) point to the imported file.
    const fileId = /\/uploads\//.test(href) ? ctx.media.match(href) : undefined
    const fileUrl = fileId === undefined ? undefined : ctx.mediaUrl?.(fileId)
    if (fileUrl) a.setAttribute('href', fileUrl)
  }

  for (const p of all('p')) if (isBlank(p) && !p.querySelector('img')) p.remove()

  return { html: body.innerHTML.trim(), blocks }
}
