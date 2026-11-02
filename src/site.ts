import type { Config } from './config.js'
import { indexLanguages, type SiteLanguages, urlLanguages } from './languages.js'
import { SiteUrls } from './paths/site-urls.js'
import {
  resolveSiteTypes,
  type SiteTypes,
  siteUrlsOptions,
  surveyIndex,
  type TypeSurvey,
} from './site-types.js'
import type { SiteIndex } from './wxr/site-index.js'

/** What the commands need to know about an export besides its content. */
export interface Site {
  index: SiteIndex
  /** What the export says about its post types and taxonomies. */
  survey: TypeSurvey
  types: SiteTypes
  /** Undefined for a site in one language. */
  languages: SiteLanguages | undefined
  urls: SiteUrls
}

/** Post types, languages and URLs of an indexed export, as the config shapes them. */
export const describeSite = (index: SiteIndex, config: Config): Site => {
  const survey = surveyIndex(index)
  const types = resolveSiteTypes(config, survey)
  const languages = indexLanguages(index, config)
  const urls = new SiteUrls(
    index,
    siteUrlsOptions(config, types, languages ? urlLanguages(languages, config, index) : undefined),
  )
  return { index, survey, types, languages, urls }
}
