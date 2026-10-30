/** Codes for everything the import could not move as is. Documented in docs/warnings.md. */
export type WarningCode =
  | 'BLOCK_REMOVED'
  | 'BLOCK_UNKNOWN'
  | 'BLOCK_PARTIAL'
  | 'SHORTCODE_REMOVED'
  | 'BUILDER_MARKUP'
  | 'IMAGE_NOT_FOUND'
  | 'IFRAME_REMOVED'
  | 'EMBED_AS_LINK'
  | 'CODE_AS_TEXT'
  | 'TABLE_FLATTENED'
  | 'ELEMENT_REMOVED'
  | 'SEO_VARIABLE'
  | 'SEO_CANONICAL'
  | 'MEDIA_FAILED'
  | 'MEDIA_SKIPPED'
  | 'REFERENCE_MISSING'
  | 'SLUG_CHANGED'
  | 'PASSWORD_PROTECTED'
  | 'FIELD_MISSING'
  | 'COLLECTION_MISSING'
  | 'TYPE_SKIPPED'
  | 'REDIRECT_CONFLICT'
  | 'XML_ERROR'

export interface Warning {
  code: WarningCode
  message: string
  /** WordPress ID of the item the warning is about. */
  wpId?: number
  /** WordPress type of the item (`post`, `page`, `attachment`, …). */
  wpType?: string
  /** Name of the block, shortcode or element. */
  subject?: string
}

export class WarningCollector {
  readonly warnings: Warning[] = []

  constructor(private readonly context: Pick<Warning, 'wpId' | 'wpType'> = {}) {}

  add(code: WarningCode, message: string, subject?: string): void {
    this.warnings.push({ code, message, ...this.context, ...(subject ? { subject } : {}) })
  }

  /** A collector that adds the given item context to every warning and shares the list. */
  for(context: Pick<Warning, 'wpId' | 'wpType'>): WarningCollector {
    const child = new WarningCollector(context)
    ;(child as { warnings: Warning[] }).warnings = this.warnings
    return child
  }
}

export const summarizeWarnings = (warnings: Warning[]): { code: WarningCode; count: number }[] => {
  const counts = new Map<WarningCode, number>()
  for (const w of warnings) counts.set(w.code, (counts.get(w.code) ?? 0) + 1)
  return [...counts].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count)
}
