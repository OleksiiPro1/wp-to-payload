/**
 * The parts of Payload's Local API the import uses, typed structurally so this package does not
 * depend on a specific Payload version. Checked against Payload 3.92 by the integration tests.
 */

export type DocId = string | number

export interface PayloadField {
  name?: string
  type: string
  hasMany?: boolean
  relationTo?: string | string[]
  required?: boolean
  localized?: boolean
  flattenedFields?: PayloadField[]
  fields?: PayloadField[]
  options?: (string | { value: string })[]
  defaultValue?: unknown
}

export interface PayloadCollection {
  config: {
    slug: string
    flattenedFields: PayloadField[]
    upload?: unknown
    auth?: unknown
    versions?: { drafts?: unknown } | boolean
  }
}

export type PayloadDoc = Record<string, unknown> & { id: DocId }

export interface FindResult {
  docs: PayloadDoc[]
  totalDocs: number
  hasNextPage?: boolean
  nextPage?: number | null
}

export interface UploadFile {
  data: Buffer
  mimetype: string
  name: string
  size: number
}

interface WriteArgs {
  collection: string
  data: Record<string, unknown>
  depth?: number
  draft?: boolean
  overrideAccess?: boolean
  context?: Record<string, unknown>
  file?: UploadFile
}

export interface PayloadLike {
  collections: Record<string, PayloadCollection | undefined>
  config: unknown
  find(args: {
    collection: string
    where?: Record<string, unknown>
    limit?: number
    page?: number
    pagination?: boolean
    depth?: number
    draft?: boolean
    select?: Record<string, boolean>
    overrideAccess?: boolean
  }): Promise<FindResult>
  create(args: WriteArgs): Promise<PayloadDoc>
  update(args: WriteArgs & { id: DocId }): Promise<PayloadDoc>
  destroy?: () => Promise<void>
}

export interface LexicalNode {
  type: string
  children?: LexicalNode[]
  text?: string
  [key: string]: unknown
}

export interface LexicalState {
  root: LexicalNode
}

export interface SanitizedEditorConfig {
  features: { enabledFeatures: string[] }
  resolvedFeatureMap: Map<
    string,
    {
      sanitizedServerFeatureProps?: {
        blocks?: (string | { slug: string; fields?: PayloadField[] })[]
      }
    }
  >
}

/** The functions of `@payloadcms/richtext-lexical` the import uses. */
export interface LexicalModule {
  convertHTMLToLexical(args: {
    editorConfig: SanitizedEditorConfig
    html: string
    JSDOM: new (html: string) => { window: { document: unknown } }
  }): LexicalState
  editorConfigFactory: { fromField(args: { field: PayloadField }): SanitizedEditorConfig }
}
