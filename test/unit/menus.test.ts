import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { analyzeExport } from '../../src/analyze/analyze.js'
import { renderMarkdown } from '../../src/analyze/markdown.js'
import { main } from '../../src/cli/index.js'
import { DEFAULT_CONFIG, parseConfig } from '../../src/config.js'
import { indexLanguages, type SiteLanguages } from '../../src/languages.js'
import {
  flattenMenu,
  type MenuItem,
  menuItemLabel,
  menuLevels,
  placeMenus,
  type WpMenu,
} from '../../src/menus.js'
import { buildSiteIndex, type SiteIndex } from '../../src/wxr/site-index.js'

const fixture = (name: string) =>
  fileURLToPath(new URL(`../fixtures/wxr/wordpress/${name}`, import.meta.url))

const item = (id: number, over: Partial<MenuItem> = {}): MenuItem => ({
  id,
  order: id,
  parentId: 0,
  type: 'custom',
  object: 'custom',
  objectId: id,
  url: `https://example.com/${id}`,
  newTab: false,
  title: `Item ${id}`,
  ...over,
})
const menu = (name: string, items: MenuItem[], slug = name.toLowerCase()): WpMenu => ({
  slug,
  name,
  items,
})
const placed = (menus: WpMenu[], config = DEFAULT_CONFIG, languages?: SiteLanguages) =>
  placeMenus(menus, config, languages).map((p) => [
    p.menu.name,
    p.global ?? null,
    ...(p.language ? [p.language] : []),
    p.reason,
  ])

describe('menus in an export', () => {
  let core: SiteIndex
  beforeAll(async () => {
    core = await buildSiteIndex(fixture('core.xml'))
  })

  it('reads menus with their entries in order', () => {
    expect(core.menus.map((m) => [m.slug, m.name, m.items.length])).toEqual([
      ['footer', 'Footer', 2],
      ['hauptmenu', 'Hauptmenü', 5],
    ])
    const main = core.menus[1] as WpMenu
    expect(flattenMenu(main).map((f) => [f.item.id, f.depth])).toEqual([
      [21, 0],
      [22, 1],
      [23, 0],
      [24, 0],
      [25, 0],
    ])
    expect(main.items[0]).toEqual({
      id: 21,
      order: 1,
      parentId: 0,
      type: 'post_type',
      object: 'page',
      objectId: 1,
      url: '',
      newTab: false,
      title: '',
    })
    expect(main.items[4]).toMatchObject({
      type: 'custom',
      url: 'https://shop.example.org/',
      newTab: true,
    })
    expect(menuLevels(main)).toBe(2)
    expect(menuLevels(core.menus[0] as WpMenu)).toBe(1)
  })

  it('reads the same menus from a WP-CLI export', async () => {
    const cli = await buildSiteIndex(fixture('core.wp-cli.xml'))
    expect(cli.menus).toEqual(core.menus)
  })

  it('labels entries with their own title or the linked item', () => {
    const titles = { post: (id: number) => (id === 1 ? 'Über uns' : undefined), term: () => 'Brot' }
    const [about, , recipes] = (core.menus[1] as WpMenu).items
    expect(menuItemLabel(about as MenuItem, titles)).toBe('Über uns')
    expect(menuItemLabel(recipes as MenuItem, titles)).toBe('Rezepte')
    expect(menuItemLabel(item(3, { title: '', type: 'taxonomy' }), titles)).toBe('Brot')
    expect(menuItemLabel(item(4, { title: '' }), titles)).toBe('https://example.com/4')
  })

  it('puts submenus after their parents, also when the parent is gone', () => {
    const m = menu('Main', [
      item(1),
      item(2, { parentId: 3 }),
      item(3, { parentId: 1 }),
      item(4, { parentId: 99 }),
    ])
    expect(flattenMenu(m).map((f) => [f.item.id, f.depth])).toEqual([
      [1, 0],
      [3, 1],
      [2, 2],
      [4, 0],
    ])
    expect(menuLevels(m)).toBe(3)
  })
})

describe('menu placement', () => {
  it('finds header and footer menus by their names', () => {
    expect(
      placed([
        menu('Footer', [item(1)]),
        menu('Hauptmenü', [item(2)], 'hauptmenu'),
        menu('Social', [item(3)]),
        menu('Empty', []),
      ]),
    ).toEqual([
      ['Footer', 'footer', 'its name'],
      ['Hauptmenü', 'header', 'its name'],
      [
        'Social',
        null,
        'its name is not a header or footer menu; name its global under "menus" in the config',
      ],
      ['Empty', null, 'it has no entries'],
    ])
  })

  it('makes the largest menu the header when no name says so', () => {
    expect(placed([menu('Menu 1', [item(1)]), menu('Menu 2', [item(2), item(3)])])).toEqual([
      [
        'Menu 1',
        null,
        'its name is not a header or footer menu; name its global under "menus" in the config',
      ],
      ['Menu 2', 'header', 'the largest menu without a place'],
    ])
  })

  it('follows the config, by slug or name, before names', () => {
    const config = parseConfig({
      menus: { 'top-links': 'header', Footer: false, 'Main menu': 'mainNav' },
    })
    expect(
      placed(
        [
          menu('Main menu', [item(1)], 'main-menu'),
          menu('Top links', [item(2)], 'top-links'),
          menu('Footer', [item(3)]),
          menu('Header too', [item(4)], 'header-too'),
        ],
        config,
      ),
    ).toEqual([
      ['Main menu', 'mainNav', 'set in the config'],
      ['Top links', 'header', 'set in the config'],
      ['Footer', null, 'set to false in the config'],
      ['Header too', null, 'the header is "Top links" already'],
    ])
  })

  it('gives each language its own header and footer', async () => {
    const index = await buildSiteIndex(fixture('multilingual.xml'))
    const languages = indexLanguages(index, DEFAULT_CONFIG) as SiteLanguages
    expect(placed(index.menus, DEFAULT_CONFIG, languages)).toEqual([
      ['Footer', 'footer', 'de', 'its name'],
      ['Hauptmenü', 'header', 'de', 'its name'],
      ['Main menu', 'header', 'en', 'its name'],
    ])
  })

  it('validates the menus setting', () => {
    expect(() => parseConfig({ menus: { Main: 'header nav' } })).toThrow(
      /menus.Main must be the slug of a Payload global/,
    )
    expect(() => parseConfig({ menus: [] })).toThrow(/menus must be an object/)
  })
})

describe('menus in analyze and scaffold', () => {
  it('lists the menus with their globals', async () => {
    const r = await analyzeExport(fixture('core.xml'))
    expect(r.menus).toEqual([
      { name: 'Footer', slug: 'footer', items: 2, levels: 1, global: 'footer', reason: 'its name' },
      {
        name: 'Hauptmenü',
        slug: 'hauptmenu',
        items: 5,
        levels: 2,
        global: 'header',
        reason: 'its name',
      },
    ])
    expect(renderMarkdown(r)).toContain(
      '| Hauptmenü (hauptmenu) | 5 | 2 | global `header` (its name) |',
    )
  })

  const scaffold = async (cwd: string, args: string[]) => {
    const chunks: string[] = []
    const write = (c: unknown) => {
      chunks.push(String(c))
      return true
    }
    const spyOut = vi.spyOn(process.stdout, 'write').mockImplementation(write)
    const spyErr = vi.spyOn(process.stderr, 'write').mockImplementation(write)
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(cwd)
    try {
      return { code: await main(['scaffold', ...args]), text: chunks.join('') }
    } finally {
      spyOut.mockRestore()
      spyErr.mockRestore()
      cwdSpy.mockRestore()
    }
  }
  const project = () => {
    const dir = mkdtempSync(join(tmpdir(), 'wp2p-menus-'))
    mkdirSync(join(dir, 'src'))
    return dir
  }
  const read = (dir: string, file: string) =>
    readFileSync(join(dir, 'src', 'collections', 'wp', file), 'utf8')

  it('writes header and footer globals with links like the website template', async () => {
    const dir = project()
    const { code, text } = await scaffold(dir, [fixture('core.xml')])
    expect(code, text).toBe(0)
    expect(read(dir, 'Header.ts')).toContain("slug: 'header',")
    expect(read(dir, 'Footer.ts')).toContain("slug: 'footer',")
    expect(read(dir, 'Header.ts')).toContain(
      "name: 'navItems',\n      type: 'array',\n      fields: [link],",
    )
    expect(read(dir, 'fields.ts')).toContain("relationTo: ['pages', 'posts', 'guides', 'recipes'],")
    expect(read(dir, 'index.ts')).toContain('export const wpGlobals = [Header, Footer]')
    expect(text).toContain('  Hauptmenü → header')
    expect(text).toContain('globals: [...wpGlobals /* , your other globals */],')
  })

  it('leaves the globals of a project alone and fills them', async () => {
    const dir = project()
    writeFileSync(
      join(dir, 'src', 'Header.ts'),
      "export const Header = { slug: 'header', fields: [] }\n",
    )
    const { code, text } = await scaffold(dir, [fixture('core.xml')])
    expect(code, text).toBe(0)
    expect(read(dir, 'index.ts')).toContain('export const wpGlobals = [Footer]')
    expect(text).toContain('Your global "header" (src/Header.ts) gets the menu in its navItems.')
  })

  it('writes localized navItems on multilingual sites', async () => {
    const dir = project()
    const { code, text } = await scaffold(dir, [fixture('multilingual.xml')])
    expect(code, text).toBe(0)
    expect(read(dir, 'Header.ts')).toContain("type: 'array',\n      localized: true,")
  })
})
