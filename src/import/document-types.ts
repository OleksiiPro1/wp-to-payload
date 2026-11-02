import type { Config } from '../config.js'

/** A WordPress post type that the import writes into a Payload collection. */
export interface DocumentType {
  /** WordPress post type, such as `post`, `page` or `recipe`. */
  wpType: string
  /** Import step for `--only` and the report, such as `posts`. */
  phase: string
  /** Payload collection slug. */
  collection: string
  /**
   * Hierarchical types (pages) may reuse a slug under different parents and get their parent
   * set after all documents exist. Slugs of other types are made unique.
   */
  hierarchical: boolean
}

/** The post types an import handles, in the order they are imported. */
export const documentTypes = (config: Config): DocumentType[] => [
  { wpType: 'post', phase: 'posts', collection: config.collections.posts, hierarchical: false },
  { wpType: 'page', phase: 'pages', collection: config.collections.pages, hierarchical: true },
]
