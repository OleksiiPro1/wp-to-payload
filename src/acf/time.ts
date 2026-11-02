/**
 * ACF stores dates with times in the site's local time, without a time zone, and the export does
 * not name the site's time zone. With `timeZone` from the config, values are converted exactly;
 * otherwise the offset that most published items of the export have is used.
 */

export interface SiteTime {
  /** IANA time zone (`Europe/Vienna`), from the config. */
  timeZone?: string
  /** Minutes ahead of UTC, used without a time zone. */
  offsetMinutes: number
}

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/

/** Whether Intl knows the time zone. */
export const isTimeZone = (name: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name })
    return true
  } catch {
    return false
  }
}

/** Minutes the time zone is ahead of UTC at an instant. */
const offsetAt = (utcMs: number, timeZone: string): number => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  const wall = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  )
  return Math.round((wall - utcMs) / 60_000)
}

/** UTC ISO string of a local date and time (`2024-05-01 18:00:00`), or undefined. */
export const localToIso = (value: string, time: SiteTime): string | undefined => {
  const m = LOCAL.exec(value.trim())
  if (!m) return undefined
  const [, y, mo, d, h, mi, s = '00'] = m
  const wall = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s))
  if (Number.isNaN(wall)) return undefined
  let utc = wall - time.offsetMinutes * 60_000
  if (time.timeZone) {
    // The offset at the guessed instant, then once more in case the guess crossed a change.
    utc = wall - offsetAt(wall, time.timeZone) * 60_000
    utc = wall - offsetAt(utc, time.timeZone) * 60_000
  }
  return new Date(utc).toISOString()
}

/** The offset most published items have, from the counts the export gives. */
export const commonOffset = (offsets: ReadonlyMap<number, number>): number => {
  let best = 0
  let count = -1
  for (const [offset, n] of offsets) {
    if (n > count || (n === count && offset < best)) {
      best = offset
      count = n
    }
  }
  return best
}
