import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { EMPTY_ACF_INDEX } from '../../src/acf/collect.js'
import {
  AcfDefinitions,
  type AcfField,
  type AcfFieldGroup,
  AcfJsonError,
  groupsFromJson,
  loadAcfJson,
} from '../../src/acf/definitions.js'
import { type AcfPlan, type AcfPlanInput, planAcf, planBlocks } from '../../src/acf/plan.js'
import { planSiteAcf } from '../../src/acf/site.js'
import { commonOffset, localToIso } from '../../src/acf/time.js'
import { type AcfValueContext, acfValues } from '../../src/acf/values.js'
import { analyzeExport } from '../../src/analyze/analyze.js'
import { renderMarkdown } from '../../src/analyze/markdown.js'
import { DEFAULT_CONFIG, parseConfig } from '../../src/config.js'
import { acfFieldLines } from '../../src/scaffold/acf-fields.js'
import { scaffoldFiles } from '../../src/scaffold/templates.js'
import { describeSite } from '../../src/site.js'
import { readWxr } from '../../src/wxr/reader.js'
import { buildSiteIndex, type SiteIndex } from '../../src/wxr/site-index.js'

const exportFile = fileURLToPath(
  new URL('../fixtures/wxr/wordpress/custom-fields.xml', import.meta.url),
)
const cliExportFile = fileURLToPath(
  new URL('../fixtures/wxr/wordpress/custom-fields.wp-cli.xml', import.meta.url),
)
const acfJsonDir = fileURLToPath(new URL('../../scripts/fixtures/acf-json', import.meta.url))

const planOf = (index: SiteIndex, json: AcfFieldGroup[] = []): AcfPlan => {
  const site = describeSite(index, DEFAULT_CONFIG)
  return planSiteAcf({
    acf: index.acf,
    json,
    config: DEFAULT_CONFIG,
    types: site.types,
    survey: site.survey,
    typeOfPost: (id) => index.posts.get(id)?.type,
    localized: false,
  })
}

const metaOf = async (file: string, id: number): Promise<Map<string, string[]>> => {
  for await (const record of readWxr(file)) {
    if (record.kind === 'item' && record.item.id === id) return record.item.meta
  }
  throw new Error(`no item ${id}`)
}

const context = (
  meta: Map<string, string[]>,
  over: Partial<AcfValueContext> = {},
): AcfValueContext & { warnings: string[] } => {
  const warnings: string[] = []
  return {
    meta,
    media: (id) => 1000 + id,
    mediaByUrl: () => undefined,
    post: (id) => ({
      collection: id === 5 ? 'pages' : id === 6 ? 'posts' : 'recipes',
      id: 2000 + id,
    }),
    term: (_taxonomy, id) => ({ collection: 'categories', id: 3000 + id }),
    findPost: () => undefined,
    rewriteUrl: (url) => url.replace('https://custom-fields.example.com', ''),
    richText: (html) => ({ html }),
    dateTime: (value) => localToIso(value, { timeZone: 'Europe/Vienna', offsetMinutes: 0 }),
    final: false,
    warn: (code, message) => warnings.push(`${code}: ${message}`),
    warnings,
    ...over,
  }
}

describe('ACF definitions', () => {
  let index: SiteIndex
  beforeAll(async () => {
    index = await buildSiteIndex(exportFile)
  })

  it('reads field groups and fields from the export', () => {
    const plan = planOf(index)
    const groups = plan.definitions.groups
    // In ACF's order: menu order, then title.
    expect(groups.map((g) => [g.key, g.title, g.source])).toEqual([
      ['group_post', 'Beitragsdaten', 'export'],
      ['group_category', 'Kategoriedaten', 'export'],
      ['group_recipe', 'Rezeptdaten', 'export'],
    ])
    const recipe = groups.find((g) => g.key === 'group_recipe') as AcfFieldGroup
    expect(recipe.location).toEqual([[{ param: 'post_type', operator: '==', value: 'recipe' }]])
    expect(recipe.fields.map((f) => f.name || `(${f.type})`).slice(0, 4)).toEqual([
      'subtitle',
      '(tab)',
      'notes',
      'baking_time',
    ])
    const field = (key: string) => plan.definitions.fields.get(key) as AcfField
    expect(field('field_difficulty').choices).toEqual([
      { value: 'easy', label: 'Leicht' },
      { value: 'medium', label: 'Mittel' },
      { value: 'hard', label: 'Schwer' },
    ])
    expect(field('field_nutrition').subFields.map((f) => f.name)).toEqual(['calories', 'allergens'])
    expect(field('field_ingredients').subFields.map((f) => f.name)).toEqual([
      'amount',
      'ingredient',
    ])
    expect(
      field('field_sections').layouts.map((l) => [l.name, l.subFields.map((f) => f.name)]),
    ).toEqual([
      ['text_block', ['text']],
      ['quote', ['quote', 'author']],
    ])
    expect(plan.definitions.fieldCount).toBe(41)
  })

  it('reads groups from ACF JSON files and folders', async () => {
    const groups = await loadAcfJson([acfJsonDir])
    expect(groups.map((g) => [g.key, g.source, g.fields.map((f) => f.name)])).toEqual([
      ['group_local_origin', 'json', ['origin', 'region']],
    ])
    // ACF's export tool writes a list; post types and options pages in it are ignored.
    expect(
      groupsFromJson([
        { key: 'post_type_1', title: 'Recipes' },
        {
          key: 'group_x',
          title: 'X',
          fields: [
            {
              key: 'field_layouts',
              name: 'layouts',
              type: 'flexible_content',
              layouts: {
                layout_a: {
                  key: 'layout_a',
                  name: 'a',
                  label: 'A',
                  sub_fields: [{ key: 'field_t', name: 't', type: 'text' }],
                },
              },
            },
          ],
          location: [[{ param: 'post_type', operator: '==', value: 'post' }]],
        },
      ]).map((g) => [g.key, g.fields[0]?.layouts.map((l) => [l.name, l.subFields[0]?.name])]),
    ).toEqual([['group_x', [['a', 't']]]])
    await expect(loadAcfJson(['/does/not/exist'])).rejects.toThrow(AcfJsonError)
    const dir = mkdtempSync(join(tmpdir(), 'acf-json-'))
    writeFileSync(join(dir, 'broken.json'), '{')
    await expect(loadAcfJson([dir])).rejects.toThrow(/cannot read/)
  })

  it('lets a JSON group replace the export group with the same key', () => {
    const old: AcfFieldGroup = {
      key: 'group_a',
      title: 'Old',
      fields: [],
      location: [],
      order: 0,
      source: 'export',
    }
    const definitions = new AcfDefinitions([old], [{ ...old, title: 'New', source: 'json' }])
    expect(definitions.groups.map((g) => [g.title, g.source])).toEqual([['New', 'json']])
  })

  it('reads the same definitions from a WP-CLI export, which has no term meta', async () => {
    const cli = await buildSiteIndex(cliExportFile)
    const plan = planOf(cli)
    expect([...plan.collections.keys()]).toEqual(['posts', 'recipes', 'categories'])
    expect(cli.acf.usage.has('term:category')).toBe(false)
    expect(planOf(index).definitions.fieldCount).toBe(plan.definitions.fieldCount)
  })
})

describe('ACF plan', () => {
  let index: SiteIndex
  let plan: AcfPlan
  beforeAll(async () => {
    index = await buildSiteIndex(exportFile)
    plan = planOf(index, await loadAcfJson([acfJsonDir]))
  })

  it('puts the fields of each group into the collections it applies to', () => {
    const fields = (collection: string) =>
      plan.collections.get(collection)?.fields.map((f) => `${f.name}:${f.type}`)
    expect(fields('posts')).toEqual(['subtitle:text', 'reading_time:number'])
    expect(fields('categories')).toEqual(['color:text', 'icon:upload'])
    expect(fields('recipes')).toEqual([
      'subtitle:text',
      'notes:textarea',
      'baking_time:number',
      'contact_email:email',
      'source_url:text',
      'instructions:richText',
      'hero:upload',
      'recipe_pdf:upload',
      'photos:upload',
      'difficulty:select',
      'diets:select',
      'oven:radio',
      'seasonal:checkbox',
      'published_on:date',
      'next_course:date',
      'more_info:link',
      'related_post:relationship',
      'about_page:relationship',
      'related_recipes:relationship',
      'recipe_categories:relationship',
      'nutrition:group',
      'ingredients:array',
      'sections:blocks',
      'acf_excerpt:textarea',
      'origin:text',
      'region:select',
    ])
    const recipes = plan.collections.get('recipes')?.fields ?? []
    const of = (name: string) => recipes.find((f) => f.name === name)
    expect(of('photos')).toMatchObject({ hasMany: true, relationTo: ['media'] })
    expect(of('diets')).toMatchObject({ hasMany: true })
    expect(of('difficulty')).toMatchObject({ hasMany: false })
    expect(of('related_recipes')).toMatchObject({ hasMany: true, relationTo: ['recipes'] })
    expect(of('related_post')).toMatchObject({ hasMany: false, relationTo: ['posts'] })
    expect(of('recipe_categories')).toMatchObject({
      hasMany: true,
      relationTo: ['categories'],
      taxonomy: 'category',
    })
    expect(of('next_course')).toMatchObject({ time: true })
    expect(planBlocks(plan).map((b) => b.slug)).toEqual(['text_block', 'quote'])
  })

  it('reports fields that are not imported, with the number of values', () => {
    expect(plan.notes.map((n) => [n.code, n.path, n.values])).toEqual([
      ['ACF_FIELD_SKIPPED', 'Grundlagen', undefined],
      ['ACF_FIELD_RENAMED', 'excerpt', undefined],
      ['ACF_FIELD_SKIPPED', 'title_clone', 1],
      ['ACF_FIELD_SKIPPED', 'location', 1],
      ['ACF_FIELD_SKIPPED', 'chef', 1],
      ['ACF_FIELD_SKIPPED', 'Hinweis', undefined],
      ['ACF_FIELD_SKIPPED', 'secret_code', 1],
    ])
    expect(plan.notes.find((n) => n.path === 'secret_code')?.message).toBe(
      'ACF field "secret_code" (password) of recipes is not imported: password fields are never imported. 1 item has a value.',
    )
    expect(plan.undefinedValues).toEqual([])
    expect(plan.dateTimeFields).toBe(1)
  })

  it('names values whose field group is not in the export', () => {
    expect(planOf(index).undefinedValues).toEqual([
      { target: 'post:recipe', name: 'origin', key: 'field_local_origin', items: 1 },
      { target: 'post:recipe', name: 'region', key: 'field_local_region', items: 1 },
    ])
  })

  const input = (groups: AcfFieldGroup[], over: Partial<AcfPlanInput> = {}): AcfPlanInput => ({
    definitions: new AcfDefinitions(groups),
    index: EMPTY_ACF_INDEX,
    postTypes: [
      { wpType: 'post', collection: 'posts' },
      { wpType: 'page', collection: 'pages' },
      { wpType: 'event', collection: 'events' },
    ],
    taxonomies: [
      { taxonomy: 'category', collection: 'categories' },
      { taxonomy: 'post_tag', collection: 'tags' },
    ],
    mediaCollection: 'media',
    reserved: () => new Set(['title', 'slug', 'id']),
    postTypesWithTaxonomy: (t) => (t === 'category' ? ['post'] : []),
    typeOfPost: (id) => (id === 7 ? 'event' : undefined),
    localized: false,
    ...over,
  })
  const field = (name: string, type = 'text', extra: Partial<AcfField> = {}): AcfField => ({
    key: `field_${name}`,
    name,
    label: name,
    type,
    instructions: '',
    settings: { type },
    choices: [],
    subFields: [],
    layouts: [],
    ...extra,
  })
  const group = (key: string, location: [string, string, string][][], fields: AcfField[]) => ({
    key,
    title: key,
    fields,
    location: location.map((and) =>
      and.map(([param, operator, value]) => ({ param, operator, value })),
    ),
    order: 0,
    source: 'export' as const,
  })

  it('reads ACF location rules', () => {
    const result = planAcf(
      input([
        group('group_pages', [[['page_template', '==', 'tpl.php']]], [field('a')]),
        group('group_not_pages', [[['post_type', '!=', 'page']]], [field('b')]),
        group('group_terms', [[['taxonomy', '==', 'all']]], [field('c')]),
        group('group_options', [[['options_page', '==', 'theme']]], [field('d')]),
        group('group_one_post', [[['post', '==', '7']]], [field('e')]),
        group(
          'group_and',
          [
            [
              ['post_type', '==', 'post'],
              ['current_user', '==', 'logged_in'],
            ],
          ],
          [field('f')],
        ),
        group('group_other_plugin', [[['wc_product_type', '==', 'simple']]], [field('g')]),
      ]),
    )
    const names = (c: string) => result.collections.get(c)?.fields.map((f) => f.name)
    expect(names('posts')).toEqual(['f', 'b'])
    expect(names('pages')).toEqual(['a'])
    expect(names('events')).toEqual(['b', 'e'])
    expect(names('categories')).toEqual(['c'])
    expect(names('tags')).toEqual(['c'])
    expect(result.unplaced.map((u) => [u.group.key, u.where])).toEqual([
      ['group_options', ['options pages']],
      ['group_other_plugin', ['location rules of another plugin']],
    ])
  })

  it('places a group where items have values of it, whatever its rules say', () => {
    const usage = new Map([['post:event', new Map([['g', new Map([['field_g', 2]])]])]])
    const result = planAcf(
      input([group('group_other_plugin', [[['wc_product_type', '==', 'simple']]], [field('g')])], {
        index: { ...EMPTY_ACF_INDEX, usage },
      }),
    )
    expect(result.collections.get('events')?.fields.map((f) => f.name)).toEqual(['g'])
    expect(result.unplaced).toEqual([])
  })

  it('renames fields that clash and keeps block slugs unique', () => {
    const layout = (key: string, name: string) => ({
      key,
      name,
      label: name,
      subFields: [field(`${key}_text`)],
    })
    const result = planAcf(
      input([
        group(
          'group_a',
          [[['post_type', '==', 'post']]],
          [
            field('title'),
            field('my-field'),
            field('rows', 'repeater', { subFields: [field('id')] }),
            field('blocks', 'flexible_content', {
              layouts: [layout('layout_1', 'quote'), layout('layout_2', 'code')],
            }),
          ],
        ),
        group(
          'group_b',
          [[['post_type', '==', 'page']]],
          [field('more', 'flexible_content', { layouts: [layout('layout_3', 'quote')] })],
        ),
        group(
          'group_c',
          [[['post_type', '==', 'post']]],
          [field('title', 'number', { key: 'field_title_2' })],
        ),
      ]),
    )
    const posts = result.collections.get('posts')?.fields ?? []
    expect(posts.map((f) => [f.name, f.matchKey])).toEqual([
      ['acf_title', true],
      ['my_field', false],
      ['rows', false],
      ['blocks', false],
      ['acf_title_2', true],
    ])
    expect(posts[2]?.fields.map((f) => f.name)).toEqual(['acf_id'])
    expect(planBlocks(result).map((b) => b.slug)).toEqual([
      'blocks_quote',
      'blocks_code',
      'more_quote',
    ])
    expect(
      result.notes.filter((n) => n.code === 'ACF_FIELD_RENAMED').map((n) => n.message),
    ).toEqual([
      'ACF field "title" of posts is imported as "acf_title": "title" is a field of the collection already.',
      'ACF field "my-field" of posts is imported as "my_field": Payload field names may only contain letters, digits and underscores.',
      'ACF field "rows.id" of posts is imported as "acf_id": "id" is reserved by Payload.',
      'ACF field "title" of posts is imported as "acf_title_2": "title" is a field of the collection already.',
    ])
  })

  it('skips relations to types that are not imported', () => {
    const result = planAcf(
      input([
        group(
          'group_a',
          [[['post_type', '==', 'post']]],
          [
            field('product', 'post_object', {
              settings: { type: 'post_object', post_type: ['product'] },
            }),
            field('anything', 'relationship', {
              settings: { type: 'relationship', post_type: '' },
            }),
            field('shop_terms', 'taxonomy', {
              settings: { type: 'taxonomy', taxonomy: 'product_cat' },
            }),
            field('legacy', 'nav_menu'),
          ],
        ),
      ]),
    )
    expect(result.collections.get('posts')?.fields.map((f) => [f.name, f.relationTo])).toEqual([
      ['anything', ['posts', 'pages', 'events']],
    ])
    expect(result.notes.map((n) => n.message)).toEqual([
      'ACF field "product" (post_object) of posts is not imported: it points to product, which is not imported.',
      'ACF field "shop_terms" (taxonomy) of posts is not imported: its taxonomy product_cat is not imported.',
      'ACF field "legacy" (nav_menu) of posts is not imported: the field type "nav_menu" is not supported.',
    ])
  })
})

describe('ACF values', () => {
  let plan: AcfPlan
  beforeAll(async () => {
    plan = planOf(await buildSiteIndex(exportFile), await loadAcfJson([acfJsonDir]))
  })
  const recipes = () => plan.collections.get('recipes')?.fields ?? []
  const recipeField = (name: string) => {
    const found = recipes().find((f) => f.name === name)
    if (!found) throw new Error(`no field ${name}`)
    return found
  }

  it('turns stored values into Payload data', async () => {
    const ctx = context(await metaOf(exportFile, 51))
    const { data, pending } = acfValues(recipes(), ctx)
    expect(ctx.warnings).toEqual([])
    expect(pending).toEqual(new Set())
    expect(data).toEqual({
      subtitle: 'Mit Sauerteig',
      notes: 'Über Nacht gehen lassen.\nMorgens backen.',
      baking_time: 55,
      contact_email: 'kurse@example.com',
      source_url: 'https://example.org/roggen',
      instructions: {
        html: expect.stringContaining(
          '<a href="https://custom-fields.example.com/2024/02/01/unser-rezeptbuch/">',
        ),
      },
      hero: 1001,
      recipe_pdf: 1004,
      photos: [1002, 1003],
      difficulty: 'medium',
      diets: ['vegan', 'vegetarisch'],
      oven: 'umluft',
      seasonal: true,
      published_on: '2024-03-01T12:00:00.000Z',
      next_course: '2024-05-01T16:00:00.000Z',
      more_info: {
        label: 'Roggen im Lexikon',
        url: 'https://example.org/lexikon/roggen',
        newTab: true,
      },
      related_post: 2006,
      about_page: 2005,
      related_recipes: [2052],
      recipe_categories: [3002],
      nutrition: { calories: 240, allergens: ['gluten'] },
      ingredients: [
        { amount: '500 g', ingredient: 'Roggenmehl' },
        { amount: '350 ml', ingredient: 'Wasser' },
      ],
      sections: [
        { blockType: 'text_block', text: { html: '<p>Der Sauerteig braucht Zeit.</p>' } },
        { blockType: 'quote', quote: 'Brot ist Geduld.', author: 'Anna' },
      ],
      acf_excerpt: 'Ein Brot für jeden Tag.',
      origin: 'Waldviertel',
      region: 'nord',
    })
  })

  it('leaves out fields without a stored value and reads empty ones', async () => {
    const { data } = acfValues(recipes(), context(await metaOf(exportFile, 52)))
    expect(data).toEqual({ subtitle: 'Für den Sonntag', ingredients: [], seasonal: false })
  })

  it('postpones references to items that are not imported yet, and reports them at the end', async () => {
    const meta = await metaOf(exportFile, 51)
    const missing = (id: number) => (id === 52 ? undefined : { collection: 'posts', id })
    const first = context(meta, { post: missing })
    const fields = recipes().filter((f) => f.name === 'related_recipes')
    expect(acfValues(fields, first)).toEqual({
      data: { related_recipes: [] },
      pending: new Set(['related_recipes']),
    })
    expect(first.warnings).toEqual([])
    const last = context(meta, { post: missing, final: true })
    acfValues(fields, last)
    expect(last.warnings).toEqual([
      'REFERENCE_MISSING: ACF field "related_recipes": item 52 was not imported.',
    ])
  })

  it('reports values it cannot use', () => {
    const fields = recipes().filter((f) =>
      ['baking_time', 'contact_email', 'difficulty', 'sections', 'published_on', 'hero'].includes(
        f.name,
      ),
    )
    const meta = new Map([
      ['baking_time', ['about an hour']],
      ['contact_email', ['not an address']],
      ['difficulty', ['extreme']],
      ['sections', ['a:2:{i:0;s:5:"quote";i:1;s:7:"gallery";}']],
      ['sections_0_quote', ['Kneten!']],
      ['published_on', ['soon']],
      ['hero', ['99']],
    ])
    const ctx = context(meta, { media: () => undefined })
    const { data } = acfValues(fields, ctx)
    expect(data).toEqual({
      difficulty: null,
      sections: [{ blockType: 'quote', quote: 'Kneten!' }],
      hero: null,
    })
    expect(ctx.warnings).toEqual([
      'ACF_VALUE_INVALID: ACF field "baking_time": "about an hour" is not a number; it was not imported.',
      'ACF_VALUE_INVALID: ACF field "contact_email": "not an address" is not an e-mail address; it was not imported.',
      'REFERENCE_MISSING: ACF field "hero": media file 99 was not imported.',
      'ACF_VALUE_INVALID: ACF field "difficulty": "extreme" is not one of its choices; it was left out.',
      'ACF_VALUE_INVALID: ACF field "published_on": "soon" is not a date.',
      'ACF_VALUE_INVALID: ACF field "sections": row 2 uses the layout "gallery", which is not defined; it was left out.',
    ])
  })

  it('gives a shared value to the field its reference names', () => {
    const subtitle = recipeField('subtitle')
    const title = (key: string, type: 'text' | 'number') => ({
      ...subtitle,
      name: key === 'field_a' ? 'acf_title' : 'acf_title_2',
      type,
      matchKey: true,
      acf: { ...subtitle.acf, key, name: 'title' },
    })
    const fields = [title('field_a', 'text'), title('field_b', 'number')]
    const meta = new Map([
      ['title', ['42']],
      ['_title', ['field_b']],
    ])
    expect(acfValues(fields, context(meta)).data).toEqual({ acf_title_2: 42 })
  })

  it('reads links and page links that hold URLs', () => {
    const more = recipeField('more_info')
    const page = recipeField('about_page')
    const meta = new Map([
      ['more_info', ['https://custom-fields.example.com/ueber-uns/']],
      ['about_page', ['https://custom-fields.example.com/ueber-uns/']],
    ])
    const ctx = context(meta, { findPost: (url) => (url.endsWith('/ueber-uns/') ? 5 : undefined) })
    expect(acfValues([more, page], ctx).data).toEqual({
      more_info: { label: null, url: '/ueber-uns/', newTab: false },
      about_page: 2005,
    })
  })
})

describe('ACF dates', () => {
  it('converts local times with the time zone, or with the usual offset', () => {
    const vienna = { timeZone: 'Europe/Vienna', offsetMinutes: 0 }
    expect(localToIso('2024-05-01 18:00:00', vienna)).toBe('2024-05-01T16:00:00.000Z')
    expect(localToIso('2024-01-15 18:00:00', vienna)).toBe('2024-01-15T17:00:00.000Z')
    // The night summer time starts: 02:30 does not exist and becomes 03:30.
    expect(localToIso('2024-03-31 03:30:00', vienna)).toBe('2024-03-31T01:30:00.000Z')
    expect(localToIso('2024-05-01 18:00', { offsetMinutes: 60 })).toBe('2024-05-01T17:00:00.000Z')
    expect(localToIso('tomorrow', vienna)).toBeUndefined()
    expect(
      commonOffset(
        new Map([
          [60, 3],
          [120, 5],
        ]),
      ),
    ).toBe(120)
    expect(commonOffset(new Map())).toBe(0)
  })
})

describe('ACF in scaffold, analyze and the config', () => {
  let plan: AcfPlan
  beforeAll(async () => {
    plan = planOf(await buildSiteIndex(exportFile), await loadAcfJson([acfJsonDir]))
  })

  it('writes the fields into the collections', () => {
    const files = scaffoldFiles(DEFAULT_CONFIG.collections, undefined, undefined, plan)
    const categories = files.find((f) => f.name === 'Categories.ts')?.content ?? ''
    expect(categories).toContain(`    // ACF field group "Kategoriedaten" (group_category)
    { name: 'color', type: 'text', label: 'Farbe' },
    { name: 'icon', type: 'upload', label: 'Bild', relationTo: 'media' },
    wpId,`)
    expect(categories).not.toContain('wpEditor')
    const lines = acfFieldLines(plan.collections.get('recipes'))
    expect(lines).toContain(`    {
      name: 'next_course',
      type: 'date',
      label: 'Nächster Kurs',
      admin: { date: { pickerAppearance: 'dayAndTime' } },
    },`)
    expect(lines).toContain(`        {
          slug: 'quote',
          labels: { singular: 'Zitat', plural: 'Zitat' },
          fields: [
            { name: 'quote', type: 'textarea', label: 'Zitat' },
            { name: 'author', type: 'text', label: 'Von' },
          ],
        },`)
    expect(lines).toContain(
      "    { name: 'instructions', type: 'richText', label: 'Anleitung', editor: wpEditor },",
    )
  })

  it('reports field groups, fields and what happens to them', async () => {
    const r = await analyzeExport(exportFile, { acfJson: [acfJsonDir] })
    expect(r.customFields?.groups.map((g) => [g.key, g.fields, g.collections])).toEqual([
      ['group_post', 2, ['posts']],
      ['group_category', 2, ['categories']],
      ['group_recipe', 37, ['recipes']],
      ['group_local_origin', 2, ['recipes']],
    ])
    expect(r.customFields?.fieldTypes).toMatchObject({ text: 6, wysiwyg: 2, repeater: 1 })
    expect(r.customFields?.undefinedValues).toEqual([])
    expect(r.complexity.reasons.map((x) => x.reason)).toEqual(
      expect.arrayContaining([
        '30 ACF fields become Payload fields (check them after scaffold)',
        'ACF fields with values that are not imported: title_clone, location, chef, secret_code',
      ]),
    )
    const md = renderMarkdown(r)
    expect(md).toContain('## Custom fields (ACF)')
    expect(md).toContain('| Rezeptdaten (group_recipe) | 37 | export | recipes |')
    expect(md).toContain('Set `timeZone` in wp-to-payload.config.json')

    const without = await analyzeExport(exportFile)
    expect(without.customFields?.undefinedValues.map((v) => v.name)).toEqual(['origin', 'region'])
    expect(without.complexity.reasons.map((x) => x.reason)).toContain(
      "values of 2 ACF fields without a definition in the export (pass the theme's acf-json with --acf-json)",
    )
  })

  it('reads acfJson and timeZone from the config', () => {
    expect(parseConfig({ acfJson: 'acf-json', timeZone: 'Europe/Vienna' })).toMatchObject({
      acfJson: ['acf-json'],
      timeZone: 'Europe/Vienna',
    })
    expect(parseConfig({ acfJson: ['a', 'b'] }).acfJson).toEqual(['a', 'b'])
    expect(() => parseConfig({ timeZone: 'Mars/Olympus' })).toThrow(/timeZone must be a time zone/)
    expect(() => parseConfig({ acfJson: 3 })).toThrow(/acfJson must be a list of strings/)
  })
})
