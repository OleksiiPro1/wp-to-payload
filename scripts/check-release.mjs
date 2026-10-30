#!/usr/bin/env node
// Checks run by .github/workflows/publish.yml before `npm publish`:
// tool versions for trusted publishing, tag = package.json version, tagged commit on main.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const MIN_NODE = '22.14.0'
const MIN_NPM = '11.5.1'

const fail = (message) => {
  console.error(`✗ ${message}`)
  process.exit(1)
}

const parts = (version) =>
  version
    .replace(/^v/, '')
    .split('-')[0]
    .split('.')
    .map((n) => Number(n) || 0)

const atLeast = (actual, minimum) => {
  const a = parts(actual)
  const m = parts(minimum)
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (m[i] ?? 0)) return (a[i] ?? 0) > (m[i] ?? 0)
  }
  return true
}

const node = process.versions.node
if (!atLeast(node, MIN_NODE))
  fail(`Node.js ${node} is too old: trusted publishing needs ${MIN_NODE}+`)

const npm = execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim()
if (!atLeast(npm, MIN_NPM)) fail(`npm ${npm} is too old: trusted publishing needs ${MIN_NPM}+`)

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const tag = process.env.GITHUB_REF_NAME ?? ''
if (tag !== `v${version}`) {
  fail(`tag "${tag}" does not match the version in package.json (expected v${version})`)
}

try {
  execFileSync('git', ['merge-base', '--is-ancestor', 'HEAD', 'origin/main'], { stdio: 'ignore' })
} catch {
  fail(`${tag} does not point to a commit on main; tag the merge commit on main`)
}

console.log(`✓ ${tag}: Node.js ${node}, npm ${npm}, commit is on main`)
