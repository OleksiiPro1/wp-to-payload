import { prepareDom } from './dom.js'
import { renderContent } from './render.js'
import type { ContentContext, PreparedContent } from './types.js'

/** WordPress content → HTML for Payload's converter, plus blocks to put in after conversion. */
export const prepareContent = (content: string, ctx: ContentContext): PreparedContent =>
  prepareDom(renderContent(content, ctx), ctx)
