import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
export const projectRoot = join(repoRoot, 'test', 'payload-project')
const cli = join(repoRoot, 'dist', 'cli', 'index.js')

export const projectInstalled = (): boolean =>
  existsSync(join(projectRoot, 'node_modules', 'payload', 'package.json'))

/** Builds the package so the CLI and the runner in dist/ are current. */
export const buildPackage = (): void => {
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'pipe' })
}

/** A fresh directory inside the test project, so it uses the project's node_modules. */
export const createRun = (name: string): string => {
  const dir = join(projectRoot, '.runs', `${name}-${Date.now()}`)
  mkdirSync(join(dir, 'src'), { recursive: true })
  return dir
}

export const writePayloadConfig = (dir: string, body = ''): void => {
  writeFileSync(
    join(dir, 'src', 'payload.config.ts'),
    `import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { redirectsPlugin } from '@payloadcms/plugin-redirects'
import { seoPlugin } from '@payloadcms/plugin-seo'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildConfig } from 'payload'
import { wpCollections } from './collections/wp'

const dirname = path.dirname(fileURLToPath(import.meta.url))

export default buildConfig({
  secret: 'integration-test-secret-not-for-production',
  db: sqliteAdapter({ client: { url: \`file:\${path.resolve(dirname, '../db.sqlite')}\` } }),
  collections: wpCollections,
  plugins: [
    seoPlugin({ collections: ['posts', 'pages'], uploadsCollection: 'media' }),
    redirectsPlugin({ collections: ['posts', 'pages'] }),
  ],
  ${body}
})
`,
  )
}

export interface CliRun {
  status: number | null
  output: string
}

export const runCli = (dir: string, args: string[]): CliRun => {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    timeout: 280_000,
  })
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` }
}

/** Like `runCli`, but does not block the event loop (needed when the test serves HTTP itself). */
export const runCliAsync = (dir: string, args: string[]): Promise<CliRun> =>
  new Promise((done, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: dir,
      env: { ...process.env, NO_COLOR: '1' },
    })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.on('error', reject)
    child.on('close', (status) => done({ status, output }))
  })

/** Runs a script with `payload run` in the project and returns the JSON it writes. */
export const queryPayload = <T>(dir: string, body: string): T => {
  const script = join(dir, `query-${Date.now()}.ts`)
  const out = `${script}.json`
  writeFileSync(
    script,
    `import { writeFileSync } from 'node:fs'
import { getPayload } from 'payload'
import config from './src/payload.config'

const payload = await getPayload({ config })
const result = await (async () => {
${body}
})()
writeFileSync(${JSON.stringify(out)}, JSON.stringify(result))
`,
  )
  const run = spawnSync(
    process.execPath,
    [join(projectRoot, 'node_modules', 'payload', 'bin.js'), 'run', script],
    {
      cwd: dir,
      encoding: 'utf8',
      timeout: 200_000,
    },
  )
  if (!existsSync(out)) throw new Error(`query failed:\n${run.stdout}\n${run.stderr}`)
  return JSON.parse(readFileSync(out, 'utf8')) as T
}
