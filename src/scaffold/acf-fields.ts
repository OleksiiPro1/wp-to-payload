import type { AcfCollectionPlan, AcfPayloadBlock, AcfPayloadField } from '../acf/plan.js'

/** TypeScript for the ACF fields of a collection, written into its file by `scaffold`. */

const q = (value: string) =>
  `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n')}'`

/** Line length up to which an object stays on one line. */
const WIDTH = 100

type Prop = [key: string, code: Code]
type Code = string | Code[] | { props: Prop[] }

const flat = (code: Code): string => {
  if (typeof code === 'string') return code
  if (Array.isArray(code)) return `[${code.map(flat).join(', ')}]`
  return `{ ${code.props.map(([k, v]) => `${k}: ${flat(v)}`).join(', ')} }`
}

/** Code at an indent: on one line when it fits, else one entry per line. */
const render = (code: Code, indent: string, prefix = ''): string => {
  const line = flat(code)
  if (typeof code === 'string' || indent.length + prefix.length + line.length <= WIDTH) return line
  const inner = `${indent}  `
  if (Array.isArray(code)) {
    return `[\n${code.map((c) => `${inner}${render(c, inner)},\n`).join('')}${indent}]`
  }
  return `{\n${code.props.map(([k, v]) => `${inner}${k}: ${render(v, inner, `${k}: `)},\n`).join('')}${indent}}`
}

const fieldCode = (field: AcfPayloadField): { props: Prop[] } => {
  const props: Prop[] = [
    ['name', q(field.name)],
    ['type', q(field.type === 'link' ? 'group' : field.type)],
  ]
  const admin: Prop[] = []
  if (field.acf.label && field.acf.label !== field.name) props.push(['label', q(field.acf.label)])
  if (field.type === 'link') {
    props.push([
      'fields',
      [
        {
          props: [
            ['name', q('label')],
            ['type', q('text')],
          ],
        },
        {
          props: [
            ['name', q('url')],
            ['type', q('text')],
          ],
        },
        {
          props: [
            ['name', q('newTab')],
            ['type', q('checkbox')],
          ],
        },
      ],
    ])
  }
  if (field.type === 'upload' || field.type === 'relationship') {
    const to = field.relationTo
    props.push(['relationTo', to.length === 1 ? q(to[0] ?? '') : to.map(q)])
  }
  if (field.hasMany) props.push(['hasMany', 'true'])
  if (field.type === 'select' || field.type === 'radio') {
    props.push([
      'options',
      field.options.map((o) => ({
        props: [
          ['label', q(o.label)],
          ['value', q(o.value)],
        ],
      })),
    ])
  }
  if (field.type === 'richText') props.push(['editor', 'wpEditor'])
  if (field.type === 'date') {
    admin.push([
      'date',
      { props: [['pickerAppearance', q(field.time ? 'dayAndTime' : 'dayOnly')]] },
    ])
  }
  if (field.type === 'group' || field.type === 'array') {
    props.push(['fields', field.fields.map(fieldCode)])
  }
  if (field.type === 'blocks') props.push(['blocks', field.blocks.map(blockCode)])
  if (field.localized) props.push(['localized', 'true'])
  if (field.acf.instructions.trim()) admin.push(['description', q(field.acf.instructions.trim())])
  if (admin.length > 0) props.push(['admin', { props: admin }])
  return { props }
}

const blockCode = (block: AcfPayloadBlock): { props: Prop[] } => {
  const label = block.layout.label || block.layout.name
  return {
    props: [
      ['slug', q(block.slug)],
      [
        'labels',
        {
          props: [
            ['singular', q(label)],
            ['plural', q(label)],
          ],
        },
      ],
      ['fields', block.fields.map(fieldCode)],
    ],
  }
}

/** Whether any field (or sub-field) needs the rich text editor. */
export const needsEditor = (fields: AcfPayloadField[]): boolean =>
  fields.some(
    (f) =>
      f.type === 'richText' || needsEditor(f.fields) || f.blocks.some((b) => needsEditor(b.fields)),
  )

/** The lines for a collection's `fields` array, with a comment per ACF field group. */
export const acfFieldLines = (plan: AcfCollectionPlan | undefined, indent = '    '): string => {
  if (!plan) return ''
  let out = ''
  for (const { group, fields } of plan.groups) {
    if (fields.length === 0) continue
    out += `${indent}// ACF field group "${group.title.replace(/\s+/g, ' ')}" (${group.key})\n`
    for (const field of fields) {
      const code = fieldCode(field)
      out += `${indent}${render(code, indent)},\n`
    }
  }
  return out
}

/** For tests: the code of one field. */
export const acfFieldCode = (field: AcfPayloadField, indent = '    '): string =>
  render(fieldCode(field), indent)
