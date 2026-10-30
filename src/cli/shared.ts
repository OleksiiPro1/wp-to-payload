import { type Config, loadConfig } from '../config.js'
import { validatePattern } from '../paths/patterns.js'
import {
  type CommandContext,
  listOption,
  type OptionSpec,
  stringOption,
  UsageError,
} from './command.js'

/** Options that change URL paths, shared by `import` and `redirects`. */
export const PATH_OPTIONS: OptionSpec = {
  config: { type: 'string' },
  'post-path': { type: 'string' },
  'page-path': { type: 'string' },
  'category-path': { type: 'string' },
  'tag-path': { type: 'string' },
  path: { type: 'string', multiple: true },
  'site-host': { type: 'string', multiple: true },
}

export const PATH_HELP: [string, string][] = [
  ['--config <file>', 'Settings file (default: wp-to-payload.config.json if it exists)'],
  ['--post-path <pattern>', 'New path of posts (default: /posts/:slug)'],
  ['--page-path <pattern>', 'New path of pages (default: /:slug; /:path keeps parent pages)'],
  ['--category-path <pattern>', 'New path of category archives, e.g. /blog/category/:path'],
  ['--tag-path <pattern>', 'New path of tag archives, e.g. /blog/tag/:slug'],
  ['--path <type>=<pattern>', 'New path of another post type; repeatable'],
  ['--site-host <host>', 'Another hostname of the old site (staging, old domain); repeatable'],
]

/** Loads the config file and applies path options given on the command line. */
export const configFromOptions = async (ctx: CommandContext): Promise<Config> => {
  const config = await loadConfig(ctx.cwd, stringOption(ctx, 'config'))
  const set = (type: string, pattern: string | undefined) => {
    if (pattern === undefined) return
    const problem = validatePattern(pattern)
    if (problem) throw new UsageError(problem)
    config.paths[type] = pattern
  }
  set('post', stringOption(ctx, 'post-path'))
  set('page', stringOption(ctx, 'page-path'))
  set('category', stringOption(ctx, 'category-path'))
  set('tag', stringOption(ctx, 'tag-path'))
  const extra = ctx.values.path
  for (const entry of Array.isArray(extra) ? extra : []) {
    const at = entry.indexOf('=')
    if (at <= 0) throw new UsageError(`--path expects <type>=<pattern>, got "${entry}"`)
    set(entry.slice(0, at), entry.slice(at + 1))
  }
  config.siteHosts.push(...listOption(ctx, 'site-host'))
  return config
}
