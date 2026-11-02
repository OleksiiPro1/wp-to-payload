/**
 * Programmatic API. The CLI (`wp-to-payload`) covers the common cases; these functions are for
 * scripts that need more control, for example a custom `payload run` script.
 */
export { VERSION } from './version.js'

export { readWxr, type ReadWxrOptions } from './wxr/reader.js'
export type {
  WxrAuthor,
  WxrItem,
  WxrItemTerm,
  WxrParseIssue,
  WxrRecord,
  WxrSite,
  WxrTerm,
} from './wxr/model.js'
export {
  buildSiteIndex,
  type IndexedAttachment,
  type IndexedPost,
  type SiteIndex,
} from './wxr/site-index.js'

export { analyzeExport } from './analyze/analyze.js'
export { renderMarkdown } from './analyze/markdown.js'
export type { AnalyzeReport, Complexity } from './analyze/report.js'

export { DEFAULT_PATTERNS, type PathPatterns } from './paths/patterns.js'
export { SiteUrls, type SiteUrlsOptions, type TermArchive } from './paths/site-urls.js'
export {
  type PostTypeTarget,
  resolveSiteTypes,
  type SiteTypes,
  siteUrlsOptions,
  type SkippedType,
  surveyIndex,
  type TaxonomyTarget,
  type TypeSurvey,
} from './site-types.js'
export { buildRedirects, type Redirect, type RedirectMap } from './redirects/build.js'
export { FORMATS, formatRedirects, type RedirectFormat } from './redirects/formats.js'

export {
  type Config,
  DEFAULT_CONFIG,
  loadConfig,
  parseConfig,
  type PostTypeSettings,
  type TaxonomySettings,
} from './config.js'
export type { Warning, WarningCode } from './report/warnings.js'

export {
  type ImportOptions,
  type ImportResult,
  importExport,
  type PhaseResult,
} from './import/importer.js'
export { type Phase, PHASES } from './import/phases.js'
