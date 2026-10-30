import { randomBytes } from 'node:crypto'
import { JSDOM } from 'jsdom'
import type { PlaceholderBlock, PreparedContent } from '../content/types.js'
import type {
  DocId,
  LexicalModule,
  LexicalNode,
  LexicalState,
  SanitizedEditorConfig,
} from './payload-types.js'
import type { EditorInfo } from './schema.js'

/** Common names for languages in WordPress code blocks → Payload CodeBlock languages. */
const LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  console: 'shell',
  py: 'python',
  rb: 'ruby',
  yml: 'yaml',
  md: 'markdown',
  htm: 'html',
  cs: 'csharp',
  'c++': 'cpp',
  ps1: 'powershell',
  text: 'plaintext',
  txt: 'plaintext',
}

const objectId = (): string => randomBytes(12).toString('hex')

const blockNode = (block: PlaceholderBlock, editor: EditorInfo): LexicalNode | undefined => {
  const slug = block.blockType === 'code' ? editor.codeBlockSlug : editor.embedBlockSlug
  if (!slug) return undefined
  const fields: Record<string, string> = { id: objectId(), blockName: '', blockType: slug }
  if (block.blockType === 'code') {
    fields.code = block.fields.code ?? ''
    const wanted = (block.fields.language ?? '').toLowerCase()
    const language = LANGUAGE_ALIASES[wanted] ?? wanted
    if (editor.codeLanguages.includes(language)) fields.language = language
    else if (editor.codeLanguages.includes('plaintext')) fields.language = 'plaintext'
  } else {
    fields.url = block.fields.url ?? ''
    if (block.fields.provider) fields.provider = block.fields.provider
  }
  return { type: 'block', version: 2, format: '', fields }
}

const visit = (node: LexicalNode, fn: (node: LexicalNode) => void): void => {
  fn(node)
  for (const child of node.children ?? []) visit(child, fn)
}

/**
 * Converts prepared HTML with Payload's own converter, then puts in the code and embed blocks
 * and gives upload nodes IDs of the right type (numbers for SQL databases).
 */
export const htmlToLexical = (
  prepared: PreparedContent,
  lexical: LexicalModule,
  editorConfig: SanitizedEditorConfig,
  editor: EditorInfo,
  mediaIdType: 'number' | 'text',
): LexicalState => {
  const state = lexical.convertHTMLToLexical({
    editorConfig,
    html: prepared.html,
    JSDOM: JSDOM as unknown as new (html: string) => { window: { document: unknown } },
  })
  const tokens = new Map(prepared.blocks.map((b) => [b.token, b]))
  const replace = (children: LexicalNode[] | undefined): LexicalNode[] | undefined =>
    children?.map((child) => {
      if (child.type === 'paragraph' && child.children?.length === 1) {
        const only = child.children[0]
        const block = only?.type === 'text' && only.text ? tokens.get(only.text.trim()) : undefined
        const node = block ? blockNode(block, editor) : undefined
        if (node) return node
      }
      return child
    })
  state.root.children = replace(state.root.children) ?? []
  visit(state.root, (node) => {
    if (node.type === 'upload' && typeof node.value === 'string' && mediaIdType === 'number') {
      const id: DocId = Number(node.value)
      if (Number.isFinite(id)) node.value = id
    }
  })
  return state
}

/** True when the converted state holds no content (empty paragraphs only). */
export const isEmptyState = (state: LexicalState): boolean =>
  (state.root.children ?? []).every(
    (node) =>
      node.type === 'paragraph' &&
      (node.children ?? []).every((c) => c.type === 'text' && !c.text?.trim()),
  )
