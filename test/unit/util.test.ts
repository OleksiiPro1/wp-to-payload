import { describe, expect, it } from 'vitest'
import { decodeEntities } from '../../src/util/entities.js'
import { slugify } from '../../src/util/slug.js'

describe('slugify', () => {
  it.each([
    ['Hello World', 'hello-world'],
    ['Größe & Übermut', 'groesse-uebermut'],
    ['Crème brûlée!', 'creme-brulee'],
    ['  --  ', ''],
  ])('%s → %s', (input, expected) => expect(slugify(input)).toBe(expected))
})

describe('decodeEntities', () => {
  it('decodes named and numeric references and leaves unknown ones', () => {
    expect(decodeEntities('A &amp; B &#8217; &#x2014; &bogus;')).toBe('A & B ’ — &bogus;')
  })
})
