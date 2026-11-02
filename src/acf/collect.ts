import type { WxrItem, WxrTerm } from '../wxr/model.js'
import type { AcfDefinitionItem } from './definitions.js'

/**
 * What an export says about custom fields, collected record by record: the field definitions,
 * and which values items and terms store. ACF writes a reference next to every value: for the
 * value `price`, the meta `_price` holds the field key (`field_…`).
 */
export interface AcfIndex {
  definitions: AcfDefinitionItem[]
  /**
   * Stored values per target (`post:recipe`, `term:category`): meta name → field key → number of
   * items or terms with that value.
   */
  usage: Map<string, Map<string, Map<string, number>>>
  /** Minutes between the local and the UTC dates of published items, with their counts. */
  utcOffsets: Map<number, number>
}

/** Whether a meta value is an ACF field key. */
export const isFieldKey = (value: string | undefined): boolean =>
  value !== undefined && /^field_[A-Za-z0-9_]+$/.test(value)

/** Meta names with an ACF reference: `price` when `_price` holds a field key. */
export const acfReferences = (meta: Map<string, string[]>): [name: string, key: string][] => {
  const found: [string, string][] = []
  for (const [name, values] of meta) {
    if (name.startsWith('_') || !meta.has(`_${name}`)) continue
    const key = meta.get(`_${name}`)?.[0]
    if (isFieldKey(key) && values.length > 0) found.push([name, key as string])
  }
  return found
}

const utcMinutes = (date: string): number | undefined => {
  const time = Date.parse(`${date.replace(' ', 'T')}Z`)
  return Number.isNaN(time) ? undefined : time / 60_000
}

export class AcfCollector {
  private readonly definitions: AcfDefinitionItem[] = []
  private readonly usage = new Map<string, Map<string, Map<string, number>>>()
  private readonly offsets = new Map<number, number>()

  addItem(item: WxrItem): void {
    if (item.type === 'acf-field-group' || item.type === 'acf-field') {
      this.definitions.push({
        id: item.id,
        type: item.type,
        key: item.slug,
        name: item.excerpt,
        label: item.title,
        parentId: item.parentId,
        menuOrder: item.menuOrder,
        status: item.status,
        settings: item.content,
      })
      return
    }
    this.addValues(`post:${item.type}`, item.meta)
    if (item.status === 'publish' && !item.postDateGmt.startsWith('0000')) {
      const local = utcMinutes(item.postDate)
      const utc = utcMinutes(item.postDateGmt)
      if (local !== undefined && utc !== undefined) {
        const offset = Math.round(local - utc)
        this.offsets.set(offset, (this.offsets.get(offset) ?? 0) + 1)
      }
    }
  }

  addTerm(term: WxrTerm): void {
    this.addValues(`term:${term.taxonomy}`, term.meta)
  }

  result(): AcfIndex {
    return { definitions: this.definitions, usage: this.usage, utcOffsets: this.offsets }
  }

  private addValues(target: string, meta: Map<string, string[]>) {
    const references = acfReferences(meta)
    if (references.length === 0) return
    const names = this.usage.get(target) ?? new Map<string, Map<string, number>>()
    this.usage.set(target, names)
    for (const [name, key] of references) {
      const keys = names.get(name) ?? new Map<string, number>()
      names.set(name, keys)
      keys.set(key, (keys.get(key) ?? 0) + 1)
    }
  }
}

export const EMPTY_ACF_INDEX: AcfIndex = {
  definitions: [],
  usage: new Map(),
  utcOffsets: new Map(),
}
