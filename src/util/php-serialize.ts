/**
 * Reader for data written by PHP's serialize(), which WordPress uses for post meta, term
 * descriptions (Polylang) and plugin settings (ACF). Written from the format's description.
 * Objects are never instantiated; they are returned as plain data.
 */

/** An associative PHP array, in its original order. */
export type PhpMap = Map<string | number, PhpValue>

/** A serialized PHP object, kept as data. */
export class PhpObject {
  constructor(
    readonly className: string,
    readonly properties: PhpMap,
  ) {}
}

/** PHP arrays with keys 0, 1, 2, … become JS arrays; other arrays become ordered maps. */
export type PhpValue = null | boolean | number | string | PhpValue[] | PhpMap | PhpObject

export class PhpSerializeError extends Error {
  override name = 'PhpSerializeError'

  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(`${message} at byte ${offset}`)
  }
}

export interface PhpParseResult {
  value: PhpValue
  /**
   * Strings whose declared byte length did not match and were recovered. Exports often change
   * byte lengths: XML turns `\r\n` into `\n`, and a changed character set changes byte counts.
   */
  repairs: number
}

const QUOTE = 0x22
const SEMICOLON = 0x3b
const COLON = 0x3a
const OPEN = 0x7b
const CLOSE = 0x7d
const NEWLINE = 0x0a
const RETURN = 0x0d

class Parser {
  private pos = 0
  repairs = 0
  /** Values in order of appearance, for `r:` and `R:` references (1-based in PHP). */
  private readonly values: PhpValue[] = []

  constructor(private readonly bytes: Buffer) {}

  parseAll(): PhpValue {
    const value = this.value()
    while (
      this.pos < this.bytes.length &&
      /\s/.test(String.fromCharCode(this.bytes[this.pos] ?? 0))
    ) {
      this.pos++
    }
    if (this.pos !== this.bytes.length)
      throw new PhpSerializeError('unexpected data after the value', this.pos)
    return value
  }

  private fail(message: string): never {
    throw new PhpSerializeError(message, this.pos)
  }

  private expect(byte: number): void {
    if (this.bytes[this.pos] !== byte) this.fail(`expected "${String.fromCharCode(byte)}"`)
    this.pos++
  }

  /** Reads up to (and consumes) the terminator byte. */
  private until(terminator: number): string {
    const end = this.bytes.indexOf(terminator, this.pos)
    if (end === -1) this.fail(`missing "${String.fromCharCode(terminator)}"`)
    const text = this.bytes.toString('latin1', this.pos, end)
    this.pos = end + 1
    return text
  }

  private integer(terminator: number): number {
    const text = this.until(terminator)
    if (!/^[+-]?\d+$/.test(text)) this.fail(`invalid integer "${text}"`)
    return Number(text)
  }

  private register(value: PhpValue): PhpValue {
    this.values.push(value)
    return value
  }

  private value(): PhpValue {
    const type = this.bytes[this.pos]
    if (type === undefined) this.fail('unexpected end of data')
    const kind = String.fromCharCode(type)
    if (!'NbidsaOrR'.includes(kind)) this.fail(`unsupported type "${kind}"`)
    if (kind === 'N') {
      this.pos++
      this.expect(SEMICOLON)
      return this.register(null)
    }
    this.pos++
    this.expect(COLON)
    switch (kind) {
      case 'b': {
        const n = this.integer(SEMICOLON)
        return this.register(n !== 0)
      }
      case 'i':
        return this.register(this.integer(SEMICOLON))
      case 'd': {
        const text = this.until(SEMICOLON)
        const n =
          text === 'INF'
            ? Infinity
            : text === '-INF'
              ? -Infinity
              : text === 'NAN'
                ? NaN
                : Number(text)
        if (Number.isNaN(n) && text !== 'NAN') this.fail(`invalid float "${text}"`)
        return this.register(n)
      }
      case 's':
        return this.register(this.string(SEMICOLON))
      case 'a': {
        const index = this.values.length
        this.values.push(null)
        const value = this.array()
        this.values[index] = value
        return value
      }
      case 'O': {
        const index = this.values.length
        this.values.push(null)
        const className = this.quoted()
        this.expect(COLON)
        const properties = this.entries()
        const value = new PhpObject(className, properties)
        this.values[index] = value
        return value
      }
      case 'r':
      case 'R': {
        const n = this.integer(SEMICOLON)
        const target = this.values[n - 1]
        if (target === undefined) this.fail(`reference to unknown value ${n}`)
        // References are not values of their own in PHP's numbering when they use R.
        if (kind === 'r') this.values.push(target)
        return target
      }
      default:
        return this.fail(`unsupported type "${kind}"`)
    }
  }

  /** `<length>:"<bytes>"` followed by the terminator. */
  private string(terminator: number): string {
    const length = this.integer(COLON)
    this.expect(QUOTE)
    const start = this.pos
    const exact = start + length
    if (
      this.bytes[exact] === QUOTE &&
      this.bytes[exact + 1] === terminator &&
      this.next(exact + 2)
    ) {
      this.pos = exact + 2
      return this.bytes.toString('utf8', start, exact)
    }
    // The declared length is off: find where the string really ends.
    const end = this.lineEndingEnd(start, length, terminator) ?? this.scanEnd(start, terminator)
    if (end === undefined) this.fail(`string of ${length} bytes does not end where declared`)
    this.repairs++
    this.pos = end + 2
    return this.bytes.toString('utf8', start, end)
  }

  /** The end if every `\n` used to be `\r\n` (XML normalizes line endings). */
  private lineEndingEnd(start: number, length: number, terminator: number): number | undefined {
    let counted = 0
    let pos = start
    while (counted < length && pos < this.bytes.length) {
      const byte = this.bytes[pos]
      counted += byte === NEWLINE && this.bytes[pos - 1] !== RETURN ? 2 : 1
      pos++
    }
    if (counted !== length) return undefined
    return this.bytes[pos] === QUOTE && this.bytes[pos + 1] === terminator && this.next(pos + 2)
      ? pos
      : undefined
  }

  /** The first `"` + terminator after which valid serialized data continues. */
  private scanEnd(start: number, terminator: number): number | undefined {
    for (let pos = start; pos < this.bytes.length - 1; pos++) {
      if (this.bytes[pos] === QUOTE && this.bytes[pos + 1] === terminator && this.next(pos + 2))
        return pos
    }
    return undefined
  }

  /** Whether serialized data can continue at `pos`: end, a closing brace, or a new value. */
  private next(pos: number): boolean {
    if (pos >= this.bytes.length) return true
    const byte = this.bytes[pos]
    if (byte === CLOSE) return true
    if (byte === undefined) return true
    const kind = String.fromCharCode(byte)
    if (kind === 'N') return this.bytes[pos + 1] === SEMICOLON
    return 'bidsaOrR'.includes(kind) && this.bytes[pos + 1] === COLON
  }

  private quoted(): string {
    const length = this.integer(COLON)
    this.expect(QUOTE)
    const text = this.bytes.toString('utf8', this.pos, this.pos + length)
    this.pos += length
    this.expect(QUOTE)
    return text
  }

  private entries(): PhpMap {
    const count = this.integer(COLON)
    this.expect(OPEN)
    const map: PhpMap = new Map()
    for (let i = 0; i < count; i++) {
      const keyType = String.fromCharCode(this.bytes[this.pos] ?? 0)
      let key: string | number
      if (keyType === 'i') {
        this.pos++
        this.expect(COLON)
        key = this.integer(SEMICOLON)
      } else if (keyType === 's') {
        this.pos++
        this.expect(COLON)
        key = this.string(SEMICOLON)
      } else {
        this.fail('array keys must be integers or strings')
      }
      map.set(key, this.value())
    }
    this.expect(CLOSE)
    return map
  }

  private array(): PhpValue[] | PhpMap {
    const map = this.entries()
    let i = 0
    for (const key of map.keys()) {
      if (key !== i) return map
      i++
    }
    return [...map.values()]
  }
}

/** Parses serialized PHP data. Throws `PhpSerializeError` for data it cannot read. */
export const parsePhpSerialized = (text: string): PhpParseResult => {
  const parser = new Parser(Buffer.from(text.trim(), 'utf8'))
  const value = parser.parseAll()
  return { value, repairs: parser.repairs }
}

export const unserializePhp = (text: string): PhpValue => parsePhpSerialized(text).value

/** Like WordPress's maybe_unserialize(): the parsed value, or the text when it is not serialized. */
export const maybeUnserializePhp = (text: string): PhpValue => {
  const trimmed = text.trim()
  if (!/^(N;|[bidsaO]:)/.test(trimmed)) return text
  try {
    return unserializePhp(trimmed)
  } catch {
    return text
  }
}

/** Whether the text looks like serialized PHP and can be read. */
export const isPhpSerialized = (text: string): boolean => maybeUnserializePhp(text) !== text

/** A value from a PHP map or list by key, whatever the PHP array turned into. */
export const phpGet = (value: PhpValue | undefined, key: string | number): PhpValue | undefined => {
  if (value instanceof Map) return value.get(key) ?? value.get(String(key))
  if (Array.isArray(value) && typeof key === 'number') return value[key]
  if (value instanceof PhpObject) return value.properties.get(key)
  return undefined
}

/** Entries of a PHP array as [key, value] pairs, for lists and maps alike. */
export const phpEntries = (value: PhpValue | undefined): [string | number, PhpValue][] => {
  if (value instanceof Map) return [...value.entries()]
  if (Array.isArray(value)) return value.map((v, i) => [i, v])
  if (value instanceof PhpObject) return [...value.properties.entries()]
  return []
}

/** Converts parsed data to plain JSON values (maps become objects), e.g. for reports. */
export const phpToJson = (value: PhpValue): unknown => {
  if (value instanceof PhpObject) return phpToJson(value.properties)
  if (value instanceof Map) {
    return Object.fromEntries([...value.entries()].map(([k, v]) => [String(k), phpToJson(v)]))
  }
  if (Array.isArray(value)) return value.map(phpToJson)
  return value
}
