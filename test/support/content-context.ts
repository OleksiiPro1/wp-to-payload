import { MediaMatcher } from '../../src/content/media-match.js'
import {
  ALL_CAPABILITIES,
  type ContentContext,
  type EditorCapabilities,
} from '../../src/content/types.js'
import { SiteUrls } from '../../src/paths/site-urls.js'
import { WarningCollector } from '../../src/report/warnings.js'
import type { SiteIndex } from '../../src/wxr/site-index.js'

/** A content context where every attachment is "imported" as media ID `m<wpId>`. */
export const contentContext = (
  index: SiteIndex,
  overrides: Partial<Omit<ContentContext, 'capabilities'>> & {
    capabilities?: Partial<EditorCapabilities>
  } = {},
): ContentContext => {
  const { capabilities, ...rest } = overrides
  return {
    postId: 0,
    urls: new SiteUrls(index, { patterns: { post: '/blog/:slug', page: '/:path' } }),
    media: new MediaMatcher(index.attachments),
    attachmentsOf: (id) => [...index.attachments.values()].filter((a) => a.parentId === id),
    mediaId: (wpId) => (index.attachments.has(wpId) ? `m${wpId}` : undefined),
    mediaCollection: 'media',
    capabilities: { ...ALL_CAPABILITIES, ...capabilities },
    builders: [],
    warnings: new WarningCollector(),
    ...rest,
  }
}
