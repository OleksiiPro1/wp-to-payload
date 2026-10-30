import type { SiteUrls } from '../paths/site-urls.js'
import type { WarningCollector } from '../report/warnings.js'
import type { IndexedAttachment } from '../wxr/site-index.js'
import type { Builder } from './builders.js'
import type { MediaMatcher } from './media-match.js'

/** What the target rich text editor can hold. Anything it cannot hold gets a fallback. */
export interface EditorCapabilities {
  /** A block with slug `code` (Payload's premade `CodeBlock`). */
  codeBlock: boolean
  /** A block with slug `embed` and a `url` field (written by `scaffold`). */
  embedBlock: boolean
  /** `EXPERIMENTAL_TableFeature`. */
  table: boolean
  /** `HorizontalRuleFeature` (in Payload's default features). */
  horizontalRule: boolean
  /** `UploadFeature` (in Payload's default features). */
  upload: boolean
}

export const ALL_CAPABILITIES: EditorCapabilities = {
  codeBlock: true,
  embedBlock: true,
  table: true,
  horizontalRule: true,
  upload: true,
}

export interface ContentContext {
  /** WordPress ID of the item being converted. */
  postId: number
  urls: SiteUrls
  media: MediaMatcher
  /** Attachments whose parent is the given item, for `[gallery]` without `ids`. */
  attachmentsOf: (postId: number) => IndexedAttachment[]
  /** Payload ID of an imported attachment; `undefined` when it was not imported. */
  mediaId: (wpId: number) => string | number | undefined
  /** URL of an imported file in Payload, for links to it. */
  mediaUrl?: (wpId: number) => string | undefined
  /** Slug of the upload collection images point to. */
  mediaCollection: string
  capabilities: EditorCapabilities
  /** Page builders the item was made with (from `detectBuilders`). */
  builders: Builder[]
  warnings: WarningCollector
}

/** A Lexical block that replaces a placeholder paragraph after the HTML conversion. */
export interface PlaceholderBlock {
  /** Text of the placeholder paragraph. */
  token: string
  blockType: 'code' | 'embed'
  fields: Record<string, string>
}

export interface PreparedContent {
  /** HTML ready for Payload's HTML → Lexical converter. */
  html: string
  blocks: PlaceholderBlock[]
}
