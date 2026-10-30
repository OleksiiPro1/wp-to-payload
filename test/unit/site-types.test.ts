import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, parseConfig } from '../../src/config.js'
import {
  camelCase,
  defaultCollectionSlug,
  resolveSiteTypes,
  surveyIndex,
  type TypeSurvey,
} from '../../src/site-types.js'
import { buildSiteIndex } from '../../src/wxr/site-index.js'
import { fixture } from '../helpers.js'

const core = fileURLToPath(new URL('../fixtures/wxr/wordpress/core.xml', import.meta.url))

describe('collection names', () => {
  it('turns WordPress names into plural kebab-case slugs', () => {
    const slugs = ['recipe', 'recipe_category', 'news', 'box', 'faq', 'day', 'city', 'cpt_2024']
    expect(slugs.map(defaultCollectionSlug)).toEqual([
      'recipes',
      'recipe-categories',
      'news',
      'boxes',
      'faqs',
      'days',
      'cities',
      'cpt-2024',
    ])
    expect(camelCase('recipe-categories')).toBe('recipeCategories')
  })
})

describe('site types of the core export', () => {
  let survey: TypeSurvey
  beforeAll(async () => {
    survey = surveyIndex(await buildSiteIndex(core))
  })

  it('reads hierarchy and taxonomies from the data', () => {
    expect(survey.postTypes.get('guide')).toEqual({
      name: 'guide',
      items: 2,
      byStatus: { publish: 2 },
      hasParents: true,
      taxonomies: [],
    })
    expect(survey.postTypes.get('recipe')).toMatchObject({
      items: 2,
      hasParents: false,
      taxonomies: ['recipe_category'],
    })
    expect(survey.postTypes.get('post')?.taxonomies).toEqual(['category', 'post_tag'])
    expect(survey.taxonomies.get('recipe_category')).toEqual({
      name: 'recipe_category',
      terms: 3,
      hasParents: true,
      postTypes: ['recipe'],
    })
  })

  it('imports custom types into collections of their own, with default URLs', () => {
    const types = resolveSiteTypes(DEFAULT_CONFIG, survey)
    expect(types.postTypes.map((t) => [t.wpType, t.collection, t.phase, t.hierarchical])).toEqual([
      ['post', 'posts', 'posts', false],
      ['page', 'pages', 'pages', true],
      ['guide', 'guides', 'guides', true],
      ['recipe', 'recipes', 'recipes', false],
    ])
    expect(types.postTypes.find((t) => t.wpType === 'recipe')?.taxonomies).toEqual([
      'recipe_category',
    ])
    expect(types.taxonomies.find((t) => t.taxonomy === 'recipe_category')).toEqual({
      taxonomy: 'recipe_category',
      phase: 'recipe-categories',
      collection: 'recipe-categories',
      hierarchical: true,
      builtin: false,
      field: 'recipeCategories',
      base: 'recipe_category',
    })
    expect(types.patterns).toEqual({
      post: '/posts/:slug',
      page: '/:slug',
      guide: '/guides/:path',
      recipe: '/recipes/:slug',
    })
    expect(types.archives).toEqual([])
    expect(types.skipped).toEqual([
      { kind: 'taxonomy', name: 'nav_menu', count: 2, reason: 'menus, not imported yet' },
    ])
  })

  it('follows the config', () => {
    const config = parseConfig({
      postTypes: { recipe: { collection: 'rezepte', path: '/rezepte/:slug' } },
      taxonomies: {
        recipe_category: {
          base: '/rezeptkategorie/',
          path: '/rezepte/kategorie/:path',
          field: 'kategorien',
        },
      },
    })
    const types = resolveSiteTypes(config, survey)
    expect(types.postTypes.find((t) => t.wpType === 'recipe')?.collection).toBe('rezepte')
    expect(types.patterns.recipe).toBe('/rezepte/:slug')
    expect(types.taxonomies.find((t) => t.taxonomy === 'recipe_category')?.field).toBe('kategorien')
    expect(types.archives).toEqual([
      {
        taxonomy: 'recipe_category',
        base: 'rezeptkategorie',
        pattern: '/rezepte/kategorie/:path',
      },
    ])
  })
})

describe('plugin data', () => {
  it('skips plugin post types and taxonomies unless the config names them', async () => {
    const survey = surveyIndex(await buildSiteIndex(fixture('plugins.xml')))
    const skipped = resolveSiteTypes(DEFAULT_CONFIG, survey).skipped
    expect(skipped.map((s) => `${s.kind}:${s.name}`)).toEqual([
      'post type:acf-field',
      'post type:acf-field-group',
      'post type:product',
      'post type:shop_order',
      'taxonomy:language',
      'taxonomy:post_translations',
      'taxonomy:product_cat',
      'taxonomy:product_type',
    ])
    expect(skipped.find((s) => s.name === 'shop_order')?.reason).toBe(
      'WooCommerce orders (personal data)',
    )
    const withProducts = resolveSiteTypes(
      parseConfig({ postTypes: { product: {} }, taxonomies: { product_cat: {} } }),
      survey,
    )
    expect(withProducts.postTypes.map((t) => t.collection)).toContain('products')
    expect(withProducts.taxonomies.map((t) => t.collection)).toContain('product-cats')
  })

  it('never reuses the collection or step of another type', () => {
    const survey: TypeSurvey = {
      postTypes: new Map(
        ['media', 'author', 'authors'].map((name) => [
          name,
          { name, items: 1, byStatus: { publish: 1 }, hasParents: false, taxonomies: [] },
        ]),
      ),
      taxonomies: new Map([
        ['tags', { name: 'tags', terms: 1, hasParents: false, postTypes: ['media'] }],
      ]),
    }
    const types = resolveSiteTypes(DEFAULT_CONFIG, survey)
    expect(types.postTypes.slice(2).map((t) => [t.wpType, t.collection, t.phase])).toEqual([
      ['author', 'wp-authors', 'wp-authors'],
      ['authors', 'wp-authors-2', 'wp-authors-2'],
      ['media', 'wp-media', 'wp-media'],
    ])
    // The field for the custom taxonomy "tags" may not be the built-in tags field.
    expect(types.taxonomies[2]).toMatchObject({ collection: 'wp-tags', field: 'wpTags' })
  })
})
