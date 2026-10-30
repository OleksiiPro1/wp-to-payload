import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../../src/config.js'
import { phaseLabel } from '../../src/import/phases.js'
import { EMPTY_SURVEY, resolveSiteTypes } from '../../src/site-types.js'

describe('import steps', () => {
  it('imports posts and pages, pages as a hierarchical type', () => {
    const { postTypes } = resolveSiteTypes(DEFAULT_CONFIG, EMPTY_SURVEY)
    expect(
      postTypes.map(({ wpType, phase, collection, hierarchical }) => ({
        wpType,
        phase,
        collection,
        hierarchical,
      })),
    ).toEqual([
      { wpType: 'post', phase: 'posts', collection: 'posts', hierarchical: false },
      { wpType: 'page', phase: 'pages', collection: 'pages', hierarchical: true },
    ])
  })

  it('labels built-in and other steps', () => {
    expect(phaseLabel('categories')).toBe('Categories')
    expect(phaseLabel('recipes')).toBe('Recipes')
    expect(phaseLabel('recipe-categories')).toBe('Recipe categories')
  })
})
