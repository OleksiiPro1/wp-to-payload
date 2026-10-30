import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Finds `node_modules/<name>` from `fromDir` upwards, the way Node resolves packages. */
export const findPackageDir = (name: string, fromDir: string): string | undefined => {
  let dir = resolve(fromDir)
  for (;;) {
    const candidate = join(dir, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return candidate
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

type Exports = string | null | { [key: string]: Exports } | Exports[]

const CONDITIONS = ['node', 'import', 'default']

const pickTarget = (value: Exports): string | undefined => {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    for (const v of value) {
      const target = pickTarget(v)
      if (target) return target
    }
    return undefined
  }
  if (value && typeof value === 'object') {
    for (const condition of CONDITIONS) {
      if (condition in value) {
        const target = pickTarget(value[condition] ?? null)
        if (target) return target
      }
    }
  }
  return undefined
}

/** Resolves an ESM entry point (`payload`, `payload/node`) of a package installed in a project. */
export const resolveFromProject = (specifier: string, projectDir: string): string => {
  const parts = specifier.split('/')
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier)
  const subpath = `.${specifier.slice(name.length)}`
  const dir = findPackageDir(name, projectDir)
  if (!dir) {
    throw new Error(
      `cannot find "${name}" in ${projectDir}; run wp-to-payload inside your Payload project`,
    )
  }
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
    exports?: Exports
    module?: string
    main?: string
  }
  let target: string | undefined
  if (pkg.exports !== undefined) {
    const exportsMap = pkg.exports
    const entry =
      typeof exportsMap === 'string' || Array.isArray(exportsMap)
        ? subpath === '.'
          ? exportsMap
          : null
        : exportsMap && Object.keys(exportsMap).some((k) => k.startsWith('.'))
          ? (exportsMap[subpath] ?? null)
          : subpath === '.'
            ? exportsMap
            : null
    target = pickTarget(entry)
  } else if (subpath === '.') {
    target = pkg.module ?? pkg.main ?? 'index.js'
  }
  if (!target) throw new Error(`"${specifier}" is not exported by ${name}`)
  return join(dir, target)
}

/** Imports a module from the user's project, so the project's own Payload instance is used. */
export const importFromProject = async <T>(specifier: string, projectDir: string): Promise<T> =>
  (await import(pathToFileURL(resolveFromProject(specifier, projectDir)).href)) as T
