import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { main } from '../../src/cli/index.js'

const core = fileURLToPath(new URL('../fixtures/wxr/wordpress/core.xml', import.meta.url))

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
    const code = await main(['scaffold', ...args])
    return { code, text: chunks.join('') }
  } finally {
    spyOut.mockRestore()
    spyErr.mockRestore()
    cwdSpy.mockRestore()
  }
}

const project = () => {
  const dir = mkdtempSync(join(tmpdir(), 'wp2p-scaffold-'))
  mkdirSync(join(dir, 'src'))
  return dir
}

const read = (dir: string, file: string) =>
  readFileSync(join(dir, 'src', 'collections', 'wp', file), 'utf8')

describe('scaffold', () => {
  it('writes collections for the custom post types and taxonomies of an export', async () => {
    const dir = project()
    const { code, text } = await scaffold(dir, [core])
    expect(code, text).toBe(0)
    expect(text).toContain('recipe_category → recipe-categories')
    const recipes = read(dir, 'Recipes.ts')
    expect(recipes).toContain("slug: 'recipes',")
    expect(recipes).toContain("name: 'recipeCategories',")
    expect(recipes).toContain("relationTo: 'recipe-categories',")
    expect(recipes).not.toContain("name: 'parent'")
    // Hierarchical types and taxonomies get a parent and may reuse slugs.
    expect(read(dir, 'Guides.ts')).toContain(
      "{ name: 'parent', type: 'relationship', relationTo: 'guides'",
    )
    expect(read(dir, 'Guides.ts')).toContain('slug(false)')
    expect(read(dir, 'RecipeCategories.ts')).toContain("relationTo: 'recipe-categories', admin")
    expect(read(dir, 'index.ts')).toContain(
      'export const wpCollections = [\n  Media,\n  Categories,\n  Tags,\n  RecipeCategories,\n  Authors,\n  Posts,\n  Pages,\n  Guides,\n  Recipes,\n]',
    )
    expect(text).toContain(
      "redirectsPlugin({ collections: ['posts', 'pages', 'guides', 'recipes'] })",
    )
  })

  it('writes only the standard collections without an export', async () => {
    const dir = project()
    const { code, text } = await scaffold(dir, [])
    expect(code).toBe(0)
    expect(text).toContain('Give the export file')
    expect(read(dir, 'index.ts')).toContain(
      'export const wpCollections = [Media, Categories, Tags, Authors, Posts, Pages]',
    )
  })

  it('prefixes custom collections and writes them into the config', async () => {
    const dir = project()
    const { code } = await scaffold(dir, [core, '--slug-prefix', 'wp-'])
    expect(code).toBe(0)
    expect(existsSync(join(dir, 'src', 'collections', 'wp', 'WpRecipes.ts'))).toBe(true)
    const config = JSON.parse(readFileSync(join(dir, 'wp-to-payload.config.json'), 'utf8')) as {
      collections: Record<string, string>
      postTypes: Record<string, { collection: string }>
      taxonomies: Record<string, { collection: string }>
    }
    expect(config.collections.posts).toBe('wp-posts')
    expect(config.postTypes).toEqual({
      guide: { collection: 'wp-guides' },
      recipe: { collection: 'wp-recipes' },
    })
    expect(config.taxonomies).toEqual({ recipe_category: { collection: 'wp-recipe-categories' } })
    expect(read(dir, 'WpRecipes.ts')).toContain("relationTo: 'wp-recipe-categories'")
  })

  it('writes no collection for a type mapped to posts', async () => {
    const dir = project()
    writeFileSync(
      join(dir, 'wp-to-payload.config.json'),
      JSON.stringify({ postTypes: { recipe: { collection: 'posts' } } }),
    )
    const { code } = await scaffold(dir, [core])
    expect(code).toBe(0)
    expect(existsSync(join(dir, 'src', 'collections', 'wp', 'Recipes.ts'))).toBe(false)
    // Recipes are posts now, so posts get the recipe taxonomy.
    expect(read(dir, 'Posts.ts')).toContain("name: 'recipeCategories'")
  })
})
