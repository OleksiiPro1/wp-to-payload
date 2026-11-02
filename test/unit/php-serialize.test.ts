import { describe, expect, it } from 'vitest'
import {
  isPhpSerialized,
  maybeUnserializePhp,
  parsePhpSerialized,
  phpEntries,
  phpGet,
  PhpObject,
  PhpSerializeError,
  phpToJson,
  unserializePhp,
} from '../../src/util/php-serialize.js'

/** What PHP's serialize() writes for a string: the length is in bytes. */
const s = (text: string) => `s:${Buffer.byteLength(text)}:"${text}";`

describe('unserializePhp', () => {
  it('reads scalars', () => {
    expect(unserializePhp('N;')).toBeNull()
    expect(unserializePhp('b:1;')).toBe(true)
    expect(unserializePhp('b:0;')).toBe(false)
    expect(unserializePhp('i:-42;')).toBe(-42)
    expect(unserializePhp('d:1.5;')).toBe(1.5)
    expect(unserializePhp('d:1.0E+25;')).toBe(1e25)
    expect(unserializePhp('d:-INF;')).toBe(-Infinity)
    expect(unserializePhp(s('Größe & Übermut'))).toBe('Größe & Übermut')
    expect(unserializePhp(s('a "quoted"; text'))).toBe('a "quoted"; text')
  })

  it('turns lists into arrays and other arrays into ordered maps', () => {
    expect(unserializePhp('a:2:{i:0;s:3:"101";i:1;s:3:"102";}')).toEqual(['101', '102'])
    const map = unserializePhp('a:3:{i:5;s:1:"x";s:2:"de";i:10;i:1;b:1;}')
    expect(map).toBeInstanceOf(Map)
    expect([...(map as Map<string | number, unknown>).keys()]).toEqual([5, 'de', 1])
    expect(unserializePhp('a:0:{}')).toEqual([])
  })

  it('reads Polylang translation maps and language settings', () => {
    const translations = unserializePhp('a:2:{s:2:"de";i:10;s:2:"en";i:11;}')
    expect(phpToJson(translations)).toEqual({ de: 10, en: 11 })
    const language = unserializePhp(
      `a:3:{${s('locale')}${s('de_DE')}${s('rtl')}i:0;${s('flag_code')}${s('at')}}`,
    )
    expect(phpGet(language, 'locale')).toBe('de_DE')
    expect(phpGet(language, 'rtl')).toBe(0)
  })

  it('reads nested arrays such as attachment metadata', () => {
    const meta = unserializePhp(
      `a:3:{${s('width')}i:1200;${s('file')}${s('2024/01/hero.png')}${s('sizes')}a:1:{${s('thumbnail')}a:2:{${s('file')}${s('hero-150x150.png')}${s('width')}i:150;}}}`,
    )
    expect(phpToJson(meta)).toEqual({
      width: 1200,
      file: '2024/01/hero.png',
      sizes: { thumbnail: { file: 'hero-150x150.png', width: 150 } },
    })
    expect(phpEntries(phpGet(meta, 'sizes')).map(([k]) => k)).toEqual(['thumbnail'])
  })

  it('keeps objects as data and resolves references', () => {
    const object = unserializePhp('O:8:"stdClass":2:{s:3:"foo";s:3:"bar";s:1:"n";i:1;}')
    expect(object).toBeInstanceOf(PhpObject)
    expect((object as PhpObject).className).toBe('stdClass')
    expect(phpGet(object, 'foo')).toBe('bar')
    expect(unserializePhp('a:2:{i:0;s:1:"x";i:1;R:2;}')).toEqual(['x', 'x'])
  })

  it('repairs strings whose byte length changed in the export', () => {
    // Written with "\r\n" (5 bytes); XML turns that into "\n".
    const crlf = parsePhpSerialized('a:1:{i:0;s:5:"a\nbc";}')
    expect(crlf).toEqual({ value: ['a\nbc'], repairs: 1 })
    // Written in Latin-1, where "ü" is one byte, now UTF-8 with two.
    const charset = parsePhpSerialized('a:2:{i:0;s:3:"für";i:1;s:2:"ok";}')
    expect(charset).toEqual({ value: ['für', 'ok'], repairs: 1 })
  })

  it('reports data it cannot read with the byte offset', () => {
    expect(() => unserializePhp('a:2:{i:0;s:1:"x";')).toThrow(PhpSerializeError)
    expect(() => unserializePhp('x:1;')).toThrow(/unsupported type "x" at byte 0/)
    expect(() => unserializePhp('i:1;garbage')).toThrow(/unexpected data/)
  })
})

describe('maybeUnserializePhp', () => {
  it('returns plain text unchanged', () => {
    expect(maybeUnserializePhp('just text')).toBe('just text')
    expect(maybeUnserializePhp('a:broken')).toBe('a:broken')
    expect(maybeUnserializePhp(' a:1:{i:0;i:7;} ')).toEqual([7])
    expect(isPhpSerialized('b:1;')).toBe(true)
    expect(isPhpSerialized('field_65f0a1b2c3d4f')).toBe(false)
  })
})
