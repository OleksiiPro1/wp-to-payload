import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../../src/config.js'
import { documentTypes } from '../../src/import/document-types.js'
import { phaseLabel } from '../../src/import/phases.js'

describe('import steps', () => {
  it('imports posts and pages, pages as a hierarchical type', () => {
    expect(documentTypes(DEFAULT_CONFIG)).toEqual([
      { wpType: 'post', phase: 'posts', collection: 'posts', hierarchical: false },
      { wpType: 'page', phase: 'pages', collection: 'pages', hierarchical: true },
    ])
  })

  it('labels built-in and other steps', () => {
    expect(phaseLabel('categories')).toBe('Categories')
    expect(phaseLabel('recipes')).toBe('Recipes')
  })
})
