import type { Config } from '../config.js'
import type { ImportOptions } from './importer.js'

/** Environment variable that carries the options from the CLI to the runner. */
export const OPTIONS_ENV = 'WP_TO_PAYLOAD_OPTIONS'

export interface RunnerOptions extends Omit<ImportOptions, 'log' | 'fetchImpl' | 'config'> {
  config: Config
  resultFile: string
  reportDir: string
}

export interface RunnerResult {
  ok: boolean
  fatal?: string
  setupError?: boolean
  failed: number
  reportFiles: string[]
}
