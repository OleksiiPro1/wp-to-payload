import type { Config } from '../config.js'
import type { SiteTypes, TypeSurvey } from '../site-types.js'
import type { AcfIndex } from './collect.js'
import { AcfDefinitions, type AcfFieldGroup, groupsFromExport } from './definitions.js'
import { type AcfPlan, planAcf } from './plan.js'

/** Fields of the collections that `scaffold` writes, which ACF fields must not reuse. */
const DOCUMENT_FIELDS = ['id', '_status', 'createdAt', 'updatedAt']
const TERM_FIELDS = ['id', 'title', 'slug', 'description', 'parent', 'createdAt', 'updatedAt']

export interface AcfSiteInput {
  acf: AcfIndex
  /** Groups from ACF JSON files (`--acf-json`); they replace groups with the same key. */
  json: AcfFieldGroup[]
  config: Config
  types: SiteTypes
  survey: TypeSurvey
  typeOfPost: (id: number) => string | undefined
  /** Whether collections keep values per locale. */
  localized: boolean
  /** The slug a collection really has, when scaffold adds a prefix. */
  slugOf?: (collection: string) => string
}

/** The ACF plan of an export, as the config and the site's types shape it. */
export const planSiteAcf = (input: AcfSiteInput): AcfPlan => {
  const { config, types, survey } = input
  const slugOf = input.slugOf ?? ((s: string) => s)
  const f = config.fields
  const documentFields = new Set([
    ...Object.values(f),
    ...types.taxonomies.map((t) => t.field),
    ...DOCUMENT_FIELDS,
  ])
  const termFields = new Set([...TERM_FIELDS, f.wpId, f.wpIds])
  return planAcf({
    definitions: new AcfDefinitions(groupsFromExport(input.acf.definitions), input.json),
    index: input.acf,
    postTypes: types.postTypes.map((t) => ({ wpType: t.wpType, collection: slugOf(t.collection) })),
    taxonomies: types.taxonomies.map((t) => ({
      taxonomy: t.taxonomy,
      collection: slugOf(t.collection),
    })),
    mediaCollection: slugOf(config.collections.media),
    reserved: (_collection, kind) => (kind === 'document' ? documentFields : termFields),
    postTypesWithTaxonomy: (taxonomy) =>
      survey.taxonomies.get(taxonomy)?.postTypes ?? (taxonomy === 'category' ? ['post'] : []),
    typeOfPost: input.typeOfPost,
    localized: input.localized,
  })
}
