import type { WarningCode } from '../report/warnings.js'
import { escapeHtml } from '../util/html.js'
import type { WxrItem } from '../wxr/model.js'
import { metaValue } from '../wxr/model.js'
import { type Builder, detectBuilders } from './builders.js'

/**
 * Elementor keeps a page in the post meta `_elementor_data`: JSON with sections, columns,
 * containers and widgets, each with its settings. This turns the widgets into plain HTML in
 * reading order (left column before right column), which then goes through the same pipeline as
 * other content: images become uploads, links get their new URLs, shortcodes and embeds are
 * handled as everywhere else. Written from the data format, not from Elementor's code.
 */

export interface ElementorWarning {
  code: 'BUILDER_WIDGET_UNKNOWN'
  message: string
  /** The widget type. */
  subject: string
}

export interface ElementorHtml {
  html: string
  /** How often each widget type is used. */
  widgets: Map<string, number>
  /** Widget types without a converter, in order of appearance. */
  unknown: string[]
  warnings: ElementorWarning[]
}

/** Elementor's data, or undefined when it is not valid JSON or not a list of elements. */
export const parseElementorData = (raw: string): unknown[] | undefined => {
  try {
    const value = JSON.parse(raw) as unknown
    return Array.isArray(value) ? value : undefined
  } catch {
    return undefined
  }
}

type Settings = Record<string, unknown>

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (value: unknown): string =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''

/** A setting that holds a link: `{ url, is_external }`. */
const urlOf = (value: unknown): string => (isObject(value) ? text(value.url).trim() : '')

/** A setting that holds a media file: `{ id, url, alt }`. */
const imageOf = (value: unknown): { id?: number; url: string; alt: string } | undefined => {
  if (!isObject(value)) return undefined
  const url = text(value.url).trim()
  const id = Number(value.id)
  if (!url && !(id > 0)) return undefined
  return { ...(id > 0 ? { id } : {}), url, alt: text(value.alt) }
}

const img = (image: { id?: number; url: string; alt: string }): string =>
  `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt)}"${image.id ? ` class="wp-image-${image.id}"` : ''}>`

const figure = (image: { id?: number; url: string; alt: string }, caption = '', href = '') => {
  const inner = href ? `<a href="${escapeHtml(href)}">${img(image)}</a>` : img(image)
  return `<figure>${inner}${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''}</figure>`
}

/** h1–h6 as given; Elementor's other title tags (div, span, p) become paragraphs. */
const headingTag = (value: unknown, fallback: string): string => {
  const tag = text(value) || fallback
  return /^h[1-6]$/.test(tag) ? tag : 'p'
}

const heading = (title: string, tag: string, href = ''): string => {
  if (!title.trim()) return ''
  const inner = href ? `<a href="${escapeHtml(href)}">${title}</a>` : title
  return `<${tag}>${inner}</${tag}>`
}

const paragraph = (html: string): string => (html.trim() ? `<p>${html}</p>` : '')

const button = (label: string, href: string): string =>
  label.trim() ? paragraph(href ? `<a href="${escapeHtml(href)}">${label}</a>` : label) : ''

/** Accordion, toggle and tabs: a heading and the content of each item. */
const items = (settings: Settings): string =>
  (Array.isArray(settings.tabs) ? settings.tabs : [])
    .filter(isObject)
    .map((tab) => `<h3>${text(tab.tab_title)}</h3>\n\n${text(tab.tab_content)}`)
    .join('\n\n')

const VIDEO_URLS: Record<string, string> = {
  youtube: 'youtube_url',
  vimeo: 'vimeo_url',
  dailymotion: 'dailymotion_url',
  videopress: 'videopress_url',
}

/** Widgets that only add space or decoration; they are left out without a warning. */
const SILENT = new Set(['spacer', 'menu-anchor', 'icon', 'social-icons', 'sidebar', 'read-more'])

/** HTML for one widget, or undefined when there is no converter for its type. */
const widgetHtml = (type: string, s: Settings): string | undefined => {
  switch (type) {
    case 'heading':
      return heading(text(s.title), headingTag(s.header_size, 'h2'), urlOf(s.link))
    case 'text-editor':
      return text(s.editor)
    case 'image': {
      const image = imageOf(s.image)
      if (!image) return ''
      const caption = s.caption_source === 'custom' ? text(s.caption) : ''
      const href = s.link_to === 'custom' ? urlOf(s.link) : s.link_to === 'file' ? image.url : ''
      return figure(image, caption, href)
    }
    case 'button':
      return button(text(s.text), urlOf(s.link))
    case 'image-gallery':
      return `<figure class="wp2p-gallery">${(Array.isArray(s.wp_gallery) ? s.wp_gallery : [])
        .map(imageOf)
        .filter((i) => i !== undefined)
        .map(img)
        .join('')}</figure>`
    case 'video': {
      const kind = text(s.video_type) || 'youtube'
      if (kind === 'hosted') {
        const url = s.insert_url === 'yes' ? text(s.external_url) : urlOf(s.hosted_url)
        return url ? `[video src="${url}"]` : ''
      }
      const url = text(s[VIDEO_URLS[kind] ?? 'youtube_url']).trim()
      return url ? `\n\n[embed]${url}[/embed]\n\n` : ''
    }
    case 'icon-list':
      return `<ul>${(Array.isArray(s.icon_list) ? s.icon_list : [])
        .filter(isObject)
        .map((item) => {
          const label = text(item.text)
          const href = urlOf(item.link)
          return `<li>${href ? `<a href="${escapeHtml(href)}">${label}</a>` : label}</li>`
        })
        .join('')}</ul>`
    case 'image-box':
    case 'icon-box': {
      const href = urlOf(s.link)
      const image = type === 'image-box' ? imageOf(s.image) : undefined
      return [
        image ? figure(image) : '',
        heading(text(s.title_text), headingTag(s.title_size, 'h3'), href),
        paragraph(text(s.description_text)),
      ].join('\n\n')
    }
    case 'testimonial': {
      const image = imageOf(s.testimonial_image)
      const who = [text(s.testimonial_name), text(s.testimonial_job)].filter(Boolean).join(', ')
      return [
        image ? figure(image) : '',
        `<blockquote>${paragraph(text(s.testimonial_content))}${who ? `<cite>${who}</cite>` : ''}</blockquote>`,
      ].join('\n\n')
    }
    case 'accordion':
    case 'toggle':
    case 'tabs':
      return items(s)
    case 'divider':
      return '<hr>'
    case 'html':
      return text(s.html)
    case 'shortcode':
      return `\n\n${text(s.shortcode)}\n\n`
    case 'alert':
      return [
        paragraph(text(s.alert_title) ? `<strong>${text(s.alert_title)}</strong>` : ''),
        paragraph(text(s.alert_description)),
      ].join('\n\n')
    // Widgets of Elementor Pro.
    case 'call-to-action': {
      const image = imageOf(s.bg_image)
      return [
        image ? figure(image) : '',
        heading(text(s.title), headingTag(s.title_tag, 'h2')),
        paragraph(text(s.description)),
        button(text(s.button), urlOf(s.link)),
      ].join('\n\n')
    }
    case 'slides':
      return (Array.isArray(s.slides) ? s.slides : [])
        .filter(isObject)
        .map((slide) => {
          const image = imageOf(slide.background_image)
          return [
            image ? figure(image) : '',
            heading(text(slide.heading), 'h2'),
            paragraph(text(slide.description)),
            button(text(slide.button_text), urlOf(slide.link)),
          ].join('\n\n')
        })
        .join('\n\n')
    case 'blockquote': {
      const author = text(s.author_name)
      return `<blockquote>${paragraph(text(s.blockquote_content))}${author ? `<cite>${author}</cite>` : ''}</blockquote>`
    }
    case 'animated-headline': {
      const changing =
        s.headline_style === 'highlight'
          ? text(s.highlighted_text)
          : text(s.rotating_text)
              .split('\n')
              .map((w) => w.trim())
              .filter(Boolean)
              .join(' / ')
      const title = [text(s.before_text), changing, text(s.after_text)]
        .map((t) => t.trim())
        .filter(Boolean)
        .join(' ')
      return heading(escapeHtml(title), headingTag(s.tag, 'h3'), urlOf(s.link))
    }
    case 'flip-box':
      return [
        heading(text(s.title_text_a), 'h3'),
        paragraph(text(s.description_text_a)),
        heading(text(s.title_text_b), 'h3'),
        paragraph(text(s.description_text_b)),
        button(text(s.button_text), urlOf(s.link)),
      ].join('\n\n')
  }
  if (type.startsWith('e-')) return atomicHtml(type, s)
  return SILENT.has(type) ? '' : undefined
}

/**
 * The value of a setting of Elementor 4's elements, which are typed: `{ "$$type": "string",
 * "value": "…" }`. Rich text (`html-v3`) holds its HTML in `content`.
 */
const typed = (setting: unknown): unknown => {
  if (!isObject(setting) || typeof setting.$$type !== 'string') return setting
  const value = setting.value
  if (setting.$$type === 'html-v3' && isObject(value)) return typed(value.content)
  return value
}

const typedText = (setting: unknown): string => text(typed(setting))

/**
 * The address of a link of Elementor 4: a URL, or a post by ID (`/?p=ID`, which the pipeline
 * turns into the post's new URL).
 */
const atomicLink = (setting: unknown): string => {
  const value = typed(setting)
  const destination = isObject(value) ? value.destination : undefined
  if (isObject(destination) && destination.$$type === 'query') {
    const id = Number(typed(isObject(destination.value) ? destination.value.id : undefined))
    return id > 0 ? `/?p=${id}` : ''
  }
  return typedText(destination).trim()
}

/** HTML for an element of Elementor 4's editor, or undefined when there is no converter. */
const atomicHtml = (type: string, s: Settings): string | undefined => {
  const href = atomicLink(s.link)
  switch (type) {
    case 'e-heading':
      return heading(typedText(s.title), headingTag(typed(s.tag), 'h2'), href)
    case 'e-paragraph': {
      const html = typedText(s.paragraph)
      return paragraph(href ? `<a href="${escapeHtml(href)}">${html}</a>` : html)
    }
    case 'e-button':
      return button(typedText(s.text), href)
    case 'e-image': {
      const image = typed(s.image)
      const src = isObject(image) ? typed(image.src) : undefined
      if (!isObject(src)) return ''
      const id = Number(typed(src.id))
      const url = typedText(src.url)
      if (!url && !(id > 0)) return ''
      return figure({ ...(id > 0 ? { id } : {}), url, alt: '' }, '', href)
    }
    case 'e-divider':
      return '<hr>'
    case 'e-youtube': {
      const url = typedText(s.source).trim()
      return url ? `\n\n[embed]${url}[/embed]\n\n` : ''
    }
    case 'e-self-hosted-video': {
      // A URL, or a file of the media library by ID, which the `[video]` handler looks up.
      const source = typed(s.source)
      const url = (isObject(source) ? typedText(source.url) : typedText(source)).trim()
      const id = isObject(source) ? Number(typed(source.id)) : 0
      return url ? `[video src="${url}"]` : id > 0 ? `[video id="${id}"]` : ''
    }
    case 'e-svg':
      return ''
  }
  return undefined
}

/** Elements that hold other elements: sections, columns, containers (also Elementor 4's). */
const CONTAINER_TYPES = new Set(['section', 'column', 'container', 'e-div-block', 'e-flexbox'])

/**
 * Elements of Elementor 4 that hold other elements but are left out as a whole: a form's
 * elements are its fields, labels and the messages shown after sending, not content.
 */
const WHOLE_ELEMENTS = new Set(['e-form'])

const childrenOf = (element: unknown): unknown[] =>
  isObject(element) && Array.isArray(element.elements) ? element.elements : []

const elementsOf = (list: unknown[], elType: string): Record<string, unknown>[] =>
  list.filter((e): e is Record<string, unknown> => isObject(e) && e.elType === elType)

/** HTML for Elementor's elements, in reading order. */
export const elementorToHtml = (elements: unknown[]): ElementorHtml => {
  const parts: string[] = []
  const widgets = new Map<string, number>()
  const unknown: string[] = []
  const warnings: ElementorWarning[] = []
  /**
   * Elementor 4's tabs keep the tab titles in a menu and the contents in a separate area; like
   * the tabs widget, each title becomes a heading followed by its content.
   */
  const walkTabs = (children: unknown[]) => {
    const titles = elementsOf(children, 'e-tabs-menu').flatMap((menu) =>
      elementsOf(childrenOf(menu), 'e-tab'),
    )
    const contents = elementsOf(children, 'e-tabs-content-area').flatMap((area) =>
      elementsOf(childrenOf(area), 'e-tab-content'),
    )
    for (let i = 0; i < Math.max(titles.length, contents.length); i++) {
      const start = parts.length
      walk(childrenOf(titles[i]))
      const title = parts
        .splice(start)
        .map((html) => html.replace(/^<p>([\s\S]*)<\/p>$/, '$1'))
        .join(' ')
      if (title.trim()) parts.push(heading(title, 'h3'))
      walk(childrenOf(contents[i]))
    }
  }
  const walk = (list: unknown[]) => {
    for (const element of list) {
      if (!isObject(element)) continue
      const children = childrenOf(element)
      const elType = text(element.elType)
      if (elType === 'e-tabs') {
        walkTabs(children)
        continue
      }
      if (
        elType !== 'widget' &&
        !WHOLE_ELEMENTS.has(elType) &&
        (CONTAINER_TYPES.has(elType) || children.length > 0)
      ) {
        walk(children)
        continue
      }
      const type = elType === 'widget' ? text(element.widgetType) : elType
      widgets.set(type, (widgets.get(type) ?? 0) + 1)
      const settings = isObject(element.settings) ? element.settings : {}
      const html = widgetHtml(type, settings)
      if (html === undefined) {
        if (!unknown.includes(type)) {
          unknown.push(type)
          warnings.push({
            code: 'BUILDER_WIDGET_UNKNOWN',
            message:
              type === 'global'
                ? 'An Elementor global widget was left out: its content is stored in the template it refers to.'
                : `Elementor widget "${type}" has no converter; it was left out.`,
            subject: type,
          })
        }
        continue
      }
      if (html.trim()) parts.push(html)
    }
  }
  walk(elements)
  return { html: parts.join('\n\n'), widgets, unknown, warnings }
}

/** What the import converts for an item: Elementor's widgets, or the post content. */
export interface ContentSource {
  content: string
  /** Page builders whose markup is still in `content`. */
  builders: Builder[]
  warnings: { code: WarningCode; message: string; subject: string }[]
  /** Elementor's data was used. */
  elementor?: ElementorHtml
}

/**
 * The content of an item as the import converts it. A page built with Elementor (`_elementor_edit_mode`
 * is `builder`) is converted from Elementor's data; when that data is broken, from the HTML
 * Elementor stored in the post content, with a warning.
 */
export const contentSource = (item: Pick<WxrItem, 'content' | 'meta'>): ContentSource => {
  const builders = detectBuilders(item)
  const data = metaValue(item, '_elementor_data')
  if (metaValue(item, '_elementor_edit_mode') !== 'builder' || data === undefined) {
    return { content: item.content, builders, warnings: [] }
  }
  const elements = parseElementorData(data)
  if (!elements) {
    return {
      content: item.content,
      builders,
      warnings: [
        {
          code: 'BUILDER_DATA_INVALID',
          message:
            "Elementor's data of this item is not valid JSON; the HTML Elementor stored in the post content was imported instead.",
          subject: 'elementor',
        },
      ],
    }
  }
  const elementor = elementorToHtml(elements)
  return {
    content: elementor.html,
    builders: builders.filter((b) => b !== 'elementor'),
    warnings: [
      {
        code: 'BUILDER_MARKUP',
        message:
          'Elementor layout (sections, columns, styles) is not migrated; the widgets were converted in reading order.',
        subject: 'elementor',
      },
      ...elementor.warnings,
    ],
    elementor,
  }
}
