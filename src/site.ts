import type { Config } from './config.js'
import { indexLanguages, type SiteLanguages, urlLanguages } from './languages.js'
import { SiteUrls } from './paths/site-urls.js'
import { resolveSiteTypes, type SiteTypes, siteUrlsOptions, surveyIndex } from './site-types.js'
import type { SiteIndex } from './wxr/site-index.js'

/** What the commands need to know about an export besides its content. */
export interface Site {
  index: SiteIndex
  types: SiteTypes
  /** Undefined for a site in one language. */
  languages: SiteLanguages | undefined
  urls: SiteUrls
}

/** Post types, languages and URLs of an indexed export, as the config shapes them. */
export const describeSite = (index: SiteIndex, config: Config): Site => {
  const types = resolveSiteTypes(config, surveyIndex(index))
  const languages = indexLanguages(index, config)
  const urls = new SiteUrls(
    index,
    siteUrlsOptions(config, types, languages ? urlLanguages(languages, config, index) : undefined),
  )
  return { index, types, languages, urls }
}
